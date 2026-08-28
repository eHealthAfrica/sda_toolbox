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

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}
