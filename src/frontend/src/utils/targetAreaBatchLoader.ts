import type { ParsedTargetAreaResult, TargetAreaLayer, TargetAreaRecord } from '../types/targetArea'
import { openTargetAreaZip } from '../api/parseResult'
import type { TargetAreaLayerKey } from '../api/parseResult'
import {
  getEstimatedMemoryBudgetBytes,
  estimateTargetAreaBatchRows,
  readLiveMemory,
  MEMORY_WARNING_THRESHOLD,
  TARGET_AREA_FOOTPRINT_MULTIPLIER,
} from './browserMemory'

interface LayerLoadState {
  columns: string[]
  records: TargetAreaRecord[]
  rowCount: number
  offset: number
  batchSize: number
  rawBytes: number
}

// Hard cap on loop iterations, purely as a bug guard (e.g. a malformed
// batchSize estimate stuck at 0 would otherwise spin forever) — real runs
// finish in well under this many iterations, since batches are sized as a
// fraction of the memory budget rather than a fixed small count.
const MAX_ITERATIONS = 2000

function snapshot(
  states: Map<TargetAreaLayerKey, LayerLoadState>,
  hasPlannedList: boolean,
  memoryLimited: boolean,
): ParsedTargetAreaResult {
  function toLayer(key: TargetAreaLayerKey): TargetAreaLayer | null {
    const s = states.get(key)
    if (!s) return null
    return {
      columns: s.columns,
      records: s.records,
      rowCount: s.rowCount,
      loadedCount: s.offset,
    }
  }
  return {
    voronoi: toLayer('voronoi'),
    griddedTa: toLayer('griddedTa'),
    subsetVoronoi: toLayer('subsetVoronoi'),
    griddedTaSubset: toLayer('griddedTaSubset'),
    hasPlannedList,
    memoryLimited,
  }
}

/**
 * Reads the Target Area response ZIP's GeoPackage layers — ATTRIBUTE
 * COLUMNS ONLY, no geometry (see utils/gpkg.ts's openGpkgLayer) — in
 * memory-budget-sized batches, calling onProgress after each batch with the
 * cumulatively-grown result so the UI (summary cards, volume chart) can
 * update progressively instead of waiting on one giant synchronous parse.
 *
 * This originally also decoded and rendered polygon geometry for a Leaflet
 * map, which was the dominant memory cost — see the "is this possible"
 * design discussion in chat: at large multi-state scale, WKB decode +
 * Leaflet vector layers were the likely actual OOM cause. Once the map was
 * removed (the summary cards/chart never needed geometry, only attribute
 * records and row counts), geometry was dropped from the read path
 * entirely — not just left unrendered. Batching was kept anyway, at the
 * user's choice, as a safety net for attribute-only data at very large
 * scale, even though that data is far lighter than the polygon+map path
 * ever was.
 *
 * Every layer present in the zip is read TOGETHER each iteration — one
 * batch = one slice from EACH not-yet-exhausted layer (voronoi, gridded_ta,
 * and, when a planned list was uploaded, subset_voronoi/gridded_ta_subset)
 * — rather than finishing one layer before starting the next, per how this
 * was scoped. Layers are NOT row-aligned with each other (voronoi is
 * per-settlement, gridded_ta is per-grid-cell — different row counts, no
 * shared ordering), so "batch N" means iteration N of each layer's own
 * independent LIMIT/OFFSET paging, not a shared row range; a layer that
 * finishes early (or is entirely absent, e.g. no planned list) simply stops
 * contributing to later iterations while the others continue.
 *
 * Reused chunks_manager.py's CPU_COUNT-based chunk size was considered and
 * rejected (see chat) — it answers a server-side parallelism question, and
 * its boundaries don't survive into this response's shape at all (each zip
 * entry is one flat merged table). Batch size here instead comes from
 * utils/browserMemory.ts's memory-budget estimate, the same family of
 * technique Compiler Tracks already uses for its own OOM warning.
 *
 * Stops early — leaving `memoryLimited: true` on the final snapshot and
 * shorter `records` arrays than `rowCount` on whichever layers weren't
 * finished — once heap usage crosses MEMORY_WARNING_THRESHOLD, checked live
 * via performance.memory where available (Chromium only, readLiveMemory),
 * falling back to the same static per-batch byte estimate used to size
 * batches on browsers without that API. The raw ZIP blob itself is
 * untouched by any of this and stays fully downloadable regardless of where
 * loading stops — see TargetAreaPage.tsx's resultBlob; it's also still the
 * real spatial data (voronoi/gridded-TA polygons) — this file just never
 * loads that geometry into the browser's own heap anymore.
 */
export async function loadTargetAreaInBatches(
  zipBlob: Blob,
  onProgress: (partial: ParsedTargetAreaResult) => void,
): Promise<void> {
  const { layers, hasPlannedList } = await openTargetAreaZip(zipBlob)

  if (layers.length === 0) {
    onProgress(snapshot(new Map(), hasPlannedList, false))
    return
  }

  const { bytes: budgetBytes } = getEstimatedMemoryBudgetBytes()

  const states = new Map<TargetAreaLayerKey, LayerLoadState>()
  for (const { key, rawBytes, handle } of layers) {
    states.set(key, {
      columns: handle.columns,
      records: [],
      rowCount: handle.rowCount,
      offset: 0,
      batchSize: estimateTargetAreaBatchRows(rawBytes, handle.rowCount, budgetBytes),
      rawBytes,
    })
  }

  // Running static estimate of this run's own footprint, used only as a
  // fallback where the browser exposes no live heap reading at all (see
  // readLiveMemory).
  let cumulativeEstimatedBytes = 0
  let memoryLimited = false

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let readAnything = false

      for (const { key, handle } of layers) {
        const state = states.get(key)!
        if (state.offset >= state.rowCount) continue

        const { records } = handle.readBatch(state.offset, state.batchSize)
        if (records.length === 0) {
          state.offset = state.rowCount
          continue
        }

        state.records.push(...records)
        state.offset += records.length
        cumulativeEstimatedBytes += (state.rawBytes * TARGET_AREA_FOOTPRINT_MULTIPLIER * records.length) / Math.max(state.rowCount, 1)
        readAnything = true
      }

      if (!readAnything) break

      onProgress(snapshot(states, hasPlannedList, memoryLimited))

      // Yield to the browser between batches so the tab can paint what was
      // just added (and so a GC pass has a chance to run) instead of one
      // long unbroken synchronous stretch for the whole result.
      await new Promise((resolve) => setTimeout(resolve, 0))

      const live = readLiveMemory()
      const ratio = live ? live.ratio : budgetBytes > 0 ? cumulativeEstimatedBytes / budgetBytes : 0
      if (ratio >= MEMORY_WARNING_THRESHOLD) {
        memoryLimited = true
        break
      }
    }
  } finally {
    layers.forEach((l) => l.handle.close())
  }

  onProgress(snapshot(states, hasPlannedList, memoryLimited))
}
