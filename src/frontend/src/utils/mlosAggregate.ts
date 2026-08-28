import type { MlosRecord, QcIssueFlag, ValidationStatus } from '../types/mlos'
import { VALIDATION_STATUS_ORDER } from '../types/mlos'
import { countByCategory } from './aggregate'
import type { CountEntry } from './aggregate'

export function computeValidationStatusCounts(records: MlosRecord[]): CountEntry<ValidationStatus>[] {
  return countByCategory(records, 'validation_status', VALIDATION_STATUS_ORDER)
}

// The QC issue-flag columns (stacked_point, duplicate_attribute, ...) and
// is_flagged are "presence flags", not a fixed status enum: a check column
// holds a short message when that issue is present on the row and is empty
// otherwise (see toolbox/apps/mlos/qc_mlos.py::flag_settlements), so "is this
// row flagged" is just "is the cell non-empty", not a value-set match.
function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

export function countFlagged(records: MlosRecord[], column = 'is_flagged'): number {
  return records.reduce((sum, record) => sum + (isPresent(record[column]) ? 1 : 0), 0)
}

export interface IssueFlagCount {
  key: string
  label: string
  hint: string
  count: number
}

export function computeIssueFlagCounts(records: MlosRecord[], flags: QcIssueFlag[]): IssueFlagCount[] {
  return flags.map((flag) => ({
    ...flag,
    count: records.reduce((sum, record) => sum + (isPresent(record[flag.key]) ? 1 : 0), 0),
  }))
}

export interface GroupFlagBreakdownEntry {
  group: string
  flagged: number
  total: number
}

// Generic "flagged count by X" — used for LGA on the MLoS QC page. Not named
// for state specifically because /qc/validation takes one state per run (see
// toolbox/apps/mlos/qc_mlos.py — `state: State`, singular), so a per-state
// breakdown of a single QC result would always be one bar; LGA is the
// grouping that's actually useful at this endpoint's granularity.
export function computeGroupFlagBreakdown(
  records: MlosRecord[],
  groupColumn: string,
  flaggedColumn = 'is_flagged',
): GroupFlagBreakdownEntry[] {
  const byGroup = new Map<string, GroupFlagBreakdownEntry>()
  for (const record of records) {
    const raw = record[groupColumn]
    if (raw === null || raw === undefined || raw === '') continue
    const group = String(raw).trim()

    if (!byGroup.has(group)) byGroup.set(group, { group, flagged: 0, total: 0 })
    const entry = byGroup.get(group)!
    entry.total += 1
    if (isPresent(record[flaggedColumn])) entry.flagged += 1
  }
  return Array.from(byGroup.values()).sort((a, b) => b.flagged - a.flagged)
}

export interface ProximityBreakdownEntry {
  bucket: string
  count: number
}

// The proximity_issues column (see types/mlos.ts's QC_ISSUE_FLAGS comment)
// holds one of three fixed distance-bucket strings when present — not an
// open-ended group like LGA/state — so this always returns one entry per
// bucket, near-to-far, even when a bucket has zero hits, rather than a
// Map keyed by whatever values happen to show up in the data.
export const PROXIMITY_BUCKET_ORDER = ['Within 10m', 'Within 20m', 'Within 30m'] as const

export function computeProximityBreakdown(
  records: MlosRecord[],
  column = 'proximity_issues',
): ProximityBreakdownEntry[] {
  const counts = new Map<string, number>(PROXIMITY_BUCKET_ORDER.map((bucket) => [bucket, 0]))
  for (const record of records) {
    const raw = record[column]
    if (!isPresent(raw)) continue
    const value = String(raw).trim()
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return PROXIMITY_BUCKET_ORDER.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }))
}

export interface StateFlagBreakdownEntry {
  state: string
  flagged: number
  total: number
}

// Per-state flagged-count breakdown for StateFlagBreakdownChart. Kept
// separate from computeGroupFlagBreakdown (used for LGA) even though the
// logic is identical, since /qc/validation runs one state at a time (see
// toolbox/apps/mlos/qc_mlos.py — `state: State`, singular) — a per-state
// breakdown of a single QC result is usually a single bar, but the function
// still needs to exist and work correctly for whatever composes results
// across multiple QC runs.
export function computeStateFlagBreakdown(
  records: MlosRecord[],
  stateColumn: string,
  flaggedColumn = 'is_flagged',
): StateFlagBreakdownEntry[] {
  const byState = new Map<string, StateFlagBreakdownEntry>()
  for (const record of records) {
    const raw = record[stateColumn]
    if (raw === null || raw === undefined || raw === '') continue
    const state = String(raw).trim()

    if (!byState.has(state)) byState.set(state, { state, flagged: 0, total: 0 })
    const entry = byState.get(state)!
    entry.total += 1
    if (isPresent(record[flaggedColumn])) entry.flagged += 1
  }
  return Array.from(byState.values()).sort((a, b) => b.flagged - a.flagged)
}
