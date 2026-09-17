import JSZip from 'jszip'
import Papa from 'papaparse'
import type { ParsedResult, SettlementRecord } from '../types/h2h'
import type { MlosRecord, ParsedMlosResult } from '../types/mlos'
import type { DuplicateCheckerRecord, ParsedDuplicateCheckerResult } from '../types/duplicateChecker'
import type { CoordinateReviewRecord, ParsedCoordinateReviewResult } from '../types/coordinateReview'
import { detectSourceNames } from '../utils/coordinateReviewAggregate'
import type { ParsedReachResult, ReachRecord } from '../types/reach'
import type { MlosOpsRecord, ParsedMlosOpsDataset } from '../types/mlosOps'
import type { ParsedTracksResult, TrackPoint } from '../types/compilerTracks'
import { TRACKS_LAYER_NAME } from '../types/compilerTracks'
import type { ContactRecord, ParsedContactAnalysisResult } from '../types/contactAnalysis'
import { readGpkgLayer, openGpkgLayer } from '../utils/gpkg'
import type { GpkgLayerHandle } from '../utils/gpkg'
import { findLatitudeColumnStrict, findLongitudeColumnStrict, findSpeedColumn, findGpsTimestampColumn, toNumber } from '../utils/columns'

/**
 * Unzips the h2h_outputs_day{N}.zip blob returned by
 * GET /tracking/gridded/archive/{job_id} (fetchH2HArchive) and parses the
 * settlements CSV inside it. NOT used by the live results flow anymore —
 * POST /tracking/gridded itself returns the settlements CSV directly now
 * (see parseH2HCsv above); this only matters if something needs to parse the
 * archive's CSV entry the same way after downloading it.
 *
 * The zip layout (toolbox/apps/tracking/h2h_validation.py) is:
 *   {dip_file_basename}.csv        <- settlement visitation/coverage data (what we want)
 *   tracks_day_{N}.gpkg             <- track geometry, not parsed here
 *   reports_{N}.zip                 <- optional, only if generate_report=True
 */
export async function parseH2HZip(blob: Blob, analysisDay: number): Promise<ParsedResult> {
  const zip = await JSZip.loadAsync(blob)

  const csvEntry = Object.values(zip.files).find(
    (file) => !file.dir && file.name.toLowerCase().endsWith('.csv'),
  )

  if (!csvEntry) {
    throw new Error(
      'No CSV file found in the response ZIP — expected the settlements CSV alongside the tracks GeoPackage.',
    )
  }

  const csvText = await csvEntry.async('text')

  const parsed = Papa.parse<SettlementRecord>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    // PapaParse reports row-level issues (e.g. ragged rows) as non-fatal
    // errors rather than throwing — surface them but don't block rendering
    // on data that mostly parsed fine.
    console.warn('CSV parse warnings:', parsed.errors)
  }

  return {
    records: parsed.data,
    columns: parsed.meta.fields ?? [],
    sourceFilename: csvEntry.name,
    analysisDay,
  }
}

/**
 * Parses the settlements CSV blob POST /tracking/gridded now returns
 * directly — see api/client.ts::submitH2HTracking and
 * toolbox/apps/tracking/h2h_validation.py for why this is no longer a ZIP:
 * the tracks GeoPackage moved to a separate, on-demand
 * GET /tracking/gridded/archive/{job_id} request (fetchH2HArchive) instead
 * of blocking this one. parseH2HZip below is kept only for anything that
 * might want to parse that archive's CSV entry the same way; the live H2H
 * results flow (H2HTrackingPage.tsx) uses this function instead.
 */
export async function parseH2HCsv(blob: Blob, analysisDay: number, sourceFilename: string): Promise<ParsedResult> {
  const csvText = await blob.text()

  const parsed = Papa.parse<SettlementRecord>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors)
  }

  return {
    records: parsed.data,
    columns: parsed.meta.fields ?? [],
    sourceFilename,
    analysisDay,
  }
}

/**
 * Parses the CSV blob returned directly by POST /qc/validation
 * (toolbox/apps/mlos/qc_mlos.py) — unlike the H2H endpoint, this response IS
 * the CSV, not a ZIP containing one.
 */
export async function parseMlosCsv(blob: Blob, sourceFilename: string): Promise<ParsedMlosResult> {
  const csvText = await blob.text()

  const parsed = Papa.parse<MlosRecord>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors)
  }

  return {
    records: parsed.data,
    columns: parsed.meta.fields ?? [],
    sourceFilename,
  }
}

/**
 * Parses the CSV blob returned directly by POST /duplicate-deep-search/
 * (toolbox/apps/mlos/duplicate_checker.py) — a bare CSV FileResponse, same
 * shape as the MLoS QC/REACH responses, not a ZIP. Unlike those, this
 * result's columns are fixed by generate_mapping_table (toolbox/mlos/
 * validation/review/attributes/deep_search.py) rather than derived from the
 * uploaded file's own columns, so no column-detection step is needed here.
 */
export async function parseDuplicateCheckerCsv(blob: Blob, sourceFilename: string): Promise<ParsedDuplicateCheckerResult> {
  const csvText = await blob.text()

  const parsed = Papa.parse<DuplicateCheckerRecord>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors)
  }

  // distance comes back as '' (not 0) when
  // review_ward_settlement_for_duplicates couldn't compute a geodesic
  // distance for the pair (missing/invalid coordinates) — dynamicTyping
  // leaves an empty CSV cell as an empty string rather than null, so
  // normalize that here instead of treating it as a real 0m distance.
  const records: DuplicateCheckerRecord[] = parsed.data.map((r) => ({
    ...r,
    distance: r.distance === null || r.distance === undefined || (r.distance as unknown) === '' ? null : Number(r.distance),
  }))

  return {
    records,
    columns: parsed.meta.fields ?? [],
    sourceFilename,
  }
}

/**
 * Parses the CSV blob returned directly by POST /validation
 * (toolbox/apps/tracking/reach_analysis.py) — a bare CSV FileResponse, same
 * shape as the MLoS QC response, not a ZIP.
 */
/**
 * Parses the CSV blob returned directly by POST /coordinate_review/
 * (toolbox/apps/mlos/coord_review.py) -- a bare CSV FileResponse. Columns
 * are NOT fixed: the baseline columns are whatever the uploaded settlements
 * file's own columns were, and one 6-column group per detected source is
 * appended (see types/coordinateReview.ts). dynamicTyping is left OFF here
 * (unlike parseMlosCsv/parseDuplicateCheckerCsv above) because pandas writes
 * booleans as the literal strings "True"/"False", which PapaParse's
 * dynamicTyping does not reliably normalize -- utils/coordinateReviewAggregate.ts's
 * toNumber/toBool helpers handle the raw string values explicitly instead.
 */
export async function parseCoordinateReviewCsv(blob: Blob, sourceFilename: string): Promise<ParsedCoordinateReviewResult> {
  const csvText = await blob.text()

  const parsed = Papa.parse<CoordinateReviewRecord>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors)
  }

  const columns = parsed.meta.fields ?? []
  const sourceNames = detectSourceNames(columns)

  return {
    records: parsed.data,
    columns,
    sourceNames,
    sourceFilename,
  }
}

export async function parseReachCsv(blob: Blob, sourceFilename: string): Promise<ParsedReachResult> {
  const csvText = await blob.text()

  const parsed = Papa.parse<ReachRecord>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors)
  }

  return {
    records: parsed.data,
    columns: parsed.meta.fields ?? [],
    sourceFilename,
  }
}

// The unbatched, geometry-including target_area_datasets.zip parser that
// used to live here (parseTargetAreaZip/readLayerIfPresent) was removed —
// Target Area's map was dropped and its summary cards/chart never needed
// geometry, so openTargetAreaZip below (attribute-only, batched) replaced
// it as the sole parse path. See utils/gpkg.ts's openGpkgLayer for where
// geometry stopped being read at all.

export type TargetAreaLayerKey = 'voronoi' | 'griddedTa' | 'subsetVoronoi' | 'griddedTaSubset'

export interface TargetAreaLayerHandle {
  key: TargetAreaLayerKey
  /** Raw byte size of this layer's own GeoPackage entry (before decompression by JSZip) — used to size batches, see utils/browserMemory.ts::estimateTargetAreaBatchRows. */
  rawBytes: number
  handle: GpkgLayerHandle
}

export interface OpenTargetAreaZipResult {
  layers: TargetAreaLayerHandle[]
  hasPlannedList: boolean
}

const TARGET_AREA_LAYER_ENTRIES: { key: TargetAreaLayerKey; entryName: string }[] = [
  { key: 'voronoi', entryName: 'voronoi' },
  { key: 'griddedTa', entryName: 'gridded_ta' },
  { key: 'subsetVoronoi', entryName: 'subset_voronoi' },
  { key: 'griddedTaSubset', entryName: 'gridded_ta_subset' },
]

/**
 * Opens the target_area_datasets.zip blob for BATCHED, incremental reading
 * — used by utils/targetAreaBatchLoader.ts (in turn driven by
 * TargetAreaPage.tsx) so large multi-state results are read a slice at a
 * time instead of one giant synchronous pass. This does NOT read any row
 * data itself — it only unzips, opens each present layer's GeoPackage (via
 * utils/gpkg.ts::openGpkgLayer, attribute columns only — no geometry), and
 * returns still-open handles the caller pages through with
 * handle.readBatch(offset, limit).
 *
 * Callers MUST call .handle.close() on every returned layer once done with
 * it (including on an error/early-exit path) — each open handle holds its
 * own sql.js Database in the WASM heap until closed.
 */
export async function openTargetAreaZip(blob: Blob): Promise<OpenTargetAreaZipResult> {
  const zip = await JSZip.loadAsync(blob)

  const layers: TargetAreaLayerHandle[] = []
  for (const { key, entryName } of TARGET_AREA_LAYER_ENTRIES) {
    const entry = zip.file(entryName)
    if (!entry) continue
    const bytes = await entry.async('uint8array')
    const handle = await openGpkgLayer(bytes, entryName)
    if (handle) layers.push({ key, rawBytes: bytes.byteLength, handle })
  }

  const hasPlannedList = layers.some((l) => l.key === 'subsetVoronoi' || l.key === 'griddedTaSubset')
  return { layers, hasPlannedList }
}

/**
 * Reads the single .gpkg Blob returned directly by POST /compiler/tracks
 * (toolbox/apps/aggregators/tracks.py::combine_tracks) — unlike the Target
 * Area endpoint, this is NOT a zip, so no JSZip unwrap step first, straight
 * to readGpkgLayer (utils/gpkg.ts, sql.js/WASM SQLite).
 *
 * Reads point positions off the layer's own lat/lon ATTRIBUTE columns
 * (fuzzy-matched client-side the same non-excluding way the backend's own
 * filter_valid_tracks locates them — see utils/columns.ts) rather than
 * decoding the geometry blob's WKB — those columns are guaranteed present
 * under whatever names the uploaded track file used, since the backend
 * itself would have raised NotFoundError before ever producing a response
 * if it couldn't find them. This sidesteps needing Point support in
 * utils/wkb.ts, which today only decodes Polygon/MultiPolygon (the only
 * geometry types Target Area's layers use).
 */
export async function parseTracksGpkg(blob: Blob): Promise<ParsedTracksResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const layer = await readGpkgLayer(bytes, TRACKS_LAYER_NAME)

  const latColumn = findLatitudeColumnStrict(layer.columns)
  const lonColumn = findLongitudeColumnStrict(layer.columns)
  const speedColumn = findSpeedColumn(layer.columns)
  const timestampColumn = findGpsTimestampColumn(layer.columns)

  const points: TrackPoint[] = []
  let unplottable = 0
  for (const record of layer.records) {
    const lat = latColumn ? toNumber(record[latColumn]) : null
    const lon = lonColumn ? toNumber(record[lonColumn]) : null
    if (lat === null || lon === null) {
      unplottable += 1
      continue
    }
    points.push({
      latitude: lat,
      longitude: lon,
      speedMps: speedColumn ? toNumber(record[speedColumn]) : null,
      gpsTimestamp: timestampColumn ? (record[timestampColumn] != null ? String(record[timestampColumn]) : null) : null,
      raw: record,
    })
  }

  return { points, columns: layer.columns, latColumn, lonColumn, speedColumn, timestampColumn, unplottable }
}

/**
 * Parses a plain CSV blob into records + columns — shared by the three MLoS
 * maintenance endpoints (POST /qc/standardize, PATCH /qc/fixer, PATCH
 * /mlos/validation, all in toolbox/apps/mlos/), which each return a bare CSV
 * FileResponse like /qc/validation does. Also used client-side (via
 * `blob.text()` on a File, which works the same as on a Response Blob) to
 * parse the ORIGINAL uploaded file for the before/after diff in
 * utils/datasetDiff.ts — see parseCsvText below for that path specifically,
 * since a File's name/extension (not just its content) needs checking first.
 */
export async function parseCsvDataset(blob: Blob): Promise<ParsedMlosOpsDataset> {
  const csvText = await blob.text()
  return parseCsvText(csvText)
}

/** Same parsing as parseCsvDataset, for when the CSV text is already in hand (e.g. read from an uploaded File). */
export function parseCsvText(csvText: string): ParsedMlosOpsDataset {
  const parsed = Papa.parse<MlosOpsRecord>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors)
  }

  return {
    records: parsed.data,
    columns: parsed.meta.fields ?? [],
  }
}

// The old parseDailyReportZip (unzipping a fixed-filename 4-PNG
// "campaign_day_report.zip") has been removed — POST /reports/daily now
// returns list[PostReport] as plain JSON, the same contract POST
// /reports/post already used, so there is no ZIP to unzip and no filename
// convention to match; see api/client.ts::submitDailyReport and
// types/dailyReport.ts.

export async function parseContactAnalysisCsv(blob: Blob, sourceFilename: string): Promise<ParsedContactAnalysisResult> {
  const csvText = await blob.text()

  const parsed = Papa.parse<ContactRecord>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors)
  }

  return {
    records: parsed.data,
    columns: parsed.meta.fields ?? [],
    sourceFilename,
  }
}
