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

// Unused now — TargetAreaPage.tsx no longer renders the two per-state bar
// charts this fed (voronoi-by-state, gridded-by-state); they were replaced
// by computeTargetAreaGeoBreakdown/TargetAreaGeoBreakdownTable below, which
// also drills to ward, not just state. Left in place (like mlosAggregate.ts's
// computeStateFlagBreakdown) since components/targetArea/TargetAreaStateChart.tsx
// itself is still on disk — this session can't delete files on your
// machine — and still imports TargetAreaStateEntry/this function; removing
// either would break that file's compile even though nothing renders it
// anymore. Feeds components/targetArea/TargetAreaStateChart.tsx — one call handles
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

// Scopes a layer's records down to State/LGA/Ward, using that layer's OWN
// detected columns (each layer's columns are detected independently — see
// the comment on computeStateSettlementBreakdown above). Any of state/lga/
// ward left null is not filtered on, so state-only scoping (lga/ward null)
// behaves the same as the old filterRecordsByState this replaces — that
// function and its flat-key-set sibling filterKeySetByState are gone now
// that TargetAreaPage.tsx's drill filter covers all three levels (the
// State/LGA/Ward table filters — see TargetAreaGeoBreakdownTable.tsx) rather
// than just state, and TargetAreaPage now derives masterListRef/
// plannedListRef's scoped key sets straight from their own records via this
// function + uniqueKeySet, instead of prefix-matching flat key strings.
export function filterRecordsByGeo(
  records: TargetAreaRecord[],
  columns: DetectedColumns | null,
  state: string | null,
  lga: string | null,
  ward: string | null,
): TargetAreaRecord[] {
  if (!state && !lga && !ward) return records
  if (!columns) return records
  return records.filter((r) => {
    if (state && cellText(r, columns.state) !== state) return false
    if (lga && cellText(r, columns.lga) !== lga) return false
    if (ward && cellText(r, columns.ward) !== ward) return false
    return true
  })
}

// Filters a layer's records down to wards present in (or absent from)
// `wardKeys` — feeds TargetAreaPage.tsx's Location type filter (Planned /
// Not Planned), scoping the summary cards and volume chart the same way
// TargetAreaGeoBreakdownEntry.hasPlannedSettlements scopes the breakdown
// table's own rows (both read off the identical wardKey join, so a ward
// classified "planned" in the table is scoped in here too). Unlike
// filterRecordsByGeo, this isn't a drill the user picks by exact state/lga/
// ward value — wardKeys is precomputed once from geoBreakdown's rows (see
// TargetAreaPage.tsx) and a record matches by its own ward regardless of
// which layer/column set it came from.
export function filterRecordsByWardMembership(
  records: TargetAreaRecord[],
  columns: DetectedColumns | null,
  wardKeys: Set<string>,
  membership: 'in' | 'out',
): TargetAreaRecord[] {
  if (!columns) return records
  return records.filter((r) => {
    const key = wardKey(r, columns.state, columns.lga, columns.ward)
    const isIn = key !== null && wardKeys.has(key)
    return membership === 'in' ? isIn : !isIn
  })
}

export interface TargetAreaGeoBreakdownEntry {
  state: string
  lga: string
  ward: string
  /** Unique settlements in this ward per the uploaded master list (or the voronoi output, if the master list couldn't be read — see computeTargetAreaGeoBreakdown). */
  settlementCount: number
  /** Unique settlements in this ward that got a voronoi TA. */
  voronoiCount: number
  /** Total grid cells (gridded_ta rows) in this ward — NOT a unique-settlement count, since gridded_ta can have several rows per settlement (one per grid cell). */
  griddedCount: number
  /** Unique planned-list settlements in this ward that got a voronoi TA — 0 when no planned list was uploaded. */
  plannedVoronoiCount: number
  /** Total planned-list grid cells (gridded_ta_subset rows) in this ward — 0 when no planned list was uploaded; same row-count-not-settlement-count caveat as griddedCount. */
  plannedGriddedCount: number
  /** Whether this ward has at least one settlement on the uploaded planned list — always false when no planned list was uploaded. Drives the Location type (Planned / Not Planned) filter — see computeTargetAreaGeoBreakdown. */
  hasPlannedSettlements: boolean
}

interface WardGroup {
  state: string
  lga: string
  ward: string
  settlements: Set<string>
  // Total row count for this ward, unlike settlements.size (unique
  // settlements) — gridded_ta can have several rows per settlement (one per
  // grid cell — see the row_id/area_sqm/building_count columns noted in
  // types/targetArea.ts), so griddedCount below needs the raw row count,
  // not the deduped settlement count computeTargetAreaGeoBreakdown uses for
  // the voronoi/master-list columns.
  rowCount: number
}

// Groups records into per-ward unique-settlement sets (plus a raw row
// count — see WardGroup.rowCount), keyed by the same state|lga|ward join
// wardKey() uses elsewhere, so every layer's breakdown lines up on identical
// geography even though each layer's columns are independently
// fuzzy-detected (see computeStateSettlementBreakdown's comment on why that
// independent detection happens at all).
function groupByWard(records: TargetAreaRecord[], columns: DetectedColumns): Map<string, WardGroup> {
  const groups = new Map<string, WardGroup>()
  for (const record of records) {
    const key = wardKey(record, columns.state, columns.lga, columns.ward)
    if (!key) continue
    if (!groups.has(key)) {
      groups.set(key, {
        state: cellText(record, columns.state) ?? '',
        lga: cellText(record, columns.lga) ?? '',
        ward: cellText(record, columns.ward) ?? '',
        settlements: new Set(),
        rowCount: 0,
      })
    }
    const group = groups.get(key)!
    group.rowCount += 1
    const settlement = settlementKey(record, columns.state, columns.lga, columns.ward, columns.settlement)
    if (settlement) group.settlements.add(settlement)
  }
  return groups
}

// Feeds components/targetArea/TargetAreaGeoBreakdownTable.tsx — one row per
// State + LGA + Ward, replacing the old per-state voronoi/gridded bar charts
// (TargetAreaStateChart, now unused — see the comment above
// TargetAreaStateEntry) with a table that also drills to ward. `settlementCount`
// prefers the uploaded master list as ground truth (same "parse the raw
// upload" rationale as TargetAreaPage.tsx's top-level missingVoronoi check)
// and falls back to the voronoi output's own unique-settlement count for any
// ward when the master list couldn't be read (masterColumns null) — mirroring
// missingVoronoiReference's 'mlos' | 'gridded' fallback. planned* columns stay
// 0 for every ward when no planned list was uploaded (plannedVoronoiColumns/
// plannedGriddedColumns null), rather than falling back to anything, since
// "0 planned settlements" is the correct answer there, not a gap to patch.
// griddedCount/plannedGriddedCount use the group's raw rowCount rather than
// settlements.size — gridded_ta has one row per GRID CELL, several per
// settlement, so "gridded TA count" means the total number of grid TAs
// produced for the ward, not how many distinct settlements got one (that
// distinction — coverage vs. volume — is already why TAVolumeChart.tsx
// reads raw row counts rather than deduped settlement counts).
//
// hasPlannedSettlements prefers the raw planned-list upload (plannedMaster*
// — parsed client-side, same "true reference" rationale as `settlementCount`
// preferring the master list) so a ward counts as "planned" even if none of
// its planned settlements happened to get a voronoi/gridded TA yet. Falls
// back to "did this ward get ANY subset_voronoi or gridded_ta_subset row" —
// the same voronoi-proxy idea TargetAreaPage.tsx's plannedListSource already
// uses — when the planned-list file couldn't be re-parsed (plannedMasterColumns
// null) but a planned list was still uploaded (those subset layers are only
// ever produced for planned-list settlements in the first place).
export function computeTargetAreaGeoBreakdown(
  masterRecords: TargetAreaRecord[],
  masterColumns: DetectedColumns | null,
  voronoiRecords: TargetAreaRecord[],
  voronoiColumns: DetectedColumns,
  griddedRecords: TargetAreaRecord[],
  griddedColumns: DetectedColumns | null,
  plannedVoronoiRecords: TargetAreaRecord[],
  plannedVoronoiColumns: DetectedColumns | null,
  plannedGriddedRecords: TargetAreaRecord[],
  plannedGriddedColumns: DetectedColumns | null,
  plannedMasterRecords: TargetAreaRecord[],
  plannedMasterColumns: DetectedColumns | null,
): TargetAreaGeoBreakdownEntry[] {
  const voronoiGroups = groupByWard(voronoiRecords, voronoiColumns)
  const masterGroups = masterColumns ? groupByWard(masterRecords, masterColumns) : voronoiGroups
  const griddedGroups = griddedColumns ? groupByWard(griddedRecords, griddedColumns) : new Map<string, WardGroup>()
  const plannedVoronoiGroups = plannedVoronoiColumns ? groupByWard(plannedVoronoiRecords, plannedVoronoiColumns) : new Map<string, WardGroup>()
  const plannedGriddedGroups = plannedGriddedColumns ? groupByWard(plannedGriddedRecords, plannedGriddedColumns) : new Map<string, WardGroup>()
  const plannedMasterGroups = plannedMasterColumns ? groupByWard(plannedMasterRecords, plannedMasterColumns) : null

  const allKeys = new Set<string>([
    ...masterGroups.keys(),
    ...voronoiGroups.keys(),
    ...griddedGroups.keys(),
    ...plannedVoronoiGroups.keys(),
    ...plannedGriddedGroups.keys(),
    ...(plannedMasterGroups?.keys() ?? []),
  ])

  return Array.from(allKeys)
    .map((key) => {
      const source =
        masterGroups.get(key) ??
        voronoiGroups.get(key) ??
        griddedGroups.get(key) ??
        plannedVoronoiGroups.get(key) ??
        plannedGriddedGroups.get(key) ??
        plannedMasterGroups?.get(key)!
      const hasPlannedSettlements = plannedMasterGroups
        ? (plannedMasterGroups.get(key)?.settlements.size ?? 0) > 0
        : (plannedVoronoiGroups.get(key)?.settlements.size ?? 0) > 0 || (plannedGriddedGroups.get(key)?.rowCount ?? 0) > 0
      return {
        state: source.state,
        lga: source.lga,
        ward: source.ward,
        settlementCount: masterGroups.get(key)?.settlements.size ?? 0,
        voronoiCount: voronoiGroups.get(key)?.settlements.size ?? 0,
        griddedCount: griddedGroups.get(key)?.rowCount ?? 0,
        plannedVoronoiCount: plannedVoronoiGroups.get(key)?.settlements.size ?? 0,
        plannedGriddedCount: plannedGriddedGroups.get(key)?.rowCount ?? 0,
        hasPlannedSettlements,
      }
    })
    .sort((a, b) => a.state.localeCompare(b.state) || a.lga.localeCompare(b.lga) || a.ward.localeCompare(b.ward))
}
