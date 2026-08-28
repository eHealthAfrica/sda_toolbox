// Parsing/splitting/merging logic for Microplan · DIP Generator. See the
// top-of-file comment in types/dipGenerator.ts for why this page needs more
// than "call the endpoint and parse the response" — it also has to (a) split
// the uploaded DIP into per-LGA batches BEFORE upload, since /dip/generator
// has no lgas/state param and no batching of its own, and (b) merge every
// batch's response back into one zip afterward.

import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { detectColumns, findTeamColumn, findDayOfActivityColumn } from './columns'
import { countPdfPages } from './pdfPageCount'
import type { DipBatch, DipGeneratorAnalysis, GeneratedTeamDip, IngestNote } from '../types/dipGenerator'

export interface ParsedRows {
  headers: string[]
  rows: Record<string, string>[]
}

// Reads an uploaded .csv/.xlsx/.xls file into header-keyed rows. Same
// csv-vs-else branch convention as microplanValidateParse.ts::
// countRawSettlementRows, extended here to keep the actual row objects
// (not just a count) since we need to group and re-serialize them.
export async function parseFileRows(file: File): Promise<ParsedRows> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) {
    const text = await file.text()
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
    const headers = parsed.meta.fields ?? []
    return { headers, rows: parsed.data }
  }
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, string>[]
  const headers = rows.length > 0 ? Object.keys(rows[0]) : (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[] ?? [])
  return { headers, rows }
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === ''
}

// Mirrors prepare_dip_data's drop condition (dip_tools.py, line 102-105):
// a row survives if EITHER the team column OR the day-of-activity column is
// non-empty; it's dropped only when both are blank. Computed from the raw
// upload, before any batch is sent — the response zip can't tell us this.
export function buildIngestNote(parsed: ParsedRows): IngestNote {
  const { headers, rows } = parsed
  const lgaColumn = detectColumns(headers).lga
  const teamColumn = findTeamColumn(headers)
  const dayColumn = findDayOfActivityColumn(headers)

  let rowsMissingBoth = 0
  const lgaSet = new Set<string>()
  for (const row of rows) {
    const teamBlank = teamColumn ? isBlank(row[teamColumn]) : true
    const dayBlank = dayColumn ? isBlank(row[dayColumn]) : true
    if (teamBlank && dayBlank) rowsMissingBoth += 1
    if (lgaColumn && !isBlank(row[lgaColumn])) lgaSet.add(String(row[lgaColumn]).trim())
  }

  return {
    totalRows: rows.length,
    lgaColumn,
    teamColumn,
    dayColumn,
    rowsMissingBoth,
    distinctLgas: lgaSet.size,
  }
}

// Groups the raw uploaded rows by LGA value and chunks the distinct LGA list
// into batches of `batchSize` LGAs each, re-serializing each batch's rows
// into its own CSV File (name ending ".csv" — read_mgr.py::read_dataset
// branches purely on filename extension, not content-sniffing) so it can be
// posted as its own dip_file. Batch order follows the LGA list's natural
// (first-seen) order in the file, not alphabetical, so progress reads in a
// sensible sequence for whoever is watching.
export function splitDipFileByLga(
  parsed: ParsedRows,
  batchSize: number
): { batches: { lgas: string[]; rowCount: number; file: File }[]; lgaColumn: string | null } {
  const { headers, rows } = parsed
  const lgaColumn = detectColumns(headers).lga

  if (!lgaColumn) {
    // Can't detect an LGA column — fall back to one batch containing
    // everything, rather than guessing wrong and silently mis-grouping rows.
    const file = rowsToCsvFile(rows, 'dip_batch_all.csv')
    return { batches: [{ lgas: [], rowCount: rows.length, file }], lgaColumn: null }
  }

  const rowsByLga = new Map<string, Record<string, string>[]>()
  const lgaOrder: string[] = []
  for (const row of rows) {
    const raw = row[lgaColumn]
    const lga = isBlank(raw) ? '(blank)' : String(raw).trim()
    if (!rowsByLga.has(lga)) {
      rowsByLga.set(lga, [])
      lgaOrder.push(lga)
    }
    rowsByLga.get(lga)!.push(row)
  }

  const batches: { lgas: string[]; rowCount: number; file: File }[] = []
  for (let i = 0; i < lgaOrder.length; i += batchSize) {
    const lgaGroup = lgaOrder.slice(i, i + batchSize)
    const batchRows = lgaGroup.flatMap((lga) => rowsByLga.get(lga)!)
    const file = rowsToCsvFile(batchRows, `dip_batch_${Math.floor(i / batchSize) + 1}.csv`)
    batches.push({ lgas: lgaGroup, rowCount: batchRows.length, file })
  }
  return { batches, lgaColumn }
}

function rowsToCsvFile(rows: Record<string, string>[], filename: string): File {
  const csvText = Papa.unparse(rows)
  return new File([csvText], filename, { type: 'text/csv' })
}

// Every team's generated PDF is named
// `DIP of Team {team_code} {ward} ward, {lga} LGA.pdf`
// (template_generator.py::generate_team_pdf, line 60) — see the caveat in
// types/dipGenerator.ts about the "/" → " " mangling this applies to LGA
// names. Team code is assumed to contain no spaces (every real/observed
// sample is a zero-padded number, e.g. "000", "040"); ward is matched
// non-greedily since ward names can contain spaces.
export function parseTeamDipFilename(filename: string): { teamCode: string; ward: string; lga: string } | null {
  const match = filename.match(/^DIP of Team (\S+) (.+?) ward, (.+) LGA\.pdf$/i)
  if (!match) return null
  return { teamCode: match[1], ward: match[2], lga: match[3] }
}

interface BatchResponseData {
  teamPdfs: { name: string; bytes: Uint8Array }[]
  csvRows: Record<string, unknown>[]
}

// Reads one batch's real response zip. dip_template.py writes each team PDF
// with arcname=os.path.join("DIPS.zip", basename) (line 142) — same
// folder-nesting quirk as /dip/merger's "LGA Map Book.zip" — so every PDF
// sits one folder deeper than the zip root; walking zip.files by full path
// (not assuming root) handles that with no special-casing. "DIP.csv" is the
// one file genuinely at the root (add_to_archive, line 144).
export async function extractGeneratorZipEntries(blob: Blob): Promise<BatchResponseData> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const teamPdfs: { name: string; bytes: Uint8Array }[] = []
  let csvRows: Record<string, unknown>[] = []

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path]
    if (entry.dir) continue
    const basename = path.split('/').pop() ?? path
    if (basename.toLowerCase().endsWith('.pdf')) {
      const bytes = await entry.async('uint8array')
      teamPdfs.push({ name: basename, bytes })
    } else if (basename.toLowerCase() === 'dip.csv') {
      const text = await entry.async('text')
      const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true })
      csvRows = parsed.data
    }
  }

  return { teamPdfs, csvRows }
}

// Unions the activity-day tokens for one team's rows in the merged DIP.csv,
// mirroring clean_activity_days' "Day 1, Day 3"-style output (dip_tools.py,
// line 45-54) — reduced here to the plain digit set since we're aggregating
// across every settlement row for the team, not reformatting one cell.
function collectTeamDays(csvRows: Record<string, unknown>[], dayColumn: string | null, uniqueTeamCode: string, teamCodeCol: string | null): string[] | null {
  if (!dayColumn || !teamCodeCol) return null
  const days = new Set<number>()
  let matched = false
  for (const row of csvRows) {
    if (row['unique_team_code'] !== uniqueTeamCode) continue
    matched = true
    const raw = String(row[dayColumn] ?? '')
    for (const d of raw.match(/\d/g) ?? []) {
      const n = Number(d)
      if (n >= 1 && n <= 4) days.add(n)
    }
  }
  if (!matched) return null
  return Array.from(days).sort().map((d) => `Day ${d}`)
}

// Combines every batch's extracted team PDFs + DIP.csv rows into the final
// analysis this page renders. `unique_team_code` (lga_ward_teamcode, added
// by prepare_dip_data) is the join key back to per-team day-of-activity data
// in the merged CSV — built from the RAW row values, so it only lines up
// with a PDF's parsed (and possibly "/"-mangled) lga/ward/teamCode when
// those don't contain the mangled character; unmatched teams get `days:
// null` rather than a guessed value.
export function buildAnalysis(allTeamPdfs: { name: string; bytes: Uint8Array }[], allCsvRows: Record<string, unknown>[]): DipGeneratorAnalysis {
  const csvHeaders = allCsvRows.length > 0 ? Object.keys(allCsvRows[0]) : []
  const dayColumn = findDayOfActivityColumn(csvHeaders)

  const teamDips: GeneratedTeamDip[] = allTeamPdfs
    .map((entry) => {
      const parsed = parseTeamDipFilename(entry.name)
      if (!parsed) return null
      const uniqueTeamCode = `${parsed.lga}_${parsed.ward}_${parsed.teamCode}`
      const days = collectTeamDays(allCsvRows, dayColumn, uniqueTeamCode, 'unique_team_code')
      const stat: GeneratedTeamDip = {
        lga: parsed.lga,
        ward: parsed.ward,
        teamCode: parsed.teamCode,
        filename: entry.name,
        pages: countPdfPages(entry.bytes),
        days,
        pdfBytes: entry.bytes,
      }
      return stat
    })
    .filter((x): x is GeneratedTeamDip => x !== null)
    .sort((a, b) => a.lga.localeCompare(b.lga) || a.ward.localeCompare(b.ward) || a.teamCode.localeCompare(b.teamCode))

  const lgaSet = new Set(teamDips.map((t) => t.lga))
  const wardSet = new Set(teamDips.map((t) => `${t.lga}|${t.ward}`))

  const countsByLga = new Map<string, number>()
  for (const t of teamDips) countsByLga.set(t.lga, (countsByLga.get(t.lga) ?? 0) + 1)
  const teamsByLga = Array.from(countsByLga.entries())
    .map(([lga, teams]) => ({ lga, teams }))
    .sort((a, b) => b.teams - a.teams)

  return {
    teamDips,
    lgaCount: lgaSet.size,
    wardCount: wardSet.size,
    totalTeams: teamDips.length,
    teamsByLga,
    csvRows: allCsvRows,
  }
}

// Assembles the final downloadable zip from every completed batch.
// Deliberately does NOT reproduce the backend's own "DIPS.zip"-named
// subfolder quirk (dip_template.py, line 142) — since this page is already
// doing client-side assembly work, team PDFs go under a plainly-named
// "DIPS/" folder instead, with "DIP.csv" at the root, same as the real
// per-batch response.
export async function buildFinalZip(allTeamPdfs: { name: string; bytes: Uint8Array }[], allCsvRows: Record<string, unknown>[]): Promise<Blob> {
  const zip = new JSZip()
  const dipsFolder = zip.folder('DIPS')
  for (const entry of allTeamPdfs) {
    dipsFolder?.file(entry.name, entry.bytes)
  }
  if (allCsvRows.length > 0) {
    zip.file('DIP.csv', Papa.unparse(allCsvRows))
  }
  return zip.generateAsync({ type: 'blob' })
}

export function makeBatchId(index: number): string {
  return `batch-${index}`
}

export type { DipBatch }
