import type { SimpleGeometry } from '../utils/wkb'

// Mirrors toolbox/models/__init__.py::Identifier — an optional Form field on
// POST /ta/generate_ta (toolbox/apps/campaign/target_area.py) controlling
// how the unique settlement identifier is built when the source data
// doesn't already have one.
export const TARGET_AREA_IDENTIFIERS = ['concat', 'uuid'] as const
export type TargetAreaIdentifier = (typeof TARGET_AREA_IDENTIFIERS)[number]

export interface TargetAreaFormInput {
  mlosFile: File | null
  plannedListFile: File | null
  identifier: TargetAreaIdentifier | null
}

// One row of a GeoPackage feature layer inside the response ZIP — attribute
// columns only (see utils/gpkg.ts for the geometry column). Column names
// beyond what the backend always writes (`type`, and — on gridded_ta only —
// `row_id`, `area_sqm`, `building_count`) come from whatever the uploaded
// MLoS file used, fuzzy-detected the same way as every other endpoint
// (toolbox/mlos/mtools.py::get_admin_col) — see src/utils/columns.ts.
export type TargetAreaRecord = Record<string, string | number | null>

export interface TargetAreaLayer {
  columns: string[]
  records: TargetAreaRecord[]
  rowCount: number
  /** Parsed polygon/multipolygon geometry per row, aligned by index with `records` (see utils/wkb.ts) — null where a row's geometry was missing or unparseable. */
  geometries: (SimpleGeometry | null)[]
}

// POST /ta/generate_ta always returns `voronoi` + `gridded_ta`; `subset_voronoi`
// + `gridded_ta_subset` are only present in the ZIP at all if a
// `planned_list` file was posted (toolbox/apps/campaign/target_area.py) —
// their *absence* (not an empty layer) is what "no planned list uploaded"
// means. `hasPlannedList` captures exactly that distinction.
export interface ParsedTargetAreaResult {
  voronoi: TargetAreaLayer | null
  griddedTa: TargetAreaLayer | null
  subsetVoronoi: TargetAreaLayer | null
  griddedTaSubset: TargetAreaLayer | null
  hasPlannedList: boolean
}
