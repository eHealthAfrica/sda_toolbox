import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { readGpkgLayer } from './gpkg'

export interface TracksOriginalCount {
  /** false when this extension can't be parsed client-side (sqlite/kml/kmz), or a zip had no entries matching the declared extension. */
  supported: boolean
  /** Total rows/features found across every matching file in the upload — 0 when unsupported. */
  count: number
}

// Counts total rows/features in the RAW file the user is about to upload to
// POST /compiler/tracks, BEFORE any server-side filtering. Confirmed with
// the user: the backend's filter criteria (tracks_manager/preprocess.py::
// filter_valid_tracks — drop any row failing the coordinate-pattern check on
// lat/lon/speed; when "remove invalid tracks" is on, additionally require
// speed <= 1 m/s AND GPS timestamp hour <= 16) is accurate as implemented;
// full docstring/doc updates are expected later, separately from this page.
//
// Deliberately does NOT re-implement that filter's own logic client-side —
// matching pandas' exact datetime parsing and regex semantics is a real risk
// of subtle drift from what the server actually does. Instead this just
// counts the input, so the page can compute
//   dropped = originalCount − pointsActuallyReturned
// which stays self-consistent with whatever the server decided to keep, no
// matter how its filtering is implemented or later changed.
//
// Only csv/xlsx/xls/gpkg can be read client-side today (reusing the same
// parsers already used elsewhere in this app — Papa/XLSX for tabular files,
// utils/gpkg.ts's sql.js reader for GeoPackage). sqlite/kml/kmz have no
// client-side parser anywhere in this codebase, so those report
// `supported: false` rather than a guessed or wrong count.
const PARSEABLE_EXTENSIONS = new Set(['csv', 'xlsx', 'xls', 'gpkg'])

function countCsvRows(bytes: Uint8Array): number {
  const text = new TextDecoder().decode(bytes)
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
  return parsed.data.length
}

function countExcelRows(bytes: Uint8Array): number {
  const workbook = XLSX.read(bytes, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]
  return rows.length
}

async function countGpkgRows(bytes: Uint8Array): Promise<number> {
  // 'tracks' is only a hint — readGpkgLayer falls back to gpkg_contents if
  // the raw upload doesn't already use that table name (it won't yet: this
  // is the file the user is about to send, not the layer name the backend
  // writes its own response under).
  const layer = await readGpkgLayer(bytes, 'tracks')
  return layer.rowCount
}

async function countBytesRows(bytes: Uint8Array, extension: string): Promise<number | null> {
  const ext = extension.toLowerCase()
  if (ext === 'csv') return countCsvRows(bytes)
  if (ext === 'xlsx' || ext === 'xls') return countExcelRows(bytes)
  if (ext === 'gpkg') return await countGpkgRows(bytes)
  return null
}

export async function countOriginalTrackRows(file: File, tracksExtension: string): Promise<TracksOriginalCount> {
  const ext = tracksExtension.toLowerCase()
  const isZip = file.name.toLowerCase().endsWith('.zip')

  if (!isZip) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const count = await countBytesRows(bytes, ext)
    return count === null ? { supported: false, count: 0 } : { supported: true, count }
  }

  if (!PARSEABLE_EXTENSIONS.has(ext)) {
    return { supported: false, count: 0 }
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const entryNames = Object.keys(zip.files).filter(
    (name) => !zip.files[name].dir && name.toLowerCase().endsWith(`.${ext}`)
  )

  let total = 0
  for (const name of entryNames) {
    const bytes = await zip.files[name].async('uint8array')
    const count = await countBytesRows(bytes, ext)
    if (count !== null) total += count
  }

  return { supported: true, count: total }
}
