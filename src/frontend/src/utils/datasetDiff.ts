// Generic row-level diff between an "input" dataset and an "output" dataset
// — built for the three MLoS maintenance endpoints (standardize/fixer/update
// validation), which all take a settlement list and hand back a modified
// version of the SAME settlement list. All three are row-preserving from the
// backend's perspective:
//   - /qc/standardize only rewrites cell values (case/whitespace/preset
//     attributes/takeoff-point standardization) — toolbox/mlos/transform.py.
//   - /qc/fixer only rewrites specific columns for specific rows (shifted
//     lat/lon, populated global_id, populated takeoff point) — never adds or
//     removes rows — toolbox/fixers/*.py.
//   - /mlos/validation explicitly does `mlos_data.merge(validated_data,
//     how='left', ...)` keyed on the MLoS side, then restricts the result
//     back to the original MLoS columns (`updated_mlos.loc[:, mlos_cols]`)
//     — toolbox/mlos/validation/update/update.py — so its output row count
//     equals the input row count by construction too.
// That "same rows, different cell values" shape is what makes a client-side
// diff tractable: match each output row back to its input row, then compare
// cell-by-cell over the columns both sides share.
//
// Row matching prefers a stable identifier column (global_id/eha_guid/
// unique_code-style) when both files carry one, since that survives any
// text edit to the admin columns themselves. Falling back to a
// normalized (trimmed, lowercased) state|lga|ward|settlement concatenation
// — the same identity key toolbox/mlos/mtools.py::construct_new_unique
// builds server-side, and the same state+LGA/state+LGA+ward/state+LGA+ward+
// settlement de-duplication principle used throughout this app — means a
// row whose settlement/ward/lga/state name itself was corrected by the run
// (rather than just re-cased) won't be recognized as the same row; there's
// no way around that without a real backend-issued row ID, so such rows
// surface as one "removed" input row and one "added" output row rather than
// a matched change. Treat added/removed counts as a hint to check the raw
// data, not as a guarantee no such row was actually just renamed.

import { detectColumns } from './columns'
import type { DetectedColumns } from './columns'

export type DatasetRecord = Record<string, string | number | null>

export interface FieldChange {
  rowKey: string
  state: string | null
  lga: string | null
  ward: string | null
  settlement: string | null
  field: string
  oldValue: string | number | null
  newValue: string | number | null
}

export interface DatasetDiffResult {
  matchStrategy: 'id-column' | 'admin-concat'
  matchColumn: string | null
  totalInputRows: number
  totalOutputRows: number
  matchedRows: number
  addedRows: number
  removedRows: number
  changedRowCount: number
  fieldChangeCount: number
  fieldChanges: FieldChange[]
  changedStates: number
  changedLgas: number
  changedWards: number
  changedSettlements: number
}

const ID_COLUMN_PATTERN = /(global_id|eha_guid|unique_code|unique_id|uuid|guid)/i

// Row IDENTITY (which input row is this output row?) needs to survive a
// standardize/fixer run re-casing or re-trimming a cell, so key-building
// normalizes aggressively (trim + lowercase). Field-level CHANGE DETECTION
// is the opposite: case and whitespace differences are exactly what
// /qc/standardize's "Removal of Whitespaces" and "Capitalize Attributes"
// produce, so comparing values for the changes table must NOT fold case or
// trim — otherwise every standardize run would (wrongly) show ~0 changes.
// The one thing both share is treating null/undefined/empty-string as the
// same "nothing here" value, so a blank-vs-blank cell never registers.
function normalize(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase()
}

function displayString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function valuesEqual(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  return displayString(a) === displayString(b)
}

function detectIdColumn(inputColumns: string[], outputColumns: string[], adminCols: (string | null)[]): string | null {
  const admin = new Set(adminCols.filter((c): c is string => Boolean(c)))
  const shared = inputColumns.filter((c) => outputColumns.includes(c) && !admin.has(c))
  return shared.find((c) => ID_COLUMN_PATTERN.test(c)) ?? null
}

function rowKey(record: DatasetRecord, adminCols: (string | null)[], idColumn: string | null): string | null {
  if (idColumn) {
    const idValue = normalize(record[idColumn])
    if (idValue) return `id:${idValue}`
  }
  const parts = adminCols.map((c) => (c ? normalize(record[c]) : ''))
  if (parts.every((p) => !p)) return null
  return `admin:${parts.join('|')}`
}

export function diffDatasets(
  inputRecords: DatasetRecord[],
  inputColumns: string[],
  outputRecords: DatasetRecord[],
  outputColumns: string[],
): DatasetDiffResult {
  const columns: DetectedColumns = detectColumns(inputColumns)
  const adminCols = [columns.state, columns.lga, columns.ward, columns.settlement]
  const idColumn = detectIdColumn(inputColumns, outputColumns, adminCols)
  const compareColumns = inputColumns.filter((c) => outputColumns.includes(c))

  const outputByKey = new Map<string, DatasetRecord>()
  for (const record of outputRecords) {
    const key = rowKey(record, adminCols, idColumn)
    if (key) outputByKey.set(key, record)
  }

  const fieldChanges: FieldChange[] = []
  const changedStateKeys = new Set<string>()
  const changedLgaKeys = new Set<string>()
  const changedWardKeys = new Set<string>()
  const changedSettlementKeys = new Set<string>()
  const matchedOutputKeys = new Set<string>()
  let matchedRows = 0
  let changedRowCount = 0

  for (const inputRow of inputRecords) {
    const key = rowKey(inputRow, adminCols, idColumn)
    if (!key) continue
    const outputRow = outputByKey.get(key)
    if (!outputRow) continue

    matchedRows += 1
    matchedOutputKeys.add(key)

    const state = columns.state ? String(inputRow[columns.state] ?? '').trim() || null : null
    const lga = columns.lga ? String(inputRow[columns.lga] ?? '').trim() || null : null
    const ward = columns.ward ? String(inputRow[columns.ward] ?? '').trim() || null : null
    const settlement = columns.settlement ? String(inputRow[columns.settlement] ?? '').trim() || null : null

    let rowChanged = false
    for (const field of compareColumns) {
      const oldValue = inputRow[field]
      const newValue = outputRow[field]
      if (valuesEqual(oldValue, newValue)) continue

      rowChanged = true
      fieldChanges.push({ rowKey: key, state, lga, ward, settlement, field, oldValue: oldValue ?? null, newValue: newValue ?? null })
    }

    if (rowChanged) {
      changedRowCount += 1
      if (state) changedStateKeys.add(normalize(state))
      if (state && lga) changedLgaKeys.add(`${normalize(state)}|${normalize(lga)}`)
      if (state && lga && ward) changedWardKeys.add(`${normalize(state)}|${normalize(lga)}|${normalize(ward)}`)
      changedSettlementKeys.add(key)
    }
  }

  const removedRows = inputRecords.length - matchedRows
  const addedRows = outputRecords.length - matchedOutputKeys.size

  return {
    matchStrategy: idColumn ? 'id-column' : 'admin-concat',
    matchColumn: idColumn,
    totalInputRows: inputRecords.length,
    totalOutputRows: outputRecords.length,
    matchedRows,
    addedRows: Math.max(addedRows, 0),
    removedRows: Math.max(removedRows, 0),
    changedRowCount,
    fieldChangeCount: fieldChanges.length,
    fieldChanges,
    changedStates: changedStateKeys.size,
    changedLgas: changedLgaKeys.size,
    changedWards: changedWardKeys.size,
    changedSettlements: changedSettlementKeys.size,
  }
}
