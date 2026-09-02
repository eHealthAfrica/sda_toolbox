import { useEffect, useMemo, useState } from 'react'
import { ApiError, submitGenerateTA } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { loadTargetAreaInBatches } from '../../utils/targetAreaBatchLoader'
import { parseSettlementKeySet } from '../../utils/targetAreaReference'
import type { ParsedTargetAreaResult, TargetAreaFormInput, TargetAreaLayer } from '../../types/targetArea'
import { detectColumns } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import {
  computeStateSettlementBreakdown,
  countUniqueKeys,
  differenceSize,
  filterKeySetByState,
  filterRecordsByState,
  intersectionSize,
  lgaKey,
  settlementKey,
  uniqueKeySet,
  wardKey,
} from '../../utils/targetAreaAggregate'
import TargetAreaForm from './TargetAreaForm'
import TargetAreaSummaryCards from './TargetAreaSummaryCards'
import TAVolumeChart from './TAVolumeChart'
import TargetAreaStateChart from './TargetAreaStateChart'
// The polygon map (TargetAreaMap.tsx) was removed — the summary cards and
// volume chart below never needed decoded geometry, only attribute records
// and row counts, and the real spatial output is still the downloadable
// response ZIP. TargetAreaMap.tsx itself is now dead code left on disk (this
// session can't delete files on your machine) — see the delivery note.

interface TargetAreaAnalysis {
  columns: DetectedColumns
  totalStates: number
  totalLgas: number
  totalWards: number
  totalSettlements: number
  foundInVoronoiAndGridded: number
  missingVoronoi: number
  missingVoronoiReference: 'mlos' | 'gridded'
  plannedListSettlements: number
  hasPlannedList: boolean
  plannedListSource: 'file' | 'voronoi-proxy' | 'unreadable'
  plannedFoundInVoronoiAndGridded: number
  plannedMissingVoronoi: number
  voronoiCount: number
  griddedCount: number
}

export default function TargetAreaPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedTargetAreaResult | null>(null)
  // The raw ZIP blob POST /ta/generate_ta returned — kept alongside the
  // parsed layers purely so "Download results" hands back the server's
  // actual file, same blob-retention pattern as Compiler Tracks (TracksPage.tsx).
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [sourceName, setSourceName] = useState<string | null>(null)
  // True reference sets read client-side from the raw uploads (before/while
  // the request is in flight) — see utils/targetAreaReference.ts for why
  // this exists: gridded_ta/voronoi alone can't tell you what's MISSING,
  // only what's present, so the "settlements without a voronoi TA" cards
  // need the actual upload as ground truth. Both are null until a run
  // completes; masterListSet stays null forever if mlosFile was somehow
  // absent (shouldn't happen — submitGenerateTA itself requires it),
  // plannedListSet stays null if no planned list was uploaded OR its file
  // couldn't be parsed (see plannedListFileProvided to tell those apart).
  const [masterListSet, setMasterListSet] = useState<Set<string> | null>(null)
  const [plannedListSet, setPlannedListSet] = useState<Set<string> | null>(null)
  const [plannedListFileProvided, setPlannedListFileProvided] = useState(false)
  // Set by clicking a state's bar on either state chart below — filters the
  // summary cards (and both state charts' own dimming) to that state.
  // Clicking the same state again clears it (see toggleSelectedState).
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  function toggleSelectedState(state: string) {
    setSelectedState((prev) => (prev === state ? null : state))
  }

  async function handleSubmit(input: TargetAreaFormInput) {
    setSubmitting(true)
    setError(null)
    setResultBlob(null)
    setResult(null)
    setSelectedState(null)
    const jobId = startJob('target-area', input.mlosFile?.name ?? 'Target Area generation run')
    try {
      const [zipBlob, masterSet, plannedSet] = await Promise.all([
        submitGenerateTA(input),
        input.mlosFile ? parseSettlementKeySet(input.mlosFile) : Promise.resolve(null),
        input.plannedListFile ? parseSettlementKeySet(input.plannedListFile) : Promise.resolve(null),
      ])
      // "Download results" hands back this raw blob regardless of how far
      // the batched parse/render below gets — set it up front so it's
      // available even if loadTargetAreaInBatches stops early on memory.
      setResultBlob(zipBlob)
      setSourceName(input.mlosFile ? input.mlosFile.name.split('.')[0] : 'target_area')
      setMasterListSet(masterSet)
      setPlannedListSet(plannedSet)
      setPlannedListFileProvided(Boolean(input.plannedListFile))

      // Parses in memory-budget-sized batches (voronoi + gridded, and their
      // planned-list counterparts, together per batch) instead of one
      // all-at-once parse — see utils/targetAreaBatchLoader.ts. Each call
      // grows `result` further; the summary cards/chart below read it
      // progressively as it fills in.
      await loadTargetAreaInBatches(zipBlob, setResult)

      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while generating the target area.')
      }
      setResult(null)
      setResultBlob(null)
      setMasterListSet(null)
      setPlannedListSet(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  const downloadUrl = useMemo(() => (resultBlob ? URL.createObjectURL(resultBlob) : null), [resultBlob])
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    }
  }, [downloadUrl])

  const analysis = useMemo<TargetAreaAnalysis | null>(() => {
    if (!result || !result.voronoi) return null

    const columns = detectColumns(result.voronoi.columns)
    const voronoiRecords = filterRecordsByState(result.voronoi.records, columns.state, selectedState)
    const voronoiSet = uniqueKeySet(voronoiRecords, (r) =>
      settlementKey(r, columns.state, columns.lga, columns.ward, columns.settlement),
    )

    const griddedColumns = result.griddedTa ? detectColumns(result.griddedTa.columns) : null
    const griddedRecords = griddedColumns ? filterRecordsByState(result.griddedTa!.records, griddedColumns.state, selectedState) : []
    const griddedSet = griddedColumns
      ? uniqueKeySet(griddedRecords, (r) =>
          settlementKey(r, griddedColumns.state, griddedColumns.lga, griddedColumns.ward, griddedColumns.settlement),
        )
      : new Set<string>()

    const foundInVoronoiAndGridded = intersectionSize(voronoiSet, griddedSet)

    // Prefer the TRUE reference — the raw MLoS upload, parsed client-side —
    // over a voronoi-vs-gridded diff, since a settlement absent from BOTH
    // outputs would be invisible to a voronoi-vs-gridded-only comparison.
    // Only fall back to the weaker gridded-vs-voronoi diff if the upload
    // itself couldn't be re-read (masterListSet null). Both reference sets
    // are scoped to selectedState (a no-op when null) via filterKeySetByState
    // so a state selection filters the "missing" counts too, not just the
    // "found" ones.
    const scopedMasterListSet = masterListSet ? filterKeySetByState(masterListSet, selectedState) : null
    const missingVoronoi = scopedMasterListSet
      ? differenceSize(scopedMasterListSet, voronoiSet)
      : differenceSize(griddedSet, voronoiSet)
    const missingVoronoiReference: 'mlos' | 'gridded' = scopedMasterListSet ? 'mlos' : 'gridded'

    const subsetVoronoiColumns = result.subsetVoronoi ? detectColumns(result.subsetVoronoi.columns) : null
    const subsetVoronoiRecords = subsetVoronoiColumns
      ? filterRecordsByState(result.subsetVoronoi!.records, subsetVoronoiColumns.state, selectedState)
      : []
    const subsetVoronoiSet = subsetVoronoiColumns
      ? uniqueKeySet(subsetVoronoiRecords, (r) =>
          settlementKey(
            r,
            subsetVoronoiColumns.state,
            subsetVoronoiColumns.lga,
            subsetVoronoiColumns.ward,
            subsetVoronoiColumns.settlement,
          ),
        )
      : new Set<string>()

    const griddedSubsetColumns = result.griddedTaSubset ? detectColumns(result.griddedTaSubset.columns) : null
    const griddedSubsetRecords = griddedSubsetColumns
      ? filterRecordsByState(result.griddedTaSubset!.records, griddedSubsetColumns.state, selectedState)
      : []
    const griddedSubsetSet = griddedSubsetColumns
      ? uniqueKeySet(griddedSubsetRecords, (r) =>
          settlementKey(
            r,
            griddedSubsetColumns.state,
            griddedSubsetColumns.lga,
            griddedSubsetColumns.ward,
            griddedSubsetColumns.settlement,
          ),
        )
      : new Set<string>()

    // Prefer the true planned-list upload, parsed client-side, as both the
    // count AND the reference for "missing a voronoi TA" — same "parse for
    // ground truth" rationale as the top-level MLoS check above. Only fall
    // back to the subset voronoi output itself (a proxy — it can only ever
    // show settlements that DID get a voronoi TA) when the planned-list
    // file was uploaded but couldn't be re-parsed.
    let plannedListSettlements = 0
    let plannedListSource: 'file' | 'voronoi-proxy' | 'unreadable' = 'unreadable'
    let plannedMissingVoronoi = 0
    const scopedPlannedListSet = plannedListSet ? filterKeySetByState(plannedListSet, selectedState) : null
    if (result.hasPlannedList) {
      if (scopedPlannedListSet) {
        plannedListSettlements = scopedPlannedListSet.size
        plannedListSource = 'file'
        plannedMissingVoronoi = differenceSize(scopedPlannedListSet, subsetVoronoiSet)
      } else if (plannedListFileProvided) {
        plannedListSettlements = subsetVoronoiSet.size
        plannedListSource = 'voronoi-proxy'
        plannedMissingVoronoi = differenceSize(griddedSubsetSet, subsetVoronoiSet)
      } else {
        plannedListSettlements = subsetVoronoiSet.size
        plannedListSource = 'unreadable'
        plannedMissingVoronoi = differenceSize(griddedSubsetSet, subsetVoronoiSet)
      }
    }

    const plannedFoundInVoronoiAndGridded = result.hasPlannedList ? intersectionSize(subsetVoronoiSet, griddedSubsetSet) : 0

    return {
      columns,
      totalStates: countUniqueKeys(voronoiRecords, (r) => (columns.state ? String(r[columns.state] ?? '').trim() || null : null)),
      totalLgas: countUniqueKeys(voronoiRecords, (r) => lgaKey(r, columns.state, columns.lga)),
      totalWards: countUniqueKeys(voronoiRecords, (r) => wardKey(r, columns.state, columns.lga, columns.ward)),
      totalSettlements: voronoiSet.size,
      foundInVoronoiAndGridded,
      missingVoronoi,
      missingVoronoiReference,
      plannedListSettlements,
      hasPlannedList: result.hasPlannedList,
      plannedListSource,
      plannedFoundInVoronoiAndGridded,
      plannedMissingVoronoi,
      // Falls back to filtered records' length (rather than the authoritative
      // rowCount from SELECT COUNT(*)) once a state is selected — rowCount
      // covers the whole layer, but state isn't knowable for rows a batched
      // load hasn't reached yet, so a per-state count can only reflect what's
      // loaded so far. Byte-identical to before when selectedState is null.
      voronoiCount: selectedState ? voronoiRecords.length : result.voronoi.rowCount,
      griddedCount: selectedState ? griddedRecords.length : result.griddedTa?.rowCount ?? 0,
    }
  }, [result, masterListSet, plannedListSet, plannedListFileProvided, selectedState])

  // Per-state unique-settlement breakdowns feeding the two click-to-filter
  // charts below. Unlike `analysis` above, these are never themselves scoped
  // to selectedState — they always show every state so the chart stays a
  // full picture with the active one highlighted (see TargetAreaStateChart).
  const voronoiStateBreakdown = useMemo(() => {
    if (!result?.voronoi) return []
    const primaryColumns = detectColumns(result.voronoi.columns)
    const subsetColumns = result.subsetVoronoi ? detectColumns(result.subsetVoronoi.columns) : primaryColumns
    return computeStateSettlementBreakdown(result.voronoi.records, primaryColumns, result.subsetVoronoi?.records ?? [], subsetColumns)
  }, [result?.voronoi, result?.subsetVoronoi])

  const griddedStateBreakdown = useMemo(() => {
    if (!result?.griddedTa) return []
    const primaryColumns = detectColumns(result.griddedTa.columns)
    const subsetColumns = result.griddedTaSubset ? detectColumns(result.griddedTaSubset.columns) : primaryColumns
    return computeStateSettlementBreakdown(
      result.griddedTa.records,
      primaryColumns,
      result.griddedTaSubset?.records ?? [],
      subsetColumns,
    )
  }, [result?.griddedTa, result?.griddedTaSubset])

  // How much of the batched load has come in so far, across every present
  // layer — drives the "still loading" progress line and the memory-limit
  // banner below. `loadedCount` falls back to the layer's full length for a
  // layer that was never batch-loaded (shouldn't happen via handleSubmit
  // above, but keeps this safe if `result` is ever set some other way).
  const loadProgress = useMemo(() => {
    if (!result) return null
    const layers = [result.voronoi, result.griddedTa, result.subsetVoronoi, result.griddedTaSubset].filter(
      (l): l is TargetAreaLayer => l !== null,
    )
    if (layers.length === 0) return null
    const loaded = layers.reduce((sum, l) => sum + (l.loadedCount ?? l.records.length), 0)
    const total = layers.reduce((sum, l) => sum + l.rowCount, 0)
    return { loaded, total, complete: loaded >= total }
  }, [result])

  return (
    <div>
      <TargetAreaForm onSubmit={handleSubmit} submitting={submitting} />

      {error && (
        <div
          style={{
            background: '#fbe6e6',
            border: '1px solid #f0b8b8',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 12.5,
            color: 'var(--color-critical)',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {submitting && !result && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Generating target areas…
        </div>
      )}

      {submitting && loadProgress && !loadProgress.complete && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 0 12px', textAlign: 'center' }}>
          Processing… {loadProgress.loaded.toLocaleString()} of {loadProgress.total.toLocaleString()} records loaded
        </div>
      )}

      {result?.memoryLimited && loadProgress && (
        <div
          style={{
            background: '#fff4e0',
            border: '1px solid #f0d090',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 12.5,
            color: '#8a5a00',
            marginBottom: 16,
          }}
        >
          ⚠ Processing stopped early to avoid running out of browser memory — {loadProgress.loaded.toLocaleString()} of{' '}
          {loadProgress.total.toLocaleString()} records were counted toward the summary above. The full result is
          still available via "Download results" below.
        </div>
      )}

      {result && !result.voronoi && !submitting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          The server returned no voronoi target area layer for this run.
        </div>
      )}

      {analysis && (
        <>
          {downloadUrl && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <a
                href={downloadUrl}
                download={`${sourceName ?? 'target_area'}_target_area.zip`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--color-primary)',
                  color: '#fff',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 14px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                ⬇ Download results (.zip)
              </a>
            </div>
          )}
          {selectedState && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
                fontSize: 12.5,
                color: 'var(--color-text-muted)',
              }}
            >
              Filtered to <strong style={{ color: 'var(--color-text)' }}>{selectedState}</strong>
              <button
                type="button"
                onClick={() => setSelectedState(null)}
                style={{
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  borderRadius: 'var(--radius-md)',
                  padding: '2px 10px',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  color: 'var(--color-text)',
                }}
              >
                Clear
              </button>
            </div>
          )}
          <TargetAreaSummaryCards
            totalStates={analysis.totalStates}
            totalLgas={analysis.totalLgas}
            totalWards={analysis.totalWards}
            totalSettlements={analysis.totalSettlements}
            foundInVoronoiAndGridded={analysis.foundInVoronoiAndGridded}
            missingVoronoi={analysis.missingVoronoi}
            missingVoronoiReference={analysis.missingVoronoiReference}
            plannedListSettlements={analysis.plannedListSettlements}
            hasPlannedList={analysis.hasPlannedList}
            plannedListSource={analysis.plannedListSource}
            plannedFoundInVoronoiAndGridded={analysis.plannedFoundInVoronoiAndGridded}
            plannedMissingVoronoi={analysis.plannedMissingVoronoi}
          />
          <TAVolumeChart voronoiCount={analysis.voronoiCount} griddedCount={analysis.griddedCount} />
          <TargetAreaStateChart
            title="Voronoi target areas by state"
            data={voronoiStateBreakdown}
            primaryLabel="Voronoi settlements"
            subsetLabel="Planned settlements — voronoi"
            primaryColor="#4a86e8"
            subsetColor="#16a596"
            hasSubset={analysis.hasPlannedList}
            activeState={selectedState}
            onSelect={toggleSelectedState}
          />
          <TargetAreaStateChart
            title="Gridded target areas by state"
            data={griddedStateBreakdown}
            primaryLabel="Gridded TA settlements"
            subsetLabel="Planned settlements — gridded TA"
            primaryColor="#8e44ad"
            subsetColor="#d03b3b"
            hasSubset={analysis.hasPlannedList}
            activeState={selectedState}
            onSelect={toggleSelectedState}
          />
        </>
      )}

      {!result && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a master list of settlements above to generate voronoi and gridded target areas.
        </div>
      )}
    </div>
  )
}
