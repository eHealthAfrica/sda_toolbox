import type { TargetAreaRecord } from '../types/targetArea'
import type { DetectedColumns } from './columns'

export function cellText(record: TargetAreaRecord, column: string | null): string | null {
  if (!column) return null
  const raw = record[column]
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  return String(raw).trim()
}

// Same rationale as REACH's utils/reachAggregate.ts: LGA names repeat across
// different states, ward names repeat across different LGAs, and settlement
// names repeat across different wards even more often — so counting/
// grouping by a bare admin-level name alone silently merges distinct
// places. Concatenate with every parent admin level to disambiguate.
export function lgaKey(record: TargetAreaRecord, stateCol: string | null, lgaCol: string | null): string | null {
  const state = cellText(record, stateCol)
  const lga = cellText(record, lgaCol)
  if (!lga) return null
  return state ? `${state} | ${lga}` : lga
}

export function wardKey(
  record: TargetAreaRecord,
  stateCol: string | null,
  lgaCol: string | null,
  wardCol: string | null,
): string | null {
  const ward = cellText(record, wardCol)
  if (!ward) return null
  const state = cellText(record, stateCol)
  const lga = cellText(record, lgaCol)
  return [state, lga, ward].filter(Boolean).join(' | ')
}

export function settlementKey(
  record: TargetAreaRecord,
  stateCol: string | null,
  lgaCol: string | null,
  wardCol: string | null,
  settlementCol: string | null,
): string | null {
  const settlement = cellText(record, settlementCol)
  if (!settlement) return null
  const state = cellText(record, stateCol)
  const lga = cellText(record, lgaCol)
  const ward = cellText(record, wardCol)
  return [state, lga, ward, settlement].filter(Boolean).join(' | ')
}

// Same de-dup logic as countUniqueKeys, but returns the Set itself rather
// than just its size — needed wherever a card has to intersect/diff two
// layers' settlement sets (e.g. "found in both voronoi and gridded TA")
// rather than just count one layer on its own. gridded_ta in particular can
// have several rows per settlement (one per grid cell — see the row_id/
// area_sqm/building_count columns noted in types/targetArea.ts), so this is
// also how its records get de-duplicated down to unique settlements.
export function uniqueKeySet(records: TargetAreaRecord[], keyFn: (r: TargetAreaRecord) => string | null): Set<string> {
  const seen = new Set<string>()
  for (const record of records) {
    const key = keyFn(record)
    if (key) seen.add(key)
  }
  return seen
}

export function countUniqueKeys(records: TargetAreaRecord[], keyFn: (r: TargetAreaRecord) => string | null): number {
  return uniqueKeySet(records, keyFn).size
}

/** Count of keys present in BOTH sets — e.g. settlements that show up in both the voronoi and gridded TA outputs. */
export function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const key of a) {
    if (b.has(key)) count += 1
  }
  return count
}

/** Count of keys in `a` that are absent from `b` — e.g. settlements present in the upload but missing from an output layer. */
export function differenceSize(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const key of a) {
    if (!b.has(key)) count += 1
  }
  return count
}

export function countUniqueColumn(records: TargetAreaRecord[], column: string | null): number {
  if (!column) return 0
  const seen = new Set<string>()
  for (const record of records) {
    const value = cellText(record, column)
    if (value) seen.add(value)
  }
  return seen.size
}

export interface TargetAreaStateEntry {
  state: string
  /** Unique settlements in the primary layer for this state (e.g. voronoi, or gridded_ta). */
  primary: number
  /** Unique settlements in the paired planned-list subset layer for this state (e.g. subset_voronoi, or gridded_ta_subset) — 0 when no planned list was uploaded. */
  subset: number
}

// Feeds components/targetArea/TargetAreaStateChart.tsx — one call handles
// both the voronoi chart (primary=voronoi, subset=subset_voronoi) and the
// gridded TA chart (primary=gridded_ta, subset=gridded_ta_subset), since the
// shape of the comparison is identical either way. Counts unique SETTLEMENTS
// per state, not raw rows — consistent with how every other metric on this
// page counts (see settlementKey/uniqueKeySet above), and specifically
// avoids the row-count trap TAVolumeChart.tsx warns about: gridded_ta can
// have many rows per settlement (one per grid cell), so a raw per-state row
// count would mostly reflect settlement AREA, not settlement coverage.
// primaryColumns/subsetColumns are passed in separately (rather than
// re-detected here) because each layer's columns are independently
// fuzzy-detected already by the caller — see TargetAreaPage.tsx's `analysis`.
export function computeStateSettlementBreakdown(
  primaryRecords: TargetAreaRecord[],
  primaryColumns: DetectedColumns,
  subsetRecords: TargetAreaRecord[],
  subsetColumns: DetectedColumns,
): TargetAreaStateEntry[] {
  function byState(records: TargetAreaRecord[], columns: DetectedColumns): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>()
    for (const record of records) {
      const state = cellText(record, columns.state)
      if (!state) continue
      const key = settlementKey(record, columns.state, columns.lga, columns.ward, columns.settlement)
      if (!key) continue
      if (!map.has(state)) map.set(state, new Set())
      map.get(state)!.add(key)
    }
    return map
  }

  const primaryByState = byState(primaryRecords, primaryColumns)
  const subsetByState = byState(subsetRecords, subsetColumns)

  const allStates = new Set<string>([...primaryByState.keys(), ...subsetByState.keys()])
  return Array.from(allStates)
    .map((state) => ({
      state,
      primary: primaryByState.get(state)?.size ?? 0,
      subset: subsetByState.get(state)?.size ?? 0,
    }))
    .sort((a, b) => b.primary - a.primary)
}

// Scopes a flat settlement-key Set (masterListSet/plannedListSet in
// TargetAreaPage.tsx — parsed client-side from the raw uploaded file, see
// utils/targetAreaReference.ts) down to one state, for when a chart
// selection filters the summary cards. Those sets hold bare keys with no
// separate state field, so this relies on settlementKey's own join order
// (state is always the FIRST non-empty segment — see settlementKey above)
// rather than re-parsing each key apart.
export function filterKeySetByState(keys: Set<string>, state: string | null): Set<string> {
  if (!state) return keys
  const prefix = `${state} | `
  const filtered = new Set<string>()
  for (const key of keys) {
    if (key === state || key.startsWith(prefix)) filtered.add(key)
  }
  return filtered
}

// Scopes a layer's records down to one state, using that layer's OWN
// detected state column (each layer's columns are detected independently —
// see the comment on computeStateSettlementBreakdown above).
export function filterRecordsByState(records: TargetAreaRecord[], stateColumn: string | null, state: string | null): TargetAreaRecord[] {
  if (!state) return records
  return records.filter((r) => cellText(r, stateColumn) === state)
}
