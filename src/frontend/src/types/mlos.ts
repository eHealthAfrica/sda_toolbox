// Mirrors toolbox/mlos/validation/review/run_validate.py + prefilter.py — the
// validation_status column written onto every row of the QC'ed MLoS CSV.
// 'Validated Unknown' is set upfront for rows where is_invalid is True
// (settlement name/attributes too malformed to even run QC on); the other
// three come out of evaluate_settlement_validation() for everything else.
export const VALIDATION_STATUS_ORDER = [
  'Validated',
  'Validation Ongoing',
  'Validated Unknown',
  'Not Validated',
] as const
export type ValidationStatus = (typeof VALIDATION_STATUS_ORDER)[number]

export interface QcFormInput {
  mlosFile: File | null
  standardize: boolean
  consistency: boolean
  deepSearch: boolean
}

// One row of the CSV returned by POST /qc/validation. Like the H2H
// settlements CSV, most column names come from whatever the uploaded MLoS
// file used — only the columns the backend itself always writes
// (validation_status, is_flagged, the issue-flag columns below) are fixed.
export type MlosRecord = Record<string, string | number | null>

export interface ParsedMlosResult {
  records: MlosRecord[]
  columns: string[]
  sourceFilename: string
}

// toolbox/apps/mlos/qc_mlos.py::flag_settlements sets is_flagged when ANY QC
// check column on a row is non-null. These five are the specific check
// columns the review asked to surface as their own cards — see
// toolbox/mlos/validation/review/spatial/spatial_checks.py (stacked_point,
// no_coordinates, boundary_issues), attributes/duplication.py
// (duplicate_attribute), and attributes/numeric.py (WE_set_target, set when
// `set_target` fails the numeric-entry check). Each column's cell value is a
// short message when the issue is present ("Wrong Entry", "No Coordinates",
// "Outside Ward"/"Outside LGA", ...) and empty otherwise — not a boolean.
export interface QcIssueFlag {
  key: string
  label: string
  hint: string
}

export const QC_ISSUE_FLAGS: QcIssueFlag[] = [
  { key: 'stacked_point', label: 'Stacked Points', hint: 'Settlements sharing (near-)identical coordinates' },
  { key: 'duplicate_attribute', label: 'Duplicate Attributes', hint: 'Duplicate unique codes / attribute values' },
  { key: 'no_coordinates', label: 'No Coordinates', hint: 'Missing latitude/longitude' },
  { key: 'boundary_issues', label: 'Boundary Issues', hint: 'Point falls outside its ward/LGA boundary' },
  { key: 'WE_set_target', label: 'Target Value Issues', hint: 'Non-numeric or invalid "set_target" entries' },
  // A refinement of stacked_point, not a duplicate of it: stacked_point (see
  // toolbox.fixers.shifter::flag_settlements_within_30m) first flags
  // settlements within 30m of another point at all; proximity_issues (see
  // toolbox/mlos/validation/review/spatial/spatial_checks.py::
  // proximity_analysis/evaluate_proximity) then re-checks each flagged point
  // against every OTHER settlement's nearest point, confirms it's genuinely
  // a different settlement (not itself), and classifies exactly how close —
  // the cell holds a distance bucket ("Within 10m" / "Within 20m" / "Within
  // 30m") rather than a fixed message, but is_flagged-style presence still
  // applies for the count here.
  { key: 'proximity_issues', label: 'Proximity Issues', hint: 'Within 10–30m of a different settlement' },
]
