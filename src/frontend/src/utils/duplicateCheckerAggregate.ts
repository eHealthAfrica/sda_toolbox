import type { DuplicateCheckerRecord, ReviewOutcome } from '../types/duplicateChecker'
import { REVIEW_OUTCOME_ORDER } from '../types/duplicateChecker'

export interface GeographyCoverage {
  states: number
  lgas: number
  wards: number
  settlements: number
}

// Distinct-value counts, each scoped by the admin level(s) above it (an LGA
// name alone isn't unique across states, same reasoning H2H/MLoS QC's own
// countUniqueValues callers rely on — just composed by hand here since this
// result's columns are fixed rather than fuzzy-detected, so there's no
// DetectedColumns indirection needed). "Settlements reviewed" counts every
// distinct settlement name appearing in EITHER side of a pair (settlement 1
// or settlement 2), within its own ward — the same settlement name showing
// up in two different pairs only counts once.
export function computeGeographyCoverage(records: DuplicateCheckerRecord[]): GeographyCoverage {
  const states = new Set<string>()
  const lgas = new Set<string>()
  const wards = new Set<string>()
  const settlements = new Set<string>()
  for (const r of records) {
    if (!r.state) continue
    states.add(r.state)
    lgas.add(`${r.state}|${r.lga}`)
    wards.add(`${r.state}|${r.lga}|${r.ward}`)
    settlements.add(`${r.state}|${r.lga}|${r.ward}|${r['settlement 1']}`)
    settlements.add(`${r.state}|${r.lga}|${r.ward}|${r['settlement 2']}`)
  }
  return { states: states.size, lgas: lgas.size, wards: wards.size, settlements: settlements.size }
}

export interface ReviewOutcomeCounts {
  total: number
  byOutcome: Record<ReviewOutcome, number>
}

export function computeReviewOutcomeCounts(records: DuplicateCheckerRecord[]): ReviewOutcomeCounts {
  const byOutcome = Object.fromEntries(REVIEW_OUTCOME_ORDER.map((o) => [o, 0])) as Record<ReviewOutcome, number>
  for (const r of records) {
    if (r.review in byOutcome) byOutcome[r.review as ReviewOutcome] += 1
  }
  return { total: records.length, byOutcome }
}

export interface DuplicateGroupBreakdownEntry {
  group: string
  remove: number
  review: number
  unlikely: number
  total: number
}

// Per-group (state/LGA/ward, whichever the current drill level is) stacked
// breakdown across the three review outcomes — every row in this result is
// already a flagged pair (there's no "unflagged" baseline the way MLoS QC's
// is_flagged column has one), so the useful split here is BY outcome rather
// than a single flagged/total count.
export function computeDuplicateGroupBreakdown(
  records: DuplicateCheckerRecord[],
  groupColumn: 'state' | 'lga' | 'ward',
): DuplicateGroupBreakdownEntry[] {
  const byGroup = new Map<string, DuplicateGroupBreakdownEntry>()
  for (const r of records) {
    const raw = r[groupColumn]
    if (!raw) continue
    const group = String(raw).trim()
    if (!byGroup.has(group)) byGroup.set(group, { group, remove: 0, review: 0, unlikely: 0, total: 0 })
    const entry = byGroup.get(group)!
    entry.total += 1
    if (r.review === 'Duplicate Remove') entry.remove += 1
    else if (r.review === 'Duplicate Review') entry.review += 1
    else entry.unlikely += 1
  }
  return Array.from(byGroup.values()).sort((a, b) => b.total - a.total)
}

export function uniqueFieldValues(records: DuplicateCheckerRecord[], field: 'state' | 'lga' | 'ward'): string[] {
  const values = new Set<string>()
  for (const r of records) {
    const raw = r[field]
    if (raw) values.add(String(raw).trim())
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

// Distance formatting shared by the table and any tooltip that shows it —
// null (missing/invalid coordinates, see types/duplicateChecker.ts) reads as
// an em dash rather than "0m" or "NaN".
export function formatDistance(distance: number | null): string {
  if (distance === null || distance === undefined) return '—'
  if (distance < 1000) return `${Math.round(distance)} m`
  return `${(distance / 1000).toFixed(1)} km`
}

// Presentation mapping for the review outcome badge shown per row — colors
// intentionally read as severity (Remove = critical/red, Review = warning/
// amber, Unlikely = good/green) since an "Unlikely Potential Duplicate" is
// the LEAST concerning of the three outcomes, not a middle ground.
export function reviewBadge(review: string): { label: string; bg: string; color: string } {
  if (review === 'Duplicate Remove') return { label: 'Remove', bg: '#fdeceb', color: 'var(--color-critical)' }
  if (review === 'Duplicate Review') return { label: 'Review', bg: '#fff6e0', color: '#8a5a00' }
  return { label: 'Unlikely', bg: '#e8f8e8', color: 'var(--color-good)' }
}
