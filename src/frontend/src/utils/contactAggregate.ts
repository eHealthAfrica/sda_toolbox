import type { ContactRecord, SettlementCoverageCategory } from '../types/contactAnalysis'
import { SETTLEMENT_COVERAGE_CATEGORIES } from '../types/contactAnalysis'
import { toNumber } from './columns'

export function cellText(record: ContactRecord, column: string | null): string | null {
  if (!column) return null
  const raw = record[column]
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  return String(raw).trim()
}

// ---- unique state/LGA/ward counting ----
//
// Same composite-key disambiguation as REACH's utils/reachAggregate.ts
// (lgaKey/wardKey there) — an LGA or ward name can repeat across different
// parent admin levels, so counting/grouping by the bare name alone would
// silently merge distinct places.
export function lgaKey(record: ContactRecord, stateCol: string | null, lgaCol: string | null): string | null {
  const state = cellText(record, stateCol)
  const lga = cellText(record, lgaCol)
  if (!lga) return null
  return state ? `${state} | ${lga}` : lga
}

export function wardKey(
  record: ContactRecord,
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

export function countUniqueKeys(records: ContactRecord[], keyFn: (r: ContactRecord) => string | null): number {
  const seen = new Set<string>()
  for (const record of records) {
    const key = keyFn(record)
    if (key) seen.add(key)
  }
  return seen.size
}

export function countUniqueColumn(records: ContactRecord[], column: string | null): number {
  if (!column) return 0
  const seen = new Set<string>()
  for (const record of records) {
    const value = cellText(record, column)
    if (value) seen.add(value)
  }
  return seen.size
}

// ---- round columns ----
//
// The response has no fixed, named set of round columns — each one is named
// after whatever sheet name the uploaded previous_campaign_file workbook
// used for that round (see types/contactAnalysis.ts's top comment), so the
// only reliable way to recover the round list client-side is to look at
// which columns actually hold the round vocabulary
// (Visited/Not Visited/Not Found) rather than guessing names. `columns` is
// PapaParse's field list, which preserves the CSV's own header order — so
// the returned list is in the same left-to-right order the backend wrote
// them, not alphabetical.
const ROUND_VALUES = new Set(['visited', 'not visited', 'not found'])
const NEVER_ROUND_COLUMNS = new Set(['contact', 'contact_proportion', 'coverage', 'settlement_id', 'unique_code'])

export function detectRoundColumns(
  records: ContactRecord[],
  columns: string[],
  excludeColumns: (string | null)[],
): string[] {
  const excluded = new Set(excludeColumns.filter((c): c is string => Boolean(c)).map((c) => c.toLowerCase()))

  return columns.filter((col) => {
    const lower = col.toLowerCase()
    if (excluded.has(lower) || NEVER_ROUND_COLUMNS.has(lower)) return false

    let sawValue = false
    for (const record of records) {
      const raw = cellText(record, col)
      if (raw === null) continue
      if (!ROUND_VALUES.has(raw.toLowerCase())) return false
      sawValue = true
    }
    return sawValue
  })
}

// ---- contact (rounds visited) ----
export interface ContactCountEntry {
  contact: number
  count: number
}

// Buckets settlements by their `contact` value (evaluate_settlement_contacts
// — count of rounds recorded 'Visited' for that settlement). Returned in
// ascending order, one entry per distinct value actually observed, same
// "don't hardcode the range" approach as REACH's computeReachCounts — the
// real ceiling is however many round columns this particular upload had
// (see detectRoundColumns), not a fixed 0-3.
export function computeContactCounts(records: ContactRecord[], contactColumn = 'contact'): ContactCountEntry[] {
  const counts = new Map<number, number>()
  for (const record of records) {
    const contact = toNumber(record[contactColumn])
    if (contact === null) continue
    counts.set(contact, (counts.get(contact) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([contact, count]) => ({ contact, count }))
}

export interface GroupContactEntry {
  group: string
  avgContact: number
  total: number
}

// Average `contact` per group at the page's current drill level (state,
// then LGA within the selected state, then ward within the selected LGA) —
// `records` is expected to already be scoped to that level by the caller,
// same contract as REACH's computeVisitationByGroup.
export function computeContactByGroup(
  records: ContactRecord[],
  groupColumn: string | null,
  contactColumn = 'contact',
): GroupContactEntry[] {
  if (!groupColumn) return []
  const sums = new Map<string, { sum: number; count: number }>()
  for (const record of records) {
    const group = cellText(record, groupColumn)
    if (!group) continue
    const contact = toNumber(record[contactColumn])
    if (contact === null) continue
    if (!sums.has(group)) sums.set(group, { sum: 0, count: 0 })
    const entry = sums.get(group)!
    entry.sum += contact
    entry.count += 1
  }
  return Array.from(sums.entries())
    .map(([group, { sum, count }]) => ({ group, avgContact: count > 0 ? sum / count : 0, total: count }))
    .sort((a, b) => b.total - a.total)
}

// ---- coverage ----
export interface CoverageCountEntry {
  category: SettlementCoverageCategory
  count: number
}

export function computeCoverageCounts(records: ContactRecord[], coverageColumn = 'coverage'): CoverageCountEntry[] {
  const counts = new Map<SettlementCoverageCategory, number>(SETTLEMENT_COVERAGE_CATEGORIES.map((c) => [c, 0]))
  for (const record of records) {
    const raw = cellText(record, coverageColumn)
    if (raw && (SETTLEMENT_COVERAGE_CATEGORIES as readonly string[]).includes(raw)) {
      const category = raw as SettlementCoverageCategory
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  return SETTLEMENT_COVERAGE_CATEGORIES.map((category) => ({ category, count: counts.get(category) ?? 0 }))
}

export interface GroupCoverageEntry {
  group: string
  'Fully Covered': number
  'Partially Covered': number
  'Poorly Covered': number
  'No Coverage': number
  total: number
}

export function computeCoverageByGroup(
  records: ContactRecord[],
  groupColumn: string | null,
  coverageColumn = 'coverage',
): GroupCoverageEntry[] {
  if (!groupColumn) return []
  const byGroup = new Map<string, GroupCoverageEntry>()
  for (const record of records) {
    const group = cellText(record, groupColumn)
    if (!group) continue
    if (!byGroup.has(group)) {
      byGroup.set(group, {
        group,
        'Fully Covered': 0,
        'Partially Covered': 0,
        'Poorly Covered': 0,
        'No Coverage': 0,
        total: 0,
      })
    }
    const entry = byGroup.get(group)!
    entry.total += 1
    const raw = cellText(record, coverageColumn)
    if (raw && (SETTLEMENT_COVERAGE_CATEGORIES as readonly string[]).includes(raw)) {
      entry[raw as SettlementCoverageCategory] += 1
    }
  }
  return Array.from(byGroup.values()).sort((a, b) => b.total - a.total)
}

// Average `contact_proportion` across records that have one — a quick-scan
// companion to the average-contact chart, since a settlement can have a low
// contact_proportion despite a decent raw `contact` count if several rounds
// recorded it as 'Not Found' rather than 'Not Visited' (evaluate_contact_prop
// excludes 'Not Found' rounds from the denominator entirely — see
// types/contactAnalysis.ts).
export function computeAverageContactProportion(records: ContactRecord[], contactProportionColumn = 'contact_proportion'): number | null {
  let sum = 0
  let count = 0
  for (const record of records) {
    const value = toNumber(record[contactProportionColumn])
    if (value === null) continue
    sum += value
    count += 1
  }
  return count > 0 ? sum / count : null
}
