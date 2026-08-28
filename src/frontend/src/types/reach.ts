import { STATE_OPTIONS } from './h2h'
import type { StateName } from './h2h'

export { STATE_OPTIONS }
export type { StateName }

// Mirrors toolbox/models/__init__.py::TriangulationMethod. BOTH runs COORDS
// (spatial nearest-join against each data source's geometry) and SETTLEMENT
// (exact state/LGA/ward/settlement-code match) and unions the results — it's
// the backend's own default.
export const TRIANGULATION_METHODS = ['BOTH', 'COORDS', 'SETTLEMENT'] as const
export type TriangulationMethod = (typeof TRIANGULATION_METHODS)[number]

export const TRIANGULATION_METHOD_LABELS: Record<TriangulationMethod, string> = {
  BOTH: 'Both (recommended)',
  COORDS: 'Coordinates only — nearest-point spatial match',
  SETTLEMENT: 'Settlement match only — state/LGA/ward/name match',
}

export interface ReachFormInput {
  plannedSettlementsFile: File | null
  dataSourcesFile: File | null
  tracksFile: File | null
  method: TriangulationMethod
}

// Mirrors the `status` column toolbox/triangulate/triangulate.py writes
// (reach >= 1 -> 'Visited', else 'Not Visited'). Unlike H2H's day_{N}_cumm
// column there's no mop-up-dependent third state here — always exactly two
// values. (Confirmed against a real sample export: the column is named
// `status`, not `visitation` — an earlier assumption here that has since
// been corrected throughout utils/reachAggregate.ts and the reach
// components.)
export const REACH_VISITATION_STATUSES = ['Visited', 'Not Visited'] as const
export type ReachVisitationStatus = (typeof REACH_VISITATION_STATUSES)[number]

// Canonical form of the uploaded planned-settlements file's own
// "Accessibility status" column (passed through unchanged, like every other
// non-`sources`/`reach`/`status` column) — three values, but the real sample
// export has them under inconsistent casing ("Inaccessible" vs
// "inaccessible"). See utils/reachAggregate.ts::normalizeAccessibility for
// where that gets folded onto this fixed set.
export const ACCESSIBILITY_STATUSES = ['Fully Accessible', 'Partially Accessible', 'Inaccessible'] as const
export type AccessibilityStatus = (typeof ACCESSIBILITY_STATUSES)[number]

// One row of the CSV returned by POST /validation. Every column from the
// uploaded planned_settlements file passes through unchanged (only
// `geometry` is dropped) — `sources`, `reach`, and `status` are the only
// columns the backend always adds under fixed names
// (toolbox/triangulate/triangulate.py). `reach` is a 0-3 count of
// corroborating sources (eTally/MST/GTS today) and `status` is fully
// derived from it. State/LGA/ward/population columns keep whatever names
// the uploaded file used — same caveat as H2H/MLoS, see
// src/utils/columns.ts::detectColumns.
export type ReachRecord = Record<string, string | number | null>

export interface ParsedReachResult {
  records: ReachRecord[]
  columns: string[]
  sourceFilename: string
}
