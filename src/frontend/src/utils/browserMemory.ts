// Estimates how much JS heap this browser tab can realistically use, and
// how the compiled tracks result compares against it — used by
// components/compilerTracks/TracksPage.tsx to decide whether it's safe to
// parse the result GeoPackage into points and render them as Leaflet
// markers on the page, or whether that would risk freezing/crashing the
// tab and the file should just be offered as a direct download instead.
//
// There is no standard, cross-browser API for "how much memory do I have
// left" — `performance.memory` (Chrome/Edge/other Chromium browsers only;
// not Firefox or Safari) is the closest thing: `jsHeapSizeLimit` is the JS
// engine's own ceiling for this tab's heap, which is what actually
// freezes/crashes the tab when exceeded, not total device RAM. Where it's
// unavailable this falls back to `navigator.deviceMemory` (also
// Chromium-only, and only ever one of a handful of rounded values like
// 0.25/0.5/1/2/4/8 — never an exact figure) as a rough proxy for device
// capability, capped at a sane per-tab ceiling since a single tab's heap is
// capped well below total device RAM even on a high-memory machine. If
// neither API exists at all (Firefox, Safari), this falls back to a fixed
// conservative budget.

interface PerformanceMemory {
  jsHeapSizeLimit: number
  totalJSHeapSize: number
  usedJSHeapSize: number
}

export type MemoryBudgetSource = 'jsHeapSizeLimit' | 'deviceMemory' | 'default'

// Chromium desktop's default V8 heap ceiling for a single tab, regardless
// of device RAM, absent explicit --max-old-space-size flags — used both as
// the cap applied to the deviceMemory-based estimate below, and as the
// fixed fallback when neither browser API is available at all.
const DEFAULT_HEAP_BUDGET_BYTES = 2 * 1024 ** 3 // 2 GB

export interface MemoryBudget {
  bytes: number
  source: MemoryBudgetSource
}

export function getEstimatedMemoryBudgetBytes(): MemoryBudget {
  const memory = (performance as unknown as { memory?: PerformanceMemory }).memory
  if (memory?.jsHeapSizeLimit) {
    return { bytes: memory.jsHeapSizeLimit, source: 'jsHeapSizeLimit' }
  }

  const deviceMemoryGb = (navigator as unknown as { deviceMemory?: number }).deviceMemory
  if (typeof deviceMemoryGb === 'number' && deviceMemoryGb > 0) {
    return { bytes: Math.min(deviceMemoryGb * 1024 ** 3, DEFAULT_HEAP_BUDGET_BYTES), source: 'deviceMemory' }
  }

  return { bytes: DEFAULT_HEAP_BUDGET_BYTES, source: 'default' }
}

// Rough multiplier from the raw compiled .gpkg's byte size to its actual
// in-memory footprint once parsed + rendered: sql.js loads the whole file
// into its own WASM heap (~1x), every row is duplicated again as a plain JS
// TrackPoint plus its full `raw` column record (~1-2x), and each visible
// point adds its own Leaflet marker/layer object on top before clustering
// can amortize any of it (~1-2x more). This is a deliberately rough,
// tunable estimate rather than a measurement — if real-world use shows this
// warning firing too early or too late, this is the one knob to adjust.
export const PARSED_FOOTPRINT_MULTIPLIER = 4

// "within 80% of the browser memory" — the threshold this feature was
// asked to warn at.
export const MEMORY_WARNING_THRESHOLD = 0.8

export interface TracksMemoryCheck {
  rawSizeBytes: number
  estimatedFootprintBytes: number
  budgetBytes: number
  budgetSource: MemoryBudgetSource
  ratio: number
  isRisky: boolean
}

// `rawSizeBytes` is the compiled tracks file exactly as returned by the
// server (Blob.size) — see components/compilerTracks/TracksPage.tsx.
export function checkTracksMemoryRisk(rawSizeBytes: number): TracksMemoryCheck {
  const { bytes: budgetBytes, source: budgetSource } = getEstimatedMemoryBudgetBytes()
  const estimatedFootprintBytes = rawSizeBytes * PARSED_FOOTPRINT_MULTIPLIER
  const ratio = budgetBytes > 0 ? estimatedFootprintBytes / budgetBytes : 0
  return {
    rawSizeBytes,
    estimatedFootprintBytes,
    budgetBytes,
    budgetSource,
    ratio,
    isRisky: ratio >= MEMORY_WARNING_THRESHOLD,
  }
}

// ---------------------------------------------------------------------------
// Target Area batching — added for the large multi-state GeoPackage results
// utils/targetAreaBatchLoader.ts reads incrementally instead of all at once.
//
// Originally 6x, back when this also accounted for decoded WKB polygon
// geometry plus Leaflet vector layers — the map was removed, and with it
// went the geometry SELECT entirely (utils/gpkg.ts's openGpkgLayer reads
// attribute columns only now), so that cost no longer applies here at all.
//
// Recalibrated down to 1x, but with an important caveat this formula still
// glosses over: `rawLayerBytes` (this layer's whole .gpkg file size, passed
// into estimateTargetAreaBatchRows below) is dominated by the geometry data
// ON DISK, even though that geometry is never loaded into JS anymore — only
// sql.js's WASM-side `new SQL.Database(bytes)` still copies the FULL file
// (geometry included) into its own heap once, when a layer is opened, as a
// fixed one-time cost per layer, not a per-batch one. The actual per-row
// JS cost from here on is just a small plain object (a handful of
// strings/numbers) per attribute record — much smaller than file-size/rowCount
// would suggest. Since this formula still uses raw file bytes as its proxy
// for per-row cost (kept for simplicity — batching is now a safety net,
// not the primary defense, per the decision to keep it after the map was
// dropped), erring on 1x rather than lower keeps batches on the smaller,
// more-checkpoints side rather than the larger, fewer-checkpoints side —
// the safe direction for an approximate estimate to be wrong in.
export const TARGET_AREA_FOOTPRINT_MULTIPLIER = 1

// Row-count floor/ceiling for a single render batch, independent of the
// byte-budget math below — keeps batches from being pathologically tiny
// (too many render passes, too much per-batch overhead) or pathologically
// large (defeats the point of batching) even at extreme size estimates.
const MIN_TARGET_AREA_BATCH_ROWS = 100
const MAX_TARGET_AREA_BATCH_ROWS = 5000

// Derives a safe per-batch row count for one Target Area layer from its raw
// on-disk byte size and row count. Each batch is sized to roughly 5% of the
// estimated budget rather than the whole thing, so a run has enough
// increments to check memory between batches and stop cleanly instead of
// one or two huge batches that blow past the warning threshold in a single
// step — and so there's still headroom left for the OTHER layers being read
// alongside this one in the same batch iteration (see
// utils/targetAreaBatchLoader.ts, which reads voronoi + gridded-TA + the
// planned-list variants together per iteration, not one layer at a time).
export function estimateTargetAreaBatchRows(rawLayerBytes: number, rowCount: number, budgetBytes: number): number {
  if (rowCount <= 0) return 0
  const perRowFootprint = (rawLayerBytes * TARGET_AREA_FOOTPRINT_MULTIPLIER) / rowCount
  if (perRowFootprint <= 0) return Math.min(rowCount, MAX_TARGET_AREA_BATCH_ROWS)
  const targetBatchBytes = budgetBytes * 0.05
  const rows = Math.floor(targetBatchBytes / perRowFootprint)
  return Math.min(MAX_TARGET_AREA_BATCH_ROWS, Math.max(MIN_TARGET_AREA_BATCH_ROWS, rows, 1))
}

export interface LiveMemoryReading {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
  ratio: number
}

// Live heap usage, checked BETWEEN batches in addition to (not instead of)
// the static per-batch size estimate above: estimateTargetAreaBatchRows
// decides how big each batch is up front from a byte-size guess;
// usedJSHeapSize is the browser's own report of what's actually being used
// right now, across everything in the tab, so it's the more authoritative
// signal where it's available. Chromium-only (see the module note at the
// top of this file) — returns null on browsers without performance.memory,
// in which case callers should fall back to their own cumulative estimate.
export function readLiveMemory(): LiveMemoryReading | null {
  const memory = (performance as unknown as { memory?: PerformanceMemory }).memory
  if (!memory?.jsHeapSizeLimit) return null
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    ratio: memory.usedJSHeapSize / memory.jsHeapSizeLimit,
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}
