import type { TrackingFormInput } from '../types/h2h'
import type { QcFormInput } from '../types/mlos'
import type { UuidCheckResult } from '../types/uuidChecker'
import type { ReachFormInput } from '../types/reach'
import type { TargetAreaFormInput } from '../types/targetArea'
import type { FixerFormInput, StandardizeFormInput, UpdateValidationFormInput } from '../types/mlosOps'
import type { DipExpansion } from '../types/microplan'
import type { StateName } from '../types/h2h'
import type { TracksFormInput } from '../types/compilerTracks'
import type { DailyReportFormInput, DailyPostReport } from '../types/dailyReport'
import type { JobRow, JobsSummary } from '../types/jobs'
import type { ContactAnalysisFormInput } from '../types/contactAnalysis'
import type { PostImplementationFormInput, PostReport } from '../types/postImplementation'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(message: string, status: number, detail: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) return
  let detail: unknown = null
  try {
    detail = await response.json()
  } catch {
    detail = await response.text().catch(() => null)
  }
  throw new ApiError(`Request failed with status ${response.status}`, response.status, detail)
}

export interface H2HTrackingResponse {
  csvBlob: Blob
  // Null only if an older/different backend build is running that doesn't
  // send the header (e.g. mid-deploy) — callers should treat that as "no
  // downloadable archive available" rather than throwing, since the results
  // themselves are still perfectly good.
  jobId: string | null
}

/**
 * Calls POST /tracking/gridded (toolbox/apps/tracking/h2h_validation.py).
 *
 * The backend now returns the settlements CSV directly (not a ZIP) — the
 * slow part of the old single response, serializing the tracks GeoPackage,
 * is deferred to a separate on-demand request. This is that split's fast
 * half: it resolves as soon as the visitation/coverage analysis itself is
 * done. Parse the returned blob with parseResult.ts's parseH2HCsv.
 *
 * The `X-Job-Id` response header (exposed cross-origin via sda_toolbox.py's
 * CORSMiddleware `expose_headers` — without that the browser hides it even
 * though it's on the wire) identifies this run's cached data for
 * fetchH2HArchive below, which builds and returns the full ZIP (CSV + tracks
 * GeoPackage + optional reports) only if/when the user actually asks for it.
 */
export async function submitH2HTracking(input: TrackingFormInput): Promise<H2HTrackingResponse> {
  if (!input.tracksFile || !input.dipFile) {
    throw new Error('Both a tracks file and a DIP file are required.')
  }

  const formData = new FormData()
  formData.append('tracks_path', input.tracksFile)
  formData.append('dip_file', input.dipFile)
  formData.append('analysis_day', String(input.analysisDay))
  formData.append('is_mop_up', String(input.isMopUp))
  formData.append('generate_report', String(input.generateReport))
  if (input.tracksExtension) {
    formData.append('tracks_extension', input.tracksExtension)
  }

  // No state_names param anymore — the backend now derives the state(s)
  // itself from the settlement data (get_admin_col + unique() over the
  // state column), the same auto-detect behavior the old empty-selection
  // default already relied on, so this endpoint no longer takes a states
  // input at all.
  const response = await fetch(`${API_BASE_URL}/tracking/gridded`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  const csvBlob = await response.blob()
  return { csvBlob, jobId: response.headers.get('X-Job-Id') }
}

/**
 * Calls GET /tracking/gridded/archive/{jobId} (toolbox/apps/tracking/
 * h2h_validation.py) — the full ZIP (settlements CSV + tracks GeoPackage +
 * optional reports) for a run submitH2HTracking above already completed.
 * Only call this when the user actually wants the downloadable archive; see
 * H2HTrackingPage.tsx.
 *
 * `jobId` is single-use (the backend cache entry is removed by a successful
 * fetch — a second call with the same id 404s) and expires after 30 minutes
 * if never claimed (toolbox/apps/tracking/h2h_cache.py's TTL_SECONDS).
 */
export async function fetchH2HArchive(jobId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/tracking/gridded/archive/${jobId}`)
  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls GET /tracking/gridded/reports/{jobId} (toolbox/apps/tracking/
 * h2h_validation.py) — the Daily/Cumulative report charts for a run
 * submitH2HTracking above already completed with generate_report=true. Same
 * list[PostReport] JSON contract as POST /reports/post and POST
 * /reports/daily — both are built server-side by the exact same
 * toolbox.reporting.DailyReport pipeline (see campaign/tracker.py::
 * prepare_reports), just reached through this job-scoped route instead of
 * their own upload forms — so the response renders with the same
 * DailyReportChartsPanel component DailyReportPage.tsx uses.
 *
 * Unlike fetchH2HArchive above, `jobId` is NOT consumed by this call — the
 * backend route reads it with h2h_cache.peek_result (non-destructive), so
 * the archive can still be downloaded afterward. Still subject to the same
 * 30 minute TTL (h2h_cache.py's TTL_SECONDS).
 *
 * Raises (via ApiError): 404 if the job id is unknown/expired, or if the
 * original run had generate_report=false.
 */
export async function fetchH2HReports(jobId: string): Promise<DailyPostReport[]> {
  const response = await fetch(`${API_BASE_URL}/tracking/gridded/reports/${jobId}`)
  await throwIfNotOk(response)
  return response.json()
}

/**
 * Calls POST /qc/validation (toolbox/apps/mlos/qc_mlos.py). Only
 * `mlos_file_path` is a form field — `standardize`, `consistency` and
 * `deep_search` all get their `= Query(...)`-equivalent default in FastAPI
 * (plain scalar params with no File()/Form() annotation are Query params,
 * even on a multipart endpoint — unlike `/tracking/gridded`, where
 * `analysis_day`/`is_mop_up` were explicitly wrapped in Form()), so they go
 * on the URL, not in the FormData body.
 *
 * There is no `state` param anymore — the route used to take one State enum
 * value and resolve ward boundaries against just that state; it now calls
 * `get_admin_col(mlos_data, 'state', 'raise')` and resolves boundaries
 * per-row from whichever state each settlement's own State column says,
 * raising only if no state column can be found at all. That's what makes a
 * single upload spanning multiple states valid input now, not just a
 * single-state file — QcSummaryCards/FlagBreakdownChart on MlosQcPage take
 * advantage of that by surfacing a real per-state breakdown.
 *
 * Returns the raw CSV response as a Blob — parse it with
 * src/api/parseResult.ts::parseMlosCsv. Unlike H2H, this is a single CSV
 * file, not a ZIP.
 */
export async function submitMlosQC(input: QcFormInput): Promise<Blob> {
  if (!input.mlosFile) {
    throw new Error('An MLoS settlement list file is required.')
  }

  const formData = new FormData()
  formData.append('mlos_file_path', input.mlosFile)

  const params = new URLSearchParams()
  params.append('standardize', String(input.standardize))
  params.append('consistency', String(input.consistency))
  params.append('deep_search', String(input.deepSearch))

  const response = await fetch(`${API_BASE_URL}/qc/validation?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /duplicate-deep-search/ (toolbox/apps/mlos/duplicate_checker.py
 * — the "Duplicate Checker" MLoS tool). `settlements_file` is a bare
 * UploadFile, so it's a multipart form field; `threshold` is a bare `int`
 * param with no File()/Form()/Query() annotation on an endpoint that also
 * has an UploadFile param — same repo convention documented throughout this
 * file (see submitMlosQC above) — so it's a Query param on the URL, not part
 * of the FormData body.
 *
 * NOTE for whoever next touches the backend route: duplicate_checker.py
 * calls `duplicate_deep_search_protocol(settlement_data, 'ward', unique_code,
 * geom, 'mapping')`, but that function's real signature (deep_search.py) is
 * `(dataset, unique_admin_col, threshold, geom_cols, output)` — the literal
 * string 'ward' is passed where `unique_admin_col` is expected, and
 * `unique_code` (a column name) where the numeric `threshold` is expected.
 * That looks like an argument-order slip that could mean this `threshold`
 * query param never actually reaches the similarity check. Flagging this
 * here rather than fixing it — this file only calls the route as it's
 * actually written; the mismatch is in backend code this app doesn't own.
 *
 * Returns the raw CSV response as a Blob (FileResponse, media_type
 * "text/csv") — parse it with src/api/parseResult.ts::parseDuplicateCheckerCsv.
 * Columns are always state/lga/ward/"settlement 1"/"settlement 2"/score/
 * distance/review, fixed by generate_mapping_table — not derived from
 * whatever columns the uploaded file used, unlike most other MLoS endpoints
 * in this file.
 */
export async function submitDuplicateChecker(settlementsFile: File, threshold: number): Promise<Blob> {
  if (!settlementsFile) {
    throw new Error('A settlement list file is required.')
  }

  const formData = new FormData()
  formData.append('settlements_file', settlementsFile)

  const params = new URLSearchParams()
  params.append('threshold', String(threshold))

  const response = await fetch(`${API_BASE_URL}/duplicate-deep-search/?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /coordinate_review (toolbox/apps/mlos/coord_review.py —
 * verified directly against the real backend source, not inferred).
 * `settlements_file`, `sources`, `tracks_data` are bare UploadFile params
 * with no File()/Form()/Query() wrapper — FastAPI always routes a bare
 * UploadFile to the multipart body. `use_osm` is a bare `bool` with no
 * default and no File()/Form()/Query() wrapper either — same repo convention
 * documented throughout this file (see submitMlosQC, submitDuplicateChecker
 * above): a scalar param alongside UploadFile params on a multipart endpoint
 * is a Query param, not a form field, so it goes on the URL.
 *
 * NOTE: the route itself dropped its trailing slash (was `/coordinate_review/`,
 * now `/coordinate_review`) in the same backend change that added `use_osm` —
 * updated here to match exactly, since a mismatched trailing slash would
 * otherwise round-trip through a redirect (or 404, depending on server
 * config) for no reason. This also happens to now line up with the
 * Dashboard's job-log whitelist entry (toolbox/job_tracker/middleware.py's
 * TOOL_ENDPOINTS has `('POST', '/coordinate_review')`, no trailing slash) —
 * worth a real run to confirm this tool's runs are finally showing up there.
 *
 * `sources` must be an Excel workbook (.xlsx/.xls, one sheet per source) or
 * a .zip of per-source files — toolbox/tools/helper.py::read_compiled_data
 * raises DataError on a plain .csv. Every sheet also needs a
 * fuzzy-detectable state/LGA/ward/settlement column
 * (toolbox/mlos/mtools.py::AdminColumns.create_by_search, error='raise') or
 * the WHOLE request fails — there's no per-sheet partial-success path, so a
 * single malformed sheet in an otherwise-fine workbook takes down the run.
 *
 * `tracks_data` only works today for a single already-spatial file
 * (.gpkg/.kml/.shp/.sqlite, or a lat/lon csv/xlsx). A .zip can't currently
 * work here: reading a zipped tracks file requires a `tracks_extension`
 * value (toolbox/tracks_manager/tr.py::read_tracks), and this router has no
 * `tracks_extension` param to supply one — flagged to the backend owner,
 * not something the frontend can route around.
 *
 * `use_osm` — when true, OpenStreetMap is folded in as one more source
 * alongside whatever sheets `sources` contains; the returned CSV just gets
 * an extra `osm_*` 6-column evidence group like any other detected source
 * (see utils/coordinateReviewAggregate.ts::detectSourceNames), no special
 * handling needed client-side.
 *
 * Returns the raw CSV response as a Blob (FileResponse, media_type
 * "text/csv") — parse it with parseResult.ts::parseCoordinateReviewCsv.
 * Separately, the backend's FileResponse call passes `filename=tmp_file.name`
 * (a raw tempfile path) rather than a friendly name — irrelevant here since
 * this page names its own downloads client-side, but would look wrong if
 * anyone ever hit this endpoint directly from a browser.
 */
export async function submitCoordinateReview(settlementsFile: File, sourcesFile: File, tracksFile: File, useOsm: boolean): Promise<Blob> {
  if (!settlementsFile) {
    throw new Error('A settlement list file is required.')
  }
  if (!sourcesFile) {
    throw new Error('A sources workbook (or zip) is required.')
  }
  if (!tracksFile) {
    throw new Error('A tracks file is required.')
  }

  const formData = new FormData()
  formData.append('settlements_file', settlementsFile)
  formData.append('sources', sourcesFile)
  formData.append('tracks_data', tracksFile)

  const params = new URLSearchParams()
  params.append('use_osm', String(useOsm))

  const response = await fetch(`${API_BASE_URL}/coordinate_review?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /ta/generate_ta (toolbox/apps/campaign/target_area.py — the
 * "Target area generator"). `mlos_file` is a bare `UploadFile` (required
 * form field). `planned_list` is `Optional[UploadFile] = Form(None)` — same
 * shape as REACH's `tracks`, omit the FormData key entirely rather than
 * appending an empty file when it's not provided. `identifier` is a bare
 * `Identifier` enum but — unlike `method` on /validation or `state` on
 * /qc/validation — it's explicitly wrapped in `Form(None)` here too, so it
 * goes in the multipart body, NOT the URL query string.
 *
 * Returns a ZIP of GeoPackage (SQLite) layers, not CSV/JSON — parse it with
 * src/api/parseResult.ts::parseTargetAreaZip (uses src/utils/gpkg.ts, a
 * sql.js-based reader, since GeoPackage is binary SQLite, not text).
 */
export async function submitGenerateTA(input: TargetAreaFormInput): Promise<Blob> {
  if (!input.mlosFile) {
    throw new Error('A master list of settlements (MLoS) file is required.')
  }

  const formData = new FormData()
  formData.append('mlos_file', input.mlosFile)
  if (input.plannedListFile) formData.append('planned_list', input.plannedListFile)
  if (input.identifier) formData.append('identifier', input.identifier)

  const response = await fetch(`${API_BASE_URL}/ta/generate_ta`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /qc/standardize (toolbox/apps/mlos/standardizer.py — the
 * "Standardize MLoS" tool). `mlos_file_path` is the only parameter, a
 * required UploadFile — always a form field regardless of annotation.
 *
 * Returns the standardized CSV as a Blob (FileResponse) — parse it with
 * src/api/parseResult.ts::parseCsvDataset.
 */
export async function submitStandardizeMlos(input: StandardizeFormInput): Promise<Blob> {
  if (!input.mlosFile) {
    throw new Error('An MLoS settlement list file is required.')
  }

  const formData = new FormData()
  formData.append('mlos_file_path', input.mlosFile)

  const response = await fetch(`${API_BASE_URL}/qc/standardize`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls PATCH /qc/fixer (toolbox/apps/mlos/fixer.py — the "Fixer" tool).
 * `settlement_file` is the only form field; `shift_points`/`set_global_id`/
 * `populate_takeoff`/`duplicate_check`/`state` are bare scalar/enum params
 * with no File()/Form()/Query() annotation, so — same repo convention as
 * /qc/validation's `state` — they're Query params on the URL. `state` is
 * only sent when set (the backend only requires it when shift_points=true).
 *
 * Returns the fixed CSV as a Blob — parse it with parseCsvDataset.
 */
export async function submitFixer(input: FixerFormInput): Promise<Blob> {
  if (!input.settlementFile) {
    throw new Error('A settlement list file is required.')
  }
  if (input.shiftPoints && !input.state) {
    throw new Error('A state is required when "Shift proximity-violating points" is enabled — it resolves ward boundaries from the GDB.')
  }

  const formData = new FormData()
  formData.append('settlement_file', input.settlementFile)

  const params = new URLSearchParams()
  params.append('shift_points', String(input.shiftPoints))
  params.append('set_global_id', String(input.setGlobalId))
  params.append('populate_takeoff', String(input.populateTakeoff))
  params.append('duplicate_check', String(input.duplicateCheck))
  if (input.state) params.append('state', input.state)

  const response = await fetch(`${API_BASE_URL}/qc/fixer?${params.toString()}`, {
    method: 'PATCH',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls PATCH /mlos/validation (toolbox/apps/mlos/update_validation.py —
 * the "Update MLoS" tool). `mlos_file` is a bare UploadFile (form field).
 * `lga_validation_files` is `list[UploadFile] | UploadFile` — still
 * File-like, so also a form field; each file is appended under the same
 * `lga_validation_files` key so FastAPI collects them into a list. `purpose`
 * is a bare `Policy` enum with no annotation, so it's a Query param, same
 * convention as `state`/`method` elsewhere in this app.
 *
 * Returns the updated CSV as a Blob — parse it with parseCsvDataset.
 */
export async function submitUpdateValidation(input: UpdateValidationFormInput): Promise<Blob> {
  if (!input.mlosFile) {
    throw new Error('An MLoS file is required.')
  }
  if (input.lgaValidationFiles.length === 0) {
    throw new Error('At least one LGA validation file (CSV or Excel workbook) is required.')
  }
  if (!input.purpose) {
    throw new Error('A purpose is required — it picks which attribute-remapping table the update pulls from.')
  }

  const formData = new FormData()
  formData.append('mlos_file', input.mlosFile)
  for (const file of input.lgaValidationFiles) {
    formData.append('lga_validation_files', file)
  }

  const params = new URLSearchParams()
  params.append('purpose', input.purpose)

  const response = await fetch(`${API_BASE_URL}/mlos/validation?${params.toString()}`, {
    method: 'PATCH',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls GET /uuid_check (toolbox/apps/db_access/uuid_checker.py). `uuid` is a
 * plain scalar param with no annotation, so on a GET endpoint that's a Query
 * param — goes on the URL, not a body.
 */
export async function checkUuid(uuid: string): Promise<UuidCheckResult> {
  const params = new URLSearchParams({ uuid })
  const response = await fetch(`${API_BASE_URL}/uuid_check?${params.toString()}`)
  await throwIfNotOk(response)
  return response.json()
}

/**
 * Calls POST /uuid_batch_checker (toolbox/apps/db_access/uuid_checker.py).
 * The endpoint's only parameter is `uuids: list[UUID]` — an un-annotated
 * *compound* type (unlike the scalar `uuid` on /uuid_check above), which
 * FastAPI treats as the entire JSON request body. So this sends a raw JSON
 * array of UUID strings, not a wrapped object — and the response comes back
 * wrapped as `{ response: [...] }` (the `UUIDResponses` dataclass's one
 * field), which we unwrap here.
 */
export async function checkUuidBatch(uuids: string[]): Promise<UuidCheckResult[]> {
  const response = await fetch(`${API_BASE_URL}/uuid_batch_checker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(uuids),
  })
  await throwIfNotOk(response)
  const data: { response: UuidCheckResult[] } = await response.json()
  return data.response
}

/**
 * Calls GET /jobs/summary (toolbox/job_tracker/router.py). Active/Completed/
 * Failed counts across every user of this backend instance — what the
 * Dashboard's "Job activity" card reads instead of the old session-only
 * state/jobTracker.tsx counts, so it survives a page reload.
 */
export async function fetchJobsSummary(): Promise<JobsSummary> {
  const response = await fetch(`${API_BASE_URL}/jobs/summary`)
  await throwIfNotOk(response)
  return response.json()
}

/**
 * Calls GET /jobs (toolbox/job_tracker/router.py) — the most recent job rows,
 * newest first, for the Dashboard's recent-activity table.
 */
export async function fetchRecentJobs(limit = 8): Promise<JobRow[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  const response = await fetch(`${API_BASE_URL}/jobs?${params.toString()}`)
  await throwIfNotOk(response)
  const data: { jobs: JobRow[] } = await response.json()
  return data.jobs
}

/**
 * Calls POST /validation (toolbox/apps/tracking/reach_analysis.py — the
 * "REACH analysis" tool). `planned_settlements` and `data_sources` are bare
 * `UploadFile` params (form fields); `tracks` is `Optional[UploadFile] =
 * Form(None)` (also a form field, just optional); `method` is a bare
 * `TriangulationMethod` enum with no File()/Form()/Query() annotation, so —
 * same rule as /qc/validation's `state` param — it's a Query param on the
 * URL, not part of the multipart body.
 *
 * Returns the raw CSV response as a Blob (FileResponse, media_type
 * "text/csv") — not a ZIP, parse it with src/api/parseResult.ts::parseReachCsv.
 */
export async function submitReachAnalysis(input: ReachFormInput): Promise<Blob> {
  if (!input.plannedSettlementsFile) {
    throw new Error('A planned settlements file is required.')
  }
  if (!input.dataSourcesFile) {
    throw new Error('A data sources file (.zip of submissions, or an Excel workbook with one sheet per source) is required.')
  }

  const formData = new FormData()
  formData.append('planned_settlements', input.plannedSettlementsFile)
  formData.append('data_sources', input.dataSourcesFile)
  if (input.tracksFile) formData.append('tracks', input.tracksFile)

  const params = new URLSearchParams()
  params.append('method', input.method)

  const response = await fetch(`${API_BASE_URL}/validation?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /aggregator/dmp/combine (toolbox/apps/planfeld/dmp.py). `dmp_files`
 * is a bare UploadFile param, which FastAPI always routes to the multipart
 * body regardless of Form()/File() wrapping — goes in FormData. `dip` is a
 * bare `Literal['expand','keep']` scalar param with no File()/Form()/Query()
 * wrapper, which — same convention confirmed across every other endpoint in
 * this app (Fixer's booleans/state, Update Validation's purpose) — FastAPI
 * routes to a Query param, not the body.
 *
 * NOT currently called by MicroplanCombinePage. As written today, this route
 * expects a flat zip of per-LGA CSVs and writes one Excel sheet per LGA — it
 * doesn't match the nested zip-of-zips-of-ward-CSVs upload shape or the
 * Settlements/Special Places output shape confirmed against the sample
 * files (see the comment at the top of types/microplan.ts). The page parses
 * the upload and builds the workbook client-side instead
 * (utils/microplanCombine.ts, utils/microplanWorkbook.ts). This function is
 * kept ready to wire in once the backend route is updated to match — swap
 * the client-side parse/build for a call to this and a parseResult.ts blob
 * read, same pattern as every other page in this app.
 */
export async function submitCombineDmpFiles(dmpFiles: File, dip: DipExpansion): Promise<Blob> {
  if (!dmpFiles) {
    throw new Error('A zipped DMP folder is required.')
  }

  const formData = new FormData()
  formData.append('dmp_files', dmpFiles)

  const params = new URLSearchParams()
  params.append('dip', dip)

  const response = await fetch(`${API_BASE_URL}/aggregator/dmp/combine?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /dip/validator (toolbox/apps/planfeld/dip_template.py::
 * validate_microplan). Both params are explicitly `File(...)`-wrapped
 * UploadFile fields, so both go in the multipart body.
 *
 * Unlike submitCombineDmpFiles above, this route IS called directly by its
 * page (MicroplanValidatePage) — the shape genuinely matches: it already
 * accepts a settlements file + a team allocation file and returns exactly
 * the DIP/Ward Review/Team Review workbook the page needs. See the
 * top-of-file comment in types/microplanValidate.ts for confirmation
 * details and the one caveat found (sheet-naming drift between the current
 * code and an older sample workbook — handled defensively in
 * utils/microplanValidateParse.ts, not a reason to avoid calling the route).
 */
export async function submitValidateDip(settlementsFile: File, teamAllocationFile: File): Promise<Blob> {
  if (!settlementsFile || !teamAllocationFile) {
    throw new Error('Both a DIP/settlements file and a team allocation file are required.')
  }

  const formData = new FormData()
  formData.append('settlements_file', settlementsFile)
  formData.append('team_allocation_file', teamAllocationFile)

  const response = await fetch(`${API_BASE_URL}/dip/validator`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /dip/merger (toolbox/apps/planfeld/dip_template.py::
 * merge_dip_and_maps). `maps_path`/`dip_path` are explicit `File(...)`
 * UploadFile fields, so both go in the multipart body. `lgas`/`state` have
 * no File()/Form() annotation on the backend — same rule as `state` on
 * /qc/validation elsewhere in this file — so both go on the URL as plain
 * Query params, not in the FormData body. The route requires `lgas` or
 * `state`; if both are supplied the backend prefers `lgas`
 * (merger.py::merge_maps_to_dips checks `is_empty(lgas)` first and only
 * falls back to a DB lookup by `state` when it's blank) — this just sends
 * whichever the caller provided rather than picking one itself.
 *
 * Like submitValidateDip, this route is a genuine match for its page
 * (DipMergerPage): it already accepts a Team Guide Maps zip + a DIP zip and
 * returns a zip of merged LGA map-book PDFs, so the page calls this
 * directly and parses the real response (utils/dipMapMergerParse.ts)
 * instead of recomputing anything server-side would have done. What the
 * response canNOT tell the page is what got silently dropped during
 * matching — see the top-of-file comment in types/dipMapMerger.ts.
 */
export async function submitDipMapMerger(
  mapsFile: File,
  dipFile: File,
  lgas: string,
  state: StateName | null
): Promise<Blob> {
  if (!mapsFile || !dipFile) {
    throw new Error('Both a Team Guide Maps zip and a DIP zip are required.')
  }
  if (!lgas.trim() && !state) {
    throw new Error('Provide either specific LGAs or a state — the backend needs one to know which LGAs to generate.')
  }

  const formData = new FormData()
  formData.append('maps_path', mapsFile)
  formData.append('dip_path', dipFile)

  const params = new URLSearchParams()
  if (lgas.trim()) params.append('lgas', lgas.trim())
  if (state) params.append('state', state)
  const query = params.toString() ? `?${params.toString()}` : ''

  const response = await fetch(`${API_BASE_URL}/dip/merger${query}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /dip/generator (toolbox/apps/planfeld/dip_template.py::
 * generate_daily_implementation_plan). `dip_file` is a bare required
 * UploadFile — a form field. `validate_dip` is explicitly `Form(False)`, so
 * it's also a form field (a string "true"/"false", not a URL query param —
 * unlike the un-annotated booleans on /qc/fixer or /qc/validation).
 * `team_allocation_file` is `UploadFile = File(None)` — optional, and only
 * appended when provided; the backend itself raises if validate_dip is true
 * and this is missing, mirrored here as a guard clause.
 *
 * Returns a zip of one PDF per field team (nested one folder deeper, inside
 * "DIPS.zip/" — see utils/dipGeneratorParse.ts) plus a "DIP.csv" of the
 * standardized dataset at the zip root.
 *
 * This function is called once per BATCH, not once per run — DipGeneratorPage
 * splits the uploaded dip_file into per-LGA batches client-side and calls
 * this once per batch (see utils/dipGeneratorParse.ts::splitDipFileByLga).
 * That's a frontend-only workaround: this route has no lgas/state param the
 * way /dip/merger does, and no batching or progress-reporting of its own —
 * see the top-of-file comment in types/dipGenerator.ts for the full
 * reasoning and its one open risk (client/backend LGA-column-detection
 * agreement).
 *
 * One more thing worth carrying over from design: turning validate_dip on
 * makes this call FAIL, not silently pass through unchanged. mp_validator.py::
 * validate_daily_implementation_plan's `referred=True` branch returns a dict
 * of review tables, not the DataFrame the PDF generator expects — so
 * DIPTemplateGenerator crashes on `self.df['unique_team_code']` with a
 * KeyError on every batch (a 500 from this call). See types/dipGenerator.ts
 * for the verbatim trace and DipGeneratorPage.tsx for the caveat card that
 * surfaces this once every batch has failed. This function still sends the
 * flag and still requires the allocation file when it's on (matching the
 * real route's contract) — callers should expect every batch to error when
 * validate_dip is true, not a same-as-off response.
 */
export async function submitDipGenerator(
  dipFile: File,
  validateDip: boolean,
  teamAllocationFile: File | null
): Promise<Blob> {
  if (!dipFile) {
    throw new Error('A compiled DIP file is required.')
  }
  if (validateDip && !teamAllocationFile) {
    throw new Error('A Team Allocation file is required when validation is switched on.')
  }

  const formData = new FormData()
  formData.append('dip_file', dipFile)
  formData.append('validate_dip', String(validateDip))
  if (validateDip && teamAllocationFile) {
    formData.append('team_allocation_file', teamAllocationFile)
  }

  const response = await fetch(`${API_BASE_URL}/dip/generator`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /compiler/tracks (toolbox/apps/aggregators/tracks.py::
 * combine_tracks). `tracks_path` is the only real UploadFile — the other
 * params (`tracks_extension`, `states`, `remove_invalid_tracks`) have no
 * Form() annotation on the backend, which FastAPI resolves as plain Query
 * params, same inference already documented above for /qc/validation's
 * state/standardize/consistency/deep_search — they go on the URL, not in the
 * FormData body. `tracks_extension` is required by the route's own signature
 * (no default), unlike most other Extensions params elsewhere in this app.
 *
 * `states` was updated server-side from a single optional `state` to
 * `states: list[State] | None = Query(default_factory=None)` — a state
 * clip now unions any number of selected states' boundaries rather than
 * just one. FastAPI's Query-list convention is a repeated key, one
 * `states=<name>` pair per selection — `URLSearchParams.append` called once
 * per entry produces exactly that on the wire; an empty selection omits the
 * param entirely, matching the backend's `None` default (no clipping).
 *
 * Returns a single un-zipped .gpkg file as a Blob (NOT a zip, despite the
 * route's own docstring calling it "zipped sqlite" — see the caveat in
 * types/compilerTracks.ts) — read it with src/utils/gpkg.ts::readGpkgLayer.
 */
export async function submitCombineTracks(input: TracksFormInput): Promise<Blob> {
  if (!input.tracksFile) {
    throw new Error('A tracks file is required.')
  }
  if (!input.tracksExtension) {
    throw new Error('A track file extension is required.')
  }

  const formData = new FormData()
  formData.append('tracks_path', input.tracksFile)

  const params = new URLSearchParams()
  params.append('tracks_extension', input.tracksExtension)
  for (const state of input.states) params.append('states', state)
  params.append('remove_invalid_tracks', String(input.removeInvalidTracks))

  const response = await fetch(`${API_BASE_URL}/compiler/tracks?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /compiler/disaggregate (toolbox/apps/aggregators/splitter.py::
 * disaggregate_mlos). `mlos_file` is the only UploadFile; `level` has no
 * Form()/Query() annotation, so it's a Query param like the others above.
 *
 * Returns a single .xlsx workbook as a Blob (one sheet per LGA or per Ward,
 * not zipped) — read it client-side with the `xlsx` package directly
 * (workbook.SheetNames + sheet_to_json per sheet).
 */
export async function submitDisaggregateMlos(mlosFile: File, level: 'LGA' | 'Ward'): Promise<Blob> {
  if (!mlosFile) {
    throw new Error('A Master List of Settlements file is required.')
  }

  const formData = new FormData()
  formData.append('mlos_file', mlosFile)

  const params = new URLSearchParams()
  params.append('level', level)

  const response = await fetch(`${API_BASE_URL}/compiler/disaggregate?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /compiler/lga_data (toolbox/apps/aggregators/lga_data.py::
 * combine_lga_data). `lga_file` is the only UploadFile; `file_extension` and
 * `state` have no Form()/Query() annotation, so both are Query params.
 * `state` is accepted by the route's signature but never referenced in its
 * body — a genuinely dead parameter, still sent here for signature parity.
 *
 * ⚠ This call is expected to fail for realistic input. Tracing the route
 * against a real zip of per-LGA validation data during design surfaced THREE
 * independent, code-confirmed breakages (see types/compilerLgaData.ts for
 * the full trace): nested zips are only unzipped one level deep, the code
 * assumes .xlsx when real per-LGA exports are .csv, and the final
 * FileResponse reads from a tempfile path that was never actually written to
 * (`generate_output_name` builds a filename string with no file I/O, while
 * the real CSV goes to a *different* tempfile the response never looks at).
 * This function makes the real call regardless and lets the caller decide
 * how to present a failure — it does not swallow or simulate a response.
 *
 * Returns the merged CSV as a Blob when the route does succeed.
 */
export async function submitCombineLgaData(lgaFile: File, fileExtension: string | null, state: StateName | ''): Promise<Blob> {
  if (!lgaFile) {
    throw new Error('An LGA data file is required.')
  }

  const formData = new FormData()
  formData.append('lga_file', lgaFile)

  const params = new URLSearchParams()
  if (fileExtension) params.append('file_extension', fileExtension)
  if (state) params.append('state', state)
  const query = params.toString() ? `?${params.toString()}` : ''

  const response = await fetch(`${API_BASE_URL}/compiler/lga_data${query}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}

/**
 * Calls POST /reports/daily (toolbox/apps/tracking/reporter/
 * campaign_day_reporting.py::generate_campaign_daily_report) — reworked
 * server-side to match Post Implementation's own contract exactly.
 * `settlement_list` is a bare UploadFile -> FormData; `campaign_day_col`/
 * `coverage_col` are bare (un-annotated) params -> Query params, same repo
 * convention confirmed across every other endpoint in this app (Fixer's
 * booleans/state, /qc/validation's state, Update Validation's purpose).
 * Both are now REQUIRED — the old optional day/cumulative pair (and the
 * "at least one of two" validation it needed) is gone; a single call always
 * builds both a Day and a Cumulative set (DailyReport.generate_report()
 * always runs both `subset=True` and `subset=False` passes).
 *
 * The response is `response_model=list[PostReport]`
 * (toolbox/reporting/reporter.py::PostReport) — the exact same shared model
 * /reports/post returns below, plain JSON rather than a ZIP. See
 * types/dailyReport.ts for the full shape (including the Daily/Cumulative-
 * via-save_name parsing note) — this function just parses the JSON body,
 * same as submitPostImplementationReport.
 */
export async function submitDailyReport(input: DailyReportFormInput): Promise<DailyPostReport[]> {
  if (!input.settlementFile) {
    throw new Error('A settlement list file is required.')
  }
  if (!input.campaignDayCol.trim()) {
    throw new Error('The campaign day column is required.')
  }
  if (!input.coverageCol.trim()) {
    throw new Error('The coverage/status column is required.')
  }

  const formData = new FormData()
  formData.append('settlement_list', input.settlementFile)

  const params = new URLSearchParams()
  params.append('campaign_day_col', input.campaignDayCol.trim())
  params.append('coverage_col', input.coverageCol.trim())

  const response = await fetch(`${API_BASE_URL}/reports/daily?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.json()
}

/**
 * Calls POST /reports/post (toolbox/apps/tracking/reporter/
 * post_implementation_report.py::generate_post_implementation_reports).
 * `settlement_list` is a bare UploadFile -> FormData; `report_col` is
 * explicitly `Form(...)` on the route -> also FormData, not a query param.
 * There is no `lois` field — the route's optional LGA-filter parameter was
 * removed from its signature entirely in an earlier backend update.
 *
 * The response is now `response_model=list[PostReport]`
 * (toolbox/reporting/reporter.py::PostReport) — plain JSON, not a ZIP of
 * PNGs. One entry per LGA-level summary pie chart ('level': 'lga') and one
 * per ward-level breakdown bar chart ('level': 'ward'), each carrying its
 * own `state`/`lga`/`level` fields plus a raw Plotly figure spec (`figure`,
 * serialized via `json.loads(figure.to_json())` so numpy/pandas values in
 * the trace data come through JSON-safe) and a suggested `save_name`. The
 * frontend renders `figure` directly (PostImplementationGallery.tsx) instead
 * of decoding a pre-rendered PNG, so there's no ZIP-unzipping or
 * filename-parsing step anymore — this just parses the JSON body.
 */
export async function submitPostImplementationReport(input: PostImplementationFormInput): Promise<PostReport[]> {
  if (!input.settlementFile) {
    throw new Error('A settlement list file is required.')
  }
  if (!input.reportCol.trim()) {
    throw new Error('The final visitation/coverage status column is required.')
  }

  const formData = new FormData()
  formData.append('settlement_list', input.settlementFile)
  formData.append('report_col', input.reportCol.trim())

  const response = await fetch(`${API_BASE_URL}/reports/post`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.json()
}

/**
 * Calls POST /contact_analysis (toolbox/apps/campaign/contact_analysis.py —
 * the "inter-campaign contact analysis" tool). Both `base_file` (the
 * baseline settlement list) and `previous_campaign_file` (one Excel
 * workbook, one sheet per previous-campaign round) are bare `UploadFile`
 * params with no File()/Form()/Query() annotation, so both are plain
 * multipart form fields — no query string, unlike /validation's `method`.
 *
 * Returns the raw CSV response as a Blob (FileResponse, media_type
 * "text/csv") — parse it with src/api/parseResult.ts::parseContactAnalysisCsv.
 */
export async function submitContactAnalysis(input: ContactAnalysisFormInput): Promise<Blob> {
  if (!input.baseFile) {
    throw new Error('A baseline settlement list is required.')
  }
  if (!input.previousCampaignFile) {
    throw new Error('A previous campaigns file (an Excel workbook with one sheet per round) is required.')
  }

  const formData = new FormData()
  formData.append('base_file', input.baseFile)
  formData.append('previous_campaign_file', input.previousCampaignFile)

  const response = await fetch(`${API_BASE_URL}/contact_analysis`, {
    method: 'POST',
    body: formData,
  })

  await throwIfNotOk(response)
  return response.blob()
}
