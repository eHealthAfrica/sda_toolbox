export interface CoordinateReviewFormInput {
  settlementsFile: File | null
  sourcesFile: File | null
  tracksFile: File | null
  // New backend parameter (coord_review.py's `use_osm: bool`, required, no
  // default) — set to true to fold OpenStreetMap in as an additional source
  // alongside whatever sheets the uploaded `sources` workbook contains. When
  // on, the returned CSV simply carries one more `osm_*` 6-column evidence
  // group like any other detected source (see utils/coordinateReviewAggregate
  // .ts::detectSourceNames) — no special-casing needed on this side.
  useOsm: boolean
}

// One row of the CSV returned by POST /coordinate_review/
// (toolbox/apps/mlos/coord_review.py). Baseline columns are whatever the
// uploaded settlements file's own columns were — coordinate_reviewer.py
// echoes settlements.columns.tolist() straight through, NOT a fixed schema —
// same situation as MlosRecord in types/mlos.ts. Per matched source (one
// sheet in the uploaded `sources` workbook = one source), six more columns
// are appended: `{source}_similarity` (fuzz.partial_ratio name match,
// 0–100), `{source}_latitude` / `{source}_longitude` (the matched source's
// own coordinates), `{source}_distance` (geodesic meters from the baseline
// point — NOT source-to-source), `{source}_grid3` (bool — inside a GRID3
// settlement-extent polygon), `{source}_near_tracks` (bool — within a
// ~300m decimal-degree buffer of the uploaded tracks). A source that didn't
// match this row (similarity < 95, or failed the ward/LGA prefilter) gets
// blank/NaN in all six of its columns for that row. Booleans arrive as the
// literal strings "True"/"False" (pandas' own to_csv rendering) rather than
// JSON booleans — see utils/coordinateReviewAggregate.ts's toBool.
export type CoordinateReviewRecord = Record<string, string | number | boolean | null>

export interface ParsedCoordinateReviewResult {
  records: CoordinateReviewRecord[]
  columns: string[]
  // Source names detected from the header (see
  // utils/coordinateReviewAggregate.ts::detectSourceNames) — one per sheet in
  // the uploaded sources workbook, in column order. Dynamic: a different
  // upload produces a different list, unlike Duplicate Checker's fixed
  // columns.
  sourceNames: string[]
  sourceFilename: string
}

// A record carrying its own position in the ORIGINAL parsed result — the
// stable key the decision workflow and CSV export key off, same convention
// as Duplicate Checker's IndexedDuplicateRecord.
export interface IndexedCoordinateRecord extends CoordinateReviewRecord {
  __idx: number
}

export interface SourceEvidence {
  similarity: number
  latitude: number
  longitude: number
  distance: number
  grid3: boolean
  near_tracks: boolean
}

// The frontend's OWN read of "do two or more sources agree with each
// other" — there is no backend concept of this at all.
// coordinate_reviewer.py only ever compares each source against the
// baseline point, never sources against one another. See AGREEMENT_RADIUS_M
// in utils/coordinateReviewAggregate.ts for why this stays a fixed constant
// rather than a user-facing control (removed from this page per direct
// request — these settings are not exposed to the end user).
export type AgreementStatus = 'consistent' | 'review' | 'none'

export interface RowAgreement {
  status: AgreementStatus
  // Source names forming the largest mutually-agreeing group found (size
  // >= 2), or [] when status is 'none'.
  cluster: string[]
  centroid: { latitude: number; longitude: number } | null
  // Distance in meters from the baseline point to the cluster's centroid —
  // null when status is 'none' (no cluster to measure against) or when the
  // baseline itself has no usable coordinates.
  distanceFromBaseline: number | null
}

// Client-side-only decision, same convention as Duplicate Checker's
// ReviewDecision (types/duplicateChecker.ts) — there is no PATCH/decision
// endpoint on the backend for this tool either, so nothing here is ever
// sent back to the server. Either one of the two fixed values below, or a
// source name (adopt that source's own coordinate).
export const DECISION_KEEP = 'keep'
export const DECISION_CENTROID = 'centroid'
export const DECISION_MANUAL = 'manual'
export type CoordinateDecision = string
