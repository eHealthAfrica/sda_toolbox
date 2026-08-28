import type { TargetAreaRecord } from '../types/targetArea'

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
