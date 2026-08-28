import * as XLSX from 'xlsx'
import { parseFileRows } from './dipGeneratorParse'
import type { ParsedRows } from './dipGeneratorParse'
import { detectColumns } from './columns'
import type { DisaggregateLevel, SheetSummary } from '../types/compilerDisaggregate'

// Reads the uploaded MLoS file client-side (before the request goes out) so
// this page can report the true original row count and a missing-admin-value
// count regardless of what the response looks like — disaggregate_mlos
// itself never reports either of these back to the caller.
export async function analyzeOriginalMlos(
  file: File,
  level: DisaggregateLevel,
): Promise<{ totalRecordsOriginal: number; rowsMissingAdminValue: number }> {
  const parsed: ParsedRows = await parseFileRows(file)
  const columns = detectColumns(parsed.headers)

  let rowsMissingAdminValue = 0
  for (const row of parsed.rows) {
    const lgaBlank = !columns.lga || !String(row[columns.lga] ?? '').trim()
    const wardBlank = level === 'Ward' && (!columns.ward || !String(row[columns.ward] ?? '').trim())
    if (lgaBlank || wardBlank) rowsMissingAdminValue += 1
  }

  return { totalRecordsOriginal: parsed.rows.length, rowsMissingAdminValue }
}

// Reads the response .xlsx workbook (single file, not zipped) into one
// SheetSummary per sheet, in the order disaggregate_mlos wrote them
// (pandas groupby order) — sheet name + row count via sheet_to_json, not
// re-parsing every cell.
export async function parseDisaggregateWorkbook(blob: Blob): Promise<SheetSummary[]> {
  const buffer = await blob.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]
    return { name, recordCount: rows.length }
  })
}
