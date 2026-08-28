import JSZip from 'jszip'
import { countPdfPages } from './pdfPageCount'
import type { DipMapMergerAnalysis, LgaBookStat, PreflightLgaStat, PreflightResult } from '../types/dipMapMerger'

interface ZipPdfEntry {
  name: string // basename only
  bytes: Uint8Array
}

// Reads every .pdf entry out of a zip file (any nesting depth — the actual
// response zip nests each LGA's PDF one folder deeper than you'd expect,
// see parseMergedZip below), returning just the basename and raw bytes.
async function extractPdfEntries(source: File | Blob): Promise<ZipPdfEntry[]> {
  const zip = await JSZip.loadAsync(await source.arrayBuffer())
  const names = Object.keys(zip.files).filter(
    (name) => !zip.files[name].dir && name.toLowerCase().endsWith('.pdf')
  )
  const entries: ZipPdfEntry[] = []
  for (const name of names) {
    const bytes = await zip.files[name].async('uint8array')
    const basename = name.split('/').pop() ?? name
    entries.push({ name: basename, bytes })
  }
  return entries
}

// Every team DIP page is named
// `DIP of Team {team_code} {ward} ward, {lga} LGA.pdf`
// (template_generator.py::generate_team_pdf, line 60) — fixed and verified
// against the real source, not guessed. Returns the LGA name and the
// "id_str" (everything after "DIP of ") that merger.py::arrange_pages uses
// as its matching key.
function parseDipFilename(filename: string): { lga: string; idStr: string } | null {
  if (!filename.startsWith('DIP of ')) return null
  const idStr = filename.slice('DIP of '.length)
  const lgaMatch = idStr.match(/,\s*(.+?)\s+LGA\.pdf$/i)
  if (!lgaMatch) return null
  return { lga: lgaMatch[1], idStr }
}

// Replicates merger.py::merge_maps_to_dips + arrange_pages exactly (read
// verbatim, not ported from memory): for each LGA found in the DIP zip,
// both the DIP pages and the Team Guide Map pages are first narrowed to
// filenames ending in "{lga} LGA.pdf", then paired one-to-one by matching
// each DIP page's "DIP of "-stripped suffix against a map filename ending
// in that same suffix. Anything without exactly one match on both sides is
// dropped — silently, in the real backend; this function is what makes
// that drop visible before the file is ever uploaded.
export async function computePreflight(mapsFile: File, dipFile: File): Promise<PreflightResult> {
  const [dipEntries, mapEntries] = await Promise.all([
    extractPdfEntries(dipFile),
    extractPdfEntries(mapsFile),
  ])

  const lgaSet = new Set<string>()
  const dipByLga = new Map<string, string[]>() // lga -> id strings
  for (const entry of dipEntries) {
    const parsed = parseDipFilename(entry.name)
    if (!parsed) continue
    lgaSet.add(parsed.lga)
    const list = dipByLga.get(parsed.lga) ?? []
    list.push(parsed.idStr)
    dipByLga.set(parsed.lga, list)
  }

  const byLga: PreflightLgaStat[] = []
  let totalMatchedTeams = 0
  let totalUnmatchedPages = 0

  for (const lga of Array.from(lgaSet).sort()) {
    const suffix = `${lga} LGA.pdf`
    const lgaDipIds = dipByLga.get(lga) ?? []
    const lgaMapNames = mapEntries.filter((e) => e.name.endsWith(suffix)).map((e) => e.name)

    let matched = 0
    const usedMapNames = new Set<string>()
    for (const idStr of lgaDipIds) {
      const candidates = lgaMapNames.filter((name) => name.endsWith(idStr))
      if (candidates.length === 1) {
        matched += 1
        usedMapNames.add(candidates[0])
      }
    }
    const unmatchedDip = lgaDipIds.length - matched
    const unmatchedMap = lgaMapNames.length - usedMapNames.size

    byLga.push({
      lga,
      dipPages: lgaDipIds.length,
      mapPages: lgaMapNames.length,
      matchedTeams: matched,
      unmatchedPages: unmatchedDip + unmatchedMap,
    })
    totalMatchedTeams += matched
    totalUnmatchedPages += unmatchedDip + unmatchedMap
  }

  return {
    totalDipPages: dipEntries.length,
    totalMapPages: mapEntries.length,
    totalMatchedTeams,
    totalUnmatchedPages,
    byLga: byLga.sort((a, b) => b.matchedTeams - a.matchedTeams),
  }
}

// Parses the actual response from POST /dip/merger. dip_template.py writes
// each merged PDF with
// `arcname=os.path.join("LGA Map Book.zip", os.path.basename(map_book))`
// (line 62) — so every LGA's PDF sits one folder deeper than the zip root,
// inside a subfolder literally named "LGA Map Book.zip" (a folder name that
// happens to end in .zip, not a real nested archive). extractPdfEntries
// already walks any depth, so that quirk needs no special handling here.
export async function parseMergedZip(responseBlob: Blob): Promise<LgaBookStat[]> {
  const entries = await extractPdfEntries(responseBlob)

  return entries.map((entry) => {
    const lga = entry.name.replace(/\s+Maps\.pdf$/i, '')
    const pages = countPdfPages(entry.bytes)
    return {
      lga,
      outputFilename: entry.name,
      pages,
      teams: Math.floor(pages / 2),
      oddPageCount: pages % 2 !== 0,
      pdfBytes: entry.bytes,
    }
  })
}

export function buildAnalysis(preflight: PreflightResult, booksUnsorted: LgaBookStat[]): DipMapMergerAnalysis {
  const books = [...booksUnsorted].sort((a, b) => b.teams - a.teams)
  const totalPages = books.reduce((sum, b) => sum + b.pages, 0)
  const totalTeams = books.reduce((sum, b) => sum + b.teams, 0)
  const largest = books.length > 0 ? books[0] : null

  return {
    preflight,
    books,
    lgaCount: books.length,
    totalPages,
    totalTeams,
    avgTeamsPerLga: books.length > 0 ? Math.round(totalTeams / books.length) : 0,
    largestLga: largest ? { lga: largest.lga, teams: largest.teams } : null,
  }
}
