import JSZip from 'jszip'
import Papa from 'papaparse'
import type { ParsedResult, SettlementRecord } from '../types/h2h'
import type { MlosRecord, ParsedMlosResult } from '../types/mlos'
import type { ParsedReachResult, ReachRecord } from '../types/reach'
import type { ParsedTargetAreaResult, TargetAreaLayer } from '../types/targetArea'
import type { MlosOpsRecord, ParsedMlosOpsDataset } from '../types/mlosOps'
import type { ParsedTracksResult, TrackPoint } from '../types/compilerTracks'
import { TRACKS_LAYER_NAME } from '../types/compilerTracks'
import type { DailyReportChartImage, ParsedDailyReportResult } from '../types/dailyReport'
import type { ContactRecord, ParsedContactAnalysisResult } from '../types/contactAnalysis'
import { readGpkgLayer } from '../utils/gpkg'
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
 * Parses the CSV blob returned directly by POST /validation
 * (toolbox/apps/tracking/reach_analysis.py) — a bare CSV FileResponse, same
 * shape as the MLoS QC response, not a ZIP.
 */
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

/**
 * Unzips the target_area_datasets.zip blob returned by POST /ta/generate_ta
 * (toolbox/apps/campaign/target_area.py) and reads its GeoPackage layers.
 *
 * Zip entries have NO file extension (they're literally named "voronoi",
 * "gridded_ta", "subset_voronoi", "gridded_ta_subset" —
 * toolbox/access/export_mgr.py::create_spatial_sqlite / add_to_archive), so
 * this matches by exact entry name rather than a ".csv"/".gpkg" suffix like
 * the other zip-based endpoints. The subset_* entries only exist in the zip
 * at all when a `planned_list` file was posted — their absence (not merely
 * an empty layer) is what "no planned list uploaded" means; see
 * types/targetArea.ts.
 */
async function readLayerIfPresent(zip: JSZip, entryName: string): Promise<TargetAreaLayer | null> {
  const entry = zip.file(entryName)
  if (!entry) return null
  const bytes = await entry.async('uint8array')
  const layer = await readGpkgLayer(bytes, entryName)
  return { columns: layer.columns, records: layer.records, rowCount: layer.rowCount, geometries: layer.geometries }
}

export async function parseTargetAreaZip(blob: Blob): Promise<ParsedTargetAreaResult> {
  const zip = await JSZip.loadAsync(blob)

  const [voronoi, griddedTa, subsetVoronoi, griddedTaSubset] = await Promise.all([
    readLayerIfPresent(zip, 'voronoi'),
    readLayerIfPresent(zip, 'gridded_ta'),
    readLayerIfPresent(zip, 'subset_voronoi'),
    readLayerIfPresent(zip, 'gridded_ta_subset'),
  ])

  return {
    voronoi,
    griddedTa,
    subsetVoronoi,
    griddedTaSubset,
    hasPlannedList: subsetVoronoi !== null || griddedTaSubset !== null,
  }
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

/**
 * Unzips the campaign_day_report.zip blob POST /reports/daily would return
 * (Content-Disposition: attachment; filename="campaign_day_report.zip") and
 * reads out whichever of the four PNG chart images DailyReport.writer
 * (reporting/reporter.py:98-113) produced, matched by its exact filename:
 *
 *   Day {N} Summary Report.png              -> day.summary
 *   Day {N} LGA Report.png                  -> day.breakdown
 *   Day {N} Cumulative Summary Report.png   -> cumulative.summary
 *   Day {N} Cumulative LGA Report.png       -> cumulative.breakdown
 *
 * where {N} is whatever `campaign_day` the route computed from
 * campaign_day_col. See api/client.ts::submitDailyReport for why no real
 * response has ever been produced to confirm this shape against — this
 * mirrors the writer code directly and is kept ready for when the three
 * blocking bugs documented there are fixed, same "ready but not yet
 * reachable" posture as the ZIP parsers above.
 *
 * `dayNumber` is only used to build the filenames to look for — pass null
 * when the request was cumulative-only (once bug #2 there is fixed) to skip
 * looking for the "Day {N}" prefix at all.
 */
export async function parseDailyReportZip(blob: Blob, dayNumber: number | null): Promise<ParsedDailyReportResult> {
  const zip = await JSZip.loadAsync(blob)

  async function readImage(filename: string): Promise<DailyReportChartImage | null> {
    const entry = zip.file(filename)
    if (!entry) return null
    const bytes = await entry.async('blob')
    return { filename, url: URL.createObjectURL(bytes) }
  }

  if (dayNumber === null) {
    return { day: null, cumulative: null }
  }

  const prefix = `Day ${dayNumber}`
  const [daySummary, dayBreakdown, cummSummary, cummBreakdown] = await Promise.all([
    readImage(`${prefix} Summary Report.png`),
    readImage(`${prefix} LGA Report.png`),
    readImage(`${prefix} Cumulative Summary Report.png`),
    readImage(`${prefix} Cumulative LGA Report.png`),
  ])

  return {
    day: daySummary && dayBreakdown ? { summary: daySummary, breakdown: dayBreakdown } : null,
    cumulative: cummSummary && cummBreakdown ? { summary: cummSummary, breakdown: cummBreakdown } : null,
  }
}

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
