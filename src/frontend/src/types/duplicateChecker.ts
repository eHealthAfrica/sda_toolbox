export interface DuplicateCheckerFormInput {
  settlementsFile: File | null
  threshold: number
}

// Mirrors toolbox/mlos/validation/review/attributes/deep_search.py::
// review_ward_settlement_for_duplicates — the three possible values of the
// 'review' column. Verified against the real source (not just the sample
// CSV): a pair lands here based on geodesic distance between their
// coordinates —
//   - 'Duplicate Remove': distance <= 10m (or exactly 0, e.g. identical
//     coordinates) — near-certain the same place captured twice.
//   - 'Duplicate Review': 10m < distance < 65m, OR coordinates are missing/
//     invalid for one or both records so distance can't be computed at all
//     (geo_cols is None, or coords_are_valid fails) — needs a human look.
//   - 'Unlikely Potential Duplicate Review': distance > 65m, with no upper
//     bound — names scored similar, but far enough apart to likely be two
//     distinct settlements.
export const REVIEW_OUTCOME_ORDER = [
  'Duplicate Remove',
  'Duplicate Review',
  'Unlikely Potential Duplicate Review',
] as const
export type ReviewOutcome = (typeof REVIEW_OUTCOME_ORDER)[number]

// One row of the CSV returned by POST /duplicate-deep-search/
// (toolbox/apps/mlos/duplicate_checker.py). Column names/order are fixed by
// generate_mapping_table (deep_search.py) — NOT derived from whatever
// columns the uploaded settlement list used, unlike most other MLoS
// endpoints in this app. Note the column names carry a literal space
// ('settlement 1' / 'settlement 2'), matching the sample CSV and the
// backend's own DataFrame column labels.
export interface DuplicateCheckerRecord {
  state: string
  lga: string
  ward: string
  'settlement 1': string
  'settlement 2': string
  score: number
  // null when the backend couldn't compute a geodesic distance for this
  // pair (missing/invalid coordinates) — always paired with review ===
  // 'Duplicate Review' in that case, never a real 0.
  distance: number | null
  review: ReviewOutcome | string
}

export interface ParsedDuplicateCheckerResult {
  records: DuplicateCheckerRecord[]
  columns: string[]
  sourceFilename: string
}

// A record carrying its own position in the ORIGINAL parsed result (not
// whatever filtered/paginated slice it currently sits in) — the stable key
// the client-side decision workflow and the CSV export key off, since a
// state/lga/ward/settlement-pair tuple alone isn't guaranteed unique across
// a large result.
export interface IndexedDuplicateRecord extends DuplicateCheckerRecord {
  __idx: number
}

// Client-side-only review workflow — there is no PATCH/decision endpoint on
// the backend, so a decision here is never sent back to the server. It only
// controls what "Download results" excludes: a pair decided "Keep both"
// (both settlements are legitimate/distinct) is dropped from the exported
// CSV entirely, since it's a resolved false-positive, not a real duplicate
// needing further action. Pairs left undecided, or decided "Remove match"
// or "Field check", stay in the export, tagged with a decision column.
export const REVIEW_DECISIONS = ['keep', 'remove', 'field_check'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

export const DECISION_LABELS: Record<ReviewDecision, string> = {
  keep: 'Kept both',
  remove: 'Removed match',
  field_check: 'Flagged for check',
}

export const DECISION_COLORS: Record<ReviewDecision, string> = {
  keep: 'var(--color-text-secondary)',
  remove: 'var(--color-critical)',
  field_check: '#8a5a00',
}
