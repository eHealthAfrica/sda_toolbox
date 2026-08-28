import type { AccessibilityStatus, ReachRecord, ReachVisitationStatus } from '../types/reach'
import { ACCESSIBILITY_STATUSES, REACH_VISITATION_STATUSES } from '../types/reach'
import { toNumber } from './columns'

export function cellText(record: ReachRecord, column: string | null): string | null {
  if (!column) return null
  const raw = record[column]
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  return String(raw).trim()
}

// ---- unique state/LGA/ward counting ----
//
// LGA names repeat across different states (there's more than one "Bassa" in
// Nigeria, for instance), and ward names repeat across different LGAs/states
// even more often — so counting/grouping by the bare LGA or ward column
// alone silently merges distinct places. Concatenate with the parent admin
// level(s) to disambiguate, per the review's own guidance.
export function lgaKey(record: ReachRecord, stateCol: string | null, lgaCol: string | null): string | null {
  const state = cellText(record, stateCol)
  const lga = cellText(record, lgaCol)
  if (!lga) return null
  return state ? `${state} | ${lga}` : lga
}

export function wardKey(
  record: ReachRecord,
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

export function countUniqueKeys(records: ReachRecord[], keyFn: (r: ReachRecord) => string | null): number {
  const seen = new Set<string>()
  for (const record of records) {
    const key = keyFn(record)
    if (key) seen.add(key)
  }
  return seen.size
}

export function countUniqueColumn(records: ReachRecord[], column: string | null): number {
  if (!column) return 0
  const seen = new Set<string>()
  for (const record of records) {
    const value = cellText(record, column)
    if (value) seen.add(value)
  }
  return seen.size
}

// ---- visitation ----
export interface CountEntry<T extends string = string> {
  category: T
  count: number
}

export function computeVisitationCounts(
  records: ReachRecord[],
  visitationColumn = 'status',
): CountEntry<ReachVisitationStatus>[] {
  const counts = new Map<ReachVisitationStatus, number>(REACH_VISITATION_STATUSES.map((s) => [s, 0]))
  for (const record of records) {
    const raw = cellText(record, visitationColumn)
    if (raw && (REACH_VISITATION_STATUSES as readonly string[]).includes(raw)) {
      const status = raw as ReachVisitationStatus
      counts.set(status, (counts.get(status) ?? 0) + 1)
    }
  }
  return REACH_VISITATION_STATUSES.map((category) => ({ category, count: counts.get(category) ?? 0 }))
}

export interface GroupVisitationEntry {
  group: string
  Visited: number
  'Not Visited': number
  total: number
}

// Visited/Not Visited breakdown grouped by an arbitrary admin-level column —
// the REACH page's state -> LGA -> ward drill-down calls this once per
// level, always against `records` already scoped (by the caller) down to
// the current selection, so the bare column value (state name, or LGA name,
// or ward name) is unambiguous at each level without needing lgaKey/wardKey's
// composite disambiguation — that's only needed when comparing across the
// whole unscoped dataset (see totalLgas/totalWards in ReachAnalysisPage).
export function computeVisitationByGroup(
  records: ReachRecord[],
  groupColumn: string | null,
  visitationColumn = 'status',
): GroupVisitationEntry[] {
  if (!groupColumn) return []
  const byGroup = new Map<string, GroupVisitationEntry>()
  for (const record of records) {
    const group = cellText(record, groupColumn)
    if (!group) continue
    if (!byGroup.has(group)) byGroup.set(group, { group, Visited: 0, 'Not Visited': 0, total: 0 })
    const entry = byGroup.get(group)!
    entry.total += 1
    const status = cellText(record, visitationColumn)
    if (status === 'Visited' || status === 'Not Visited') entry[status] += 1
  }
  return Array.from(byGroup.values()).sort((a, b) => b.total - a.total)
}

// ---- validation sources ----
export interface SourceCount {
  source: string
  count: number
}

// toolbox/triangulate/ttools.py::populate_sources joins with " | " (space,
// pipe, space) — split on that exact separator rather than a bare "|" so a
// source name is never left with stray leading/trailing whitespace.
export function computeSourceCounts(records: ReachRecord[], sourcesColumn = 'sources'): SourceCount[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    const raw = cellText(record, sourcesColumn)
    // '0' is populate_sources' own sentinel for "no confirming sources" (the
    // same rows where `reach` is 0) — not a real source name. Without this
    // guard those rows would be split and counted as a fake source literally
    // named "0".
    if (!raw || raw === '0') continue
    for (const source of raw.split(' | ')) {
      const trimmed = source.trim()
      if (trimmed) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
}

// ---- population / potentially-missed children ----
export interface PopulationSummary {
  totalPopulation: number
  missedPopulation: number
  visitedPopulation: number
  settlementsWithPopulation: number
}

// "Missed children" = the population figure summed across settlements whose
// `status` came back 'Not Visited' — no backend endpoint computes this,
// it's derived client-side from whatever population column
// utils/columns.ts::detectColumns finds (may be null — see that file's
// caveat on this specific field).
export function computePopulationSummary(
  records: ReachRecord[],
  populationColumn: string | null,
  visitationColumn = 'status',
): PopulationSummary | null {
  if (!populationColumn) return null
  let totalPopulation = 0
  let missedPopulation = 0
  let settlementsWithPopulation = 0
  for (const record of records) {
    const pop = toNumber(record[populationColumn])
    if (pop === null) continue
    settlementsWithPopulation += 1
    totalPopulation += pop
    if (cellText(record, visitationColumn) === 'Not Visited') missedPopulation += pop
  }
  return {
    totalPopulation,
    missedPopulation,
    visitedPopulation: totalPopulation - missedPopulation,
    settlementsWithPopulation,
  }
}

export interface GroupPopulationEntry {
  group: string
  missed: number
  total: number
}

export function computeMissedPopulationByGroup(
  records: ReachRecord[],
  populationColumn: string | null,
  groupColumn: string | null,
  visitationColumn = 'status',
): GroupPopulationEntry[] {
  if (!populationColumn || !groupColumn) return []
  const byGroup = new Map<string, GroupPopulationEntry>()
  for (const record of records) {
    const key = cellText(record, groupColumn)
    if (!key) continue
    const pop = toNumber(record[populationColumn])
    if (pop === null) continue
    if (!byGroup.has(key)) byGroup.set(key, { group: key, missed: 0, total: 0 })
    const entry = byGroup.get(key)!
    entry.total += pop
    if (cellText(record, visitationColumn) === 'Not Visited') entry.missed += pop
  }
  return Array.from(byGroup.values()).sort((a, b) => b.missed - a.missed)
}

// ---- reach (corroboration count) ----
export interface ReachCountEntry {
  reach: number
  count: number
}

// Buckets settlements by their `reach` value — the number of independent
// data sources that corroborated each settlement (0-3 in the current
// pipeline: eTally/MST/GTS — see toolbox/triangulate/ttools.py::
// populate_sources/evaluate_reach). `status` above is fully derived from
// this (reach===0 -> 'Not Visited', reach>=1 -> 'Visited'), and it always
// equals the number of ' | '-joined tokens in `sources` for that row — see
// computeSourceCounts. Returned in ascending reach order, one entry per
// distinct value actually observed (not hardcoded to 0-3, in case a future
// data source pushes the max higher).
export function computeReachCounts(records: ReachRecord[], reachColumn = 'reach'): ReachCountEntry[] {
  const counts = new Map<number, number>()
  for (const record of records) {
    const reach = toNumber(record[reachColumn])
    if (reach === null) continue
    counts.set(reach, (counts.get(reach) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([reach, count]) => ({ reach, count }))
}

// ---- accessibility status ----

// The real sample export has this column's values under inconsistent
// casing ("Inaccessible" vs "inaccessible") — trim + case-fold before
// matching against the canonical three, so those don't get split into
// separate buckets. Returns null for anything that doesn't match one of the
// three (rather than guessing), so callers can decide how to handle an
// unrecognized value instead of it being silently miscounted.
export function normalizeAccessibility(raw: string | null): AccessibilityStatus | null {
  if (!raw) return null
  const lower = raw.trim().toLowerCase()
  return ACCESSIBILITY_STATUSES.find((status) => status.toLowerCase() === lower) ?? null
}

export interface GroupAccessibilityEntry {
  group: string
  'Fully Accessible': number
  'Partially Accessible': number
  Inaccessible: number
  total: number
}

// Accessibility-status breakdown grouped by an arbitrary admin-level column
// — same shape as computeVisitationByGroup above (one entry per group value,
// a running count per category, sorted by total descending), with three
// categories instead of two. Same scoped-by-caller contract as
// computeVisitationByGroup: pass already-drilled-down `records` and the
// column for the CURRENT level (state, then LGA, then ward).
export function computeAccessibilityByGroup(
  records: ReachRecord[],
  groupColumn: string | null,
  accessibilityColumn: string | null,
): GroupAccessibilityEntry[] {
  if (!groupColumn || !accessibilityColumn) return []
  const byGroup = new Map<string, GroupAccessibilityEntry>()
  for (const record of records) {
    const group = cellText(record, groupColumn)
    if (!group) continue
    if (!byGroup.has(group)) {
      byGroup.set(group, { group, 'Fully Accessible': 0, 'Partially Accessible': 0, Inaccessible: 0, total: 0 })
    }
    const entry = byGroup.get(group)!
    entry.total += 1
    const status = normalizeAccessibility(cellText(record, accessibilityColumn))
    if (status) entry[status] += 1
  }
  return Array.from(byGroup.values()).sort((a, b) => b.total - a.total)
}

export interface AccessibilityCountEntry {
  category: AccessibilityStatus
  count: number
}

// Overall (not per-state) accessibility totals, for a quick-scan stat-card
// row above the by-state chart — same pairing as ReachVisitationCards +
// LgaVisitationChart for status.
export function computeAccessibilityCounts(
  records: ReachRecord[],
  accessibilityColumn: string | null,
): AccessibilityCountEntry[] {
  const counts = new Map<AccessibilityStatus, number>(ACCESSIBILITY_STATUSES.map((s) => [s, 0]))
  if (!accessibilityColumn) return ACCESSIBILITY_STATUSES.map((category) => ({ category, count: 0 }))
  for (const record of records) {
    const status = normalizeAccessibility(cellText(record, accessibilityColumn))
    if (status) counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return ACCESSIBILITY_STATUSES.map((category) => ({ category, count: counts.get(category) ?? 0 }))
}
