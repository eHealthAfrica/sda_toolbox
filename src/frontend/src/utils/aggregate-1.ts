import type {
  SettlementCoverageCategory,
  SettlementRecord,
  VisitationStatus,
} from '../types/h2h'
import { COVERAGE_ORDER, VISITATION_ORDER } from './colors'
import { toNumber } from './columns'

export interface CountEntry<T extends string = string> {
  category: T
  count: number
}

function normalizedCategory<T extends string>(raw: unknown, valid: readonly T[]): T | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return (valid as readonly string[]).includes(trimmed) ? (trimmed as T) : null
}

export function countByCategory<T extends string>(
  records: SettlementRecord[],
  column: string,
  order: readonly T[],
): CountEntry<T>[] {
  const counts = new Map<T, number>(order.map((c) => [c, 0]))
  for (const record of records) {
    const category = normalizedCategory<T>(record[column], order)
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return order.map((category) => ({ category, count: counts.get(category) ?? 0 }))
}

export function computeVisitationCounts(
  records: SettlementRecord[],
  cumColumn: string,
  order: readonly VisitationStatus[] = VISITATION_ORDER,
): CountEntry<VisitationStatus>[] {
  return countByCategory(records, cumColumn, order)
}

export function computeCoverageCounts(
  records: SettlementRecord[],
  coverageColumn = 'Settlement Coverage',
): CountEntry<SettlementCoverageCategory>[] {
  return countByCategory(records, coverageColumn, COVERAGE_ORDER)
}

export interface LgaBreakdownEntry {
  lga: string
  count: number
}

export function computeLgaBreakdown(
  records: SettlementRecord[],
  lgaColumn: string,
): LgaBreakdownEntry[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    const raw = record[lgaColumn]
    if (raw === null || raw === undefined || raw === '') continue
    const lga = String(raw).trim()
    counts.set(lga, (counts.get(lga) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([lga, count]) => ({ lga, count }))
    .sort((a, b) => b.count - a.count)
}

export interface StateBreakdownEntry {
  state: string
  count: number
}

// Same flat group-and-count as computeLgaBreakdown above, one level up the
// admin hierarchy — used by Compiler Tracks' "Tracks by State" chart
// (components/compilerTracks/TracksStateChart.tsx).
export function computeStateBreakdown(
  records: SettlementRecord[],
  stateColumn: string,
): StateBreakdownEntry[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    const raw = record[stateColumn]
    if (raw === null || raw === undefined || raw === '') continue
    const state = String(raw).trim()
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count)
}

export interface StateVisitationEntry {
  state: string
  Visited: number
  'Not Yet Visited': number
  'Not Visited': number
  total: number
}

export function computeStateVisitation(
  records: SettlementRecord[],
  stateColumn: string,
  cumColumn: string,
): StateVisitationEntry[] {
  const byState = new Map<string, StateVisitationEntry>()
  for (const record of records) {
    const raw = record[stateColumn]
    if (raw === null || raw === undefined || raw === '') continue
    const state = String(raw).trim()

    if (!byState.has(state)) {
      byState.set(state, { state, Visited: 0, 'Not Yet Visited': 0, 'Not Visited': 0, total: 0 })
    }
    const entry = byState.get(state)!
    entry.total += 1

    const status = normalizedCategory<VisitationStatus>(record[cumColumn], VISITATION_ORDER)
    if (status) entry[status] += 1
  }
  return Array.from(byState.values()).sort((a, b) => b.total - a.total)
}

// Generic distinct-value count — used for "total states" on the H2H page
// (which can span several) and "total LGAs" on the MLoS QC page (which runs
// one state at a time, so a states count there would always read 1).
export function countUniqueValues(records: SettlementRecord[], column: string): number {
  const values = new Set<string>()
  for (const record of records) {
    const raw = record[column]
    if (raw !== null && raw !== undefined && raw !== '') values.add(String(raw).trim())
  }
  return values.size
}

// Same distinct-value scan as countUniqueValues, but returns the values
// themselves (sorted) rather than just the count — used to build the
// State/LGA/Ward filter dropdown options on H2HTrackingPage/
// SettlementListTable. `column` accepts null so callers can pass a
// DetectedColumns field straight through (e.g. columns.ward may not have
// been detected) without an extra guard at every call site.
export function uniqueColumnValues(records: SettlementRecord[], column: string | null): string[] {
  if (!column) return []
  const values = new Set<string>()
  for (const record of records) {
    const raw = record[column]
    if (raw !== null && raw !== undefined && raw !== '') values.add(String(raw).trim())
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

// Used by the H2H page's state/LGA drill-down to scope records to whatever
// was picked — `column` accepts null the same way uniqueColumnValues does
// (a not-yet-detected column never matches anything, rather than throwing).
export function matchesColumnValue(record: SettlementRecord, column: string | null, value: string): boolean {
  if (!column) return false
  const raw = record[column]
  if (raw === null || raw === undefined || raw === '') return false
  return String(raw).trim() === value
}

export interface StateCoverageEntry {
  state: string
  'Fully Covered': number
  'Partially Covered': number
  'Poorly Covered': number
  'No Coverage': number
  total: number
}

// Same per-group tally as computeStateVisitation above, one column
// (Settlement Coverage) instead of two — feeds StateCoverageChart, which
// H2HTrackingPage also drills from "by state" down to "by LGA"/"by ward" by
// passing a different groupColumn, so the "state" field name in the
// returned entries is literal only at the top drill level (see that
// component's own comment).
export function computeStateCoverage(
  records: SettlementRecord[],
  stateColumn: string,
  coverageColumn = 'Settlement Coverage',
): StateCoverageEntry[] {
  const byState = new Map<string, StateCoverageEntry>()
  for (const record of records) {
    const raw = record[stateColumn]
    if (raw === null || raw === undefined || raw === '') continue
    const state = String(raw).trim()

    if (!byState.has(state)) {
      byState.set(state, {
        state,
        'Fully Covered': 0,
        'Partially Covered': 0,
        'Poorly Covered': 0,
        'No Coverage': 0,
        total: 0,
      })
    }
    const entry = byState.get(state)!
    entry.total += 1

    const category = normalizedCategory<SettlementCoverageCategory>(record[coverageColumn], COVERAGE_ORDER)
    if (category) entry[category] += 1
  }
  return Array.from(byState.values()).sort((a, b) => b.total - a.total)
}

// toolbox/campaign/visitation_analysis.py writes 'time_spent_mins' onto every
// row (= that settlement's track_count, i.e. minutes of GPS track coverage)
// alongside the bucketed 'Time Spent' string SettlementListTable already
// shows (classify_time_spent, campaign_tools.py) — this sums the raw minutes
// for a "Total time spent" title card, something the bucketed column can't
// give you. Not every row has a track — toNumber returns null for those and
// they're skipped rather than counted as 0, though the numeric result is the
// same either way.
export function computeTotalTimeSpent(records: SettlementRecord[], column = 'time_spent_mins'): number {
  let total = 0
  for (const record of records) {
    const minutes = toNumber(record[column])
    if (minutes !== null) total += minutes
  }
  return total
}

// Formats a raw minute count as "Xh Ym" (or just "Ym" under an hour) for the
// time-spent title card — matching formatDuration's style elsewhere in the
// app (DashboardPage.tsx) without pulling in its ms-based variant.
export function formatMinutesSpent(totalMinutes: number): string {
  const whole = Math.round(totalMinutes)
  const hours = Math.floor(whole / 60)
  const minutes = whole % 60
  if (hours <= 0) return `${minutes.toLocaleString()}m`
  return `${hours.toLocaleString()}h ${minutes}m`
}

export interface MapPoint {
  latitude: number
  longitude: number
  status: VisitationStatus | 'Unknown'
  coverage: SettlementCoverageCategory | null
  settlement: string | null
  lga: string | null
  ward: string | null
  state: string | null
}

export function buildMapPoints(
  records: SettlementRecord[],
  latColumn: string,
  lonColumn: string,
  cumColumn: string,
  settlementColumn: string | null,
  lgaColumn: string | null,
  wardColumn: string | null,
  stateColumn: string | null,
  coverageColumn = 'Settlement Coverage',
): MapPoint[] {
  const points: MapPoint[] = []
  for (const record of records) {
    const latitude = toNumber(record[latColumn])
    const longitude = toNumber(record[lonColumn])
    if (latitude === null || longitude === null) continue
    // Basic sanity bounds — drop obviously invalid/placeholder coordinates
    // (e.g. 0,0) rather than plotting them in the Gulf of Guinea.
    if (latitude === 0 && longitude === 0) continue
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue

    const status = normalizedCategory<VisitationStatus>(record[cumColumn], VISITATION_ORDER)
    const coverage = normalizedCategory<SettlementCoverageCategory>(record[coverageColumn], COVERAGE_ORDER)
    points.push({
      latitude,
      longitude,
      status: status ?? 'Unknown',
      coverage,
      settlement: settlementColumn ? (record[settlementColumn] as string) ?? null : null,
      lga: lgaColumn ? (record[lgaColumn] as string) ?? null : null,
      ward: wardColumn ? (record[wardColumn] as string) ?? null : null,
      state: stateColumn ? (record[stateColumn] as string) ?? null : null,
    })
  }
  return points
}
