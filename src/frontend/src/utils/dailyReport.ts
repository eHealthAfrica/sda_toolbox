import Papa from 'papaparse'
import * as XLSX from 'xlsx'

/**
 * Reads just the column headers of an uploaded settlement list, client-side,
 * before the file is ever sent to POST /reports/daily — so the Day-column
 * and Cumulative-column dropdowns can offer the file's REAL headers instead
 * of asking an analyst to type a column name blind. Mirrors the same
 * csv/xlsx/xls read_dataset supports server-side for a non-spatial table
 * (toolbox/access/read_mgr.py:37-39) — anything else read_dataset would
 * route to the spatial GeoData reader instead, so it's not a settlement
 * list this route can use and isn't attempted here either.
 *
 * Reuses the same Papa/XLSX parsers already used elsewhere in this app
 * (utils/compilerTracksOriginalCount.ts) rather than adding a new one.
 */
export async function readSettlementListHeaders(file: File): Promise<string[]> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (extension === 'csv') {
    const text = await file.text()
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, preview: 1 })
    return parsed.meta.fields ?? []
  }

  if (extension === 'xlsx' || extension === 'xls') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const workbook = XLSX.read(bytes, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]
    return (rows[0] ?? []).map((v) => String(v))
  }

  // Not one of the extensions the real route can read as a table either —
  // surface no headers rather than guessing; the form falls back to a free
  // text field (see DailyReportForm.tsx).
  return []
}
