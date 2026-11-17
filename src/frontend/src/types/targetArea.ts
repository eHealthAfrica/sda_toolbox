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

// Mirrors POST /ta/generate_ta/buffer (toolbox/apps/campaign/target_area.py::
// generate_buffer_based_ta) — the "buffer strategy" TA generator used for
// RES/RIC and Nomadic vaccination activities. Unlike /ta/generate_ta above,
// there's only ONE input file: the planned settlement list IS the geometry
// source voronoi/gridded TA are generated from directly, so there's no
// separate MLoS-vs-planned-subset distinction here. `bufferDistance` is a
// plain int (not wrapped in Form(...) on the backend), so it travels as a
// URL query param, not a multipart form field — see submitGenerateBufferTA.
export const BUFFER_DISTANCE_MIN = 100
export const BUFFER_DISTANCE_MAX = 400
export const BUFFER_DISTANCE_DEFAULT = 200

export interface BufferTargetAreaFormInput {
  plannedSettlementListFile: File | null
  bufferDistance: number
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
  /**
   * Set only while a batched load (utils/targetAreaBatchLoader.ts) is still
   * in progress — the number of rows read into `records` so far, which can
   * be less than `rowCount` (the server-reported total from
   * `SELECT COUNT(*)`) until the batch loop finishes or stops early on a
   * memory warning. Absent once a load is complete, in which case
   * `records.length === rowCount` as before.
   */
  loadedCount?: number
}

// No geometry field here on purpose — the map that used to render it was
// removed, and the summary cards/volume chart (the only remaining Target
// Area UI) only ever read `records`/`rowCount`. utils/gpkg.ts's batched
// reader no longer even selects the geometry column from the GeoPackage, so
// there's nothing to hold here. The real spatial output (voronoi/gridded-TA
// polygons) is unaffected — it's still in the downloadable response ZIP,
// which this app never needs to decode to show the summary/chart.

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
  /**
   * True once the batched render loop (TargetAreaPage.tsx, via
   * utils/targetAreaBatchLoader.ts) stopped early because the browser was
   * approaching its estimated memory limit — some layers above may have
   * `loadedCount < rowCount`. The raw response ZIP is unaffected and stays
   * fully downloadable regardless (see TargetAreaPage.tsx's resultBlob).
   */
  memoryLimited?: boolean
}

// What POST /ta/generate_ta says it did with each state, from the X-TA-Summary response header
// (toolbox/target_area/run_summary.py). A state is skipped when it cannot be processed — duplicate
// settlements, missing boundary data, a failure part-way — and the rest of the run still completes.
export interface SkippedState {
  state: string
  reason: string
}

export interface TargetAreaRunSummary {
  statesRun: string[]
  skipped: SkippedState[]
}

export interface TargetAreaResponse {
  blob: Blob
  /** Null when the server sent no summary (an older backend) or it could not be read. */
  summary: TargetAreaRunSummary | null
}
