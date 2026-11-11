import { useEffect, useMemo, useState } from 'react'
import { ApiError, submitGenerateBufferTA } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { loadTargetAreaInBatches } from '../../utils/targetAreaBatchLoader'
import { parseSettlementReference } from '../../utils/targetAreaReference'
import type { SettlementReference } from '../../utils/targetAreaReference'
import type { BufferTargetAreaFormInput, ParsedTargetAreaResult, TargetAreaLayer, TargetAreaRecord } from '../../types/targetArea'
import { detectColumns } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import {
  computeTargetAreaGeoBreakdown,
  countUniqueKeys,
  differenceSize,
  filterRecordsByGeo,
  intersectionSize,
  lgaKey,
  settlementKey,
  uniqueKeySet,
  wardKey,
} from '../../utils/targetAreaAggregate'
import TargetAreaBufferForm from './TargetAreaBufferForm'
import TargetAreaBufferSummaryCards from './TargetAreaBufferSummaryCards'
import TAVolumeChart from './TAVolumeChart'
import TargetAreaGeoBreakdownTable from './TargetAreaGeoBreakdownTable'

// The buffer-strategy TA generator (POST /ta/generate_ta/buffer) is a
// simpler cousin of TargetAreaPage's own /ta/generate_ta: there's exactly
// one input file — the planned settlement list — which doubles as both the
// geometry source AND the "ground truth" reference for the missing-voronoi
// check, so there's no separate MLoS-vs-planned-subset distinction, no
// subset_voronoi/gridded_ta_subset layers, and no "Location type" drill
// dimension. Everything below reuses the same batched-parse pipeline and
// State/LGA/Ward breakdown machinery TargetAreaPage uses, just with those
// planned-list-specific pieces left out entirely rather than passed as
// always-empty placeholders threaded through page-local state.

interface TargetAreaBufferAnalysis {
  columns: DetectedColumns
  totalStates: number
  totalLgas: number
  totalWards: number
  totalSettlements: number
  foundInVoronoiAndGridded: number
  missingVoronoi: number
  voronoiCount: number
  griddedCount: number
}

export default function TargetAreaBufferPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedTargetAreaResult | null>(null)
  // Raw ZIP blob the endpoint returned, kept alongside the parsed layers so
  // "Download results" hands back the server's actual file — same
  // blob-retention pattern as TargetAreaPage.tsx/TracksPage.tsx.
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [sourceName, setSourceName] = useState<string | null>(null)
  // The uploaded planned settlement list, re-parsed client-side as ground
  // truth for the "missing a voronoi TA" check and for grouping the geo
  // breakdown table — same "parse the raw upload" rationale as
  // TargetAreaPage.tsx's masterListRef, just against this endpoint's only
  // input file instead of an MLoS file.
  const [settlementListRef, setSettlementListRef] = useState<SettlementReference | null>(null)
  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  const [drillWard, setDrillWard] = useState<string | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  function handleDrillStateChange(state: string | null) {
    setDrillState(state)
    setDrillLga(null)
    setDrillWard(null)
  }
  function handleDrillLgaChange(lga: string | null) {
    setDrillLga(lga)
    setDrillWard(null)
  }
  function clearDrill() {
    setDrillState(null)
    setDrillLga(null)
    setDrillWard(null)
  }

  async function handleSubmit(input: BufferTargetAreaFormInput) {
    setSubmitting(true)
    setError(null)
    setResultBlob(null)
    setResult(null)
    clearDrill()
    const jobId = startJob('target-area-buffer', input.plannedSettlementListFile?.name ?? 'Buffer target area generation run')
    try {
      const [zipBlob, settlementRef] = await Promise.all([
        submitGenerateBufferTA(input),
        input.plannedSettlementListFile ? parseSettlementReference(input.plannedSettlementListFile) : Promise.resolve(null),
      ])
      setResultBlob(zipBlob)
      setSourceName(input.plannedSettlementListFile ? input.plannedSettlementListFile.name.split('.')[0] : 'buffer_target_area')
      setSettlementListRef(settlementRef)

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
      setSettlementListRef(null)
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

  // Full (undrilled) State/LGA/Ward breakdown feeding TargetAreaGeoBreakdownTable
  // below — same shape TargetAreaPage builds, just with every "planned"
  // argument passed as empty/null since this endpoint has no subset layers.
  const geoBreakdown = useMemo(() => {
    if (!result?.voronoi) return []
    const voronoiColumns = detectColumns(result.voronoi.columns)
    const griddedColumns = result.griddedTa ? detectColumns(result.griddedTa.columns) : null
    return computeTargetAreaGeoBreakdown(
      settlementListRef?.records ?? [],
      settlementListRef?.columns ?? null,
      result.voronoi.records,
      voronoiColumns,
      result.griddedTa?.records ?? [],
      griddedColumns,
      [],
      null,
      [],
      null,
      [],
      null,
    )
  }, [result, settlementListRef])

  const geoStateOptions = useMemo(
    () => Array.from(new Set(geoBreakdown.map((r) => r.state).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [geoBreakdown],
  )
  const geoLgaOptions = useMemo(() => {
    const scope = drillState ? geoBreakdown.filter((r) => r.state === drillState) : geoBreakdown
    return Array.from(new Set(scope.map((r) => r.lga).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [geoBreakdown, drillState])
  const geoWardOptions = useMemo(() => {
    let scope = geoBreakdown
    if (drillState) scope = scope.filter((r) => r.state === drillState)
    if (drillLga) scope = scope.filter((r) => r.lga === drillLga)
    return Array.from(new Set(scope.map((r) => r.ward).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [geoBreakdown, drillState, drillLga])

  const filteredGeoBreakdown = useMemo(
    () =>
      geoBreakdown.filter(
        (r) => (!drillState || r.state === drillState) && (!drillLga || r.lga === drillLga) && (!drillWard || r.ward === drillWard),
      ),
    [geoBreakdown, drillState, drillLga, drillWard],
  )

  const analysis = useMemo<TargetAreaBufferAnalysis | null>(() => {
    if (!result || !result.voronoi) return null

    function applyDrill(records: TargetAreaRecord[], columns: DetectedColumns | null) {
      return filterRecordsByGeo(records, columns, drillState, drillLga, drillWard)
    }

    const columns = detectColumns(result.voronoi.columns)
    const voronoiRecords = applyDrill(result.voronoi.records, columns)
    const voronoiSet = uniqueKeySet(voronoiRecords, (r) =>
      settlementKey(r, columns.state, columns.lga, columns.ward, columns.settlement),
    )

    const griddedColumns = result.griddedTa ? detectColumns(result.griddedTa.columns) : null
    const griddedRecords = griddedColumns ? applyDrill(result.griddedTa!.records, griddedColumns) : []
    const griddedSet = griddedColumns
      ? uniqueKeySet(griddedRecords, (r) =>
          settlementKey(r, griddedColumns.state, griddedColumns.lga, griddedColumns.ward, griddedColumns.settlement),
        )
      : new Set<string>()

    const foundInVoronoiAndGridded = intersectionSize(voronoiSet, griddedSet)

    // The uploaded planned settlement list is the only reference there is
    // here (there's no separate MLoS file), so — unlike TargetAreaPage,
    // which falls back to a weaker gridded-vs-voronoi diff — this simply
    // shows 0 missing if the upload couldn't be re-parsed client-side,
    // rather than guessing from the outputs alone.
    const scopedSettlementListSet = settlementListRef
      ? uniqueKeySet(applyDrill(settlementListRef.records, settlementListRef.columns), (r) =>
          settlementKey(
            r,
            settlementListRef.columns.state,
            settlementListRef.columns.lga,
            settlementListRef.columns.ward,
            settlementListRef.columns.settlement,
          ),
        )
      : null
    const missingVoronoi = scopedSettlementListSet ? differenceSize(scopedSettlementListSet, voronoiSet) : 0

    return {
      columns,
      totalStates: countUniqueKeys(voronoiRecords, (r) => (columns.state ? String(r[columns.state] ?? '').trim() || null : null)),
      totalLgas: countUniqueKeys(voronoiRecords, (r) => lgaKey(r, columns.state, columns.lga)),
      totalWards: countUniqueKeys(voronoiRecords, (r) => wardKey(r, columns.state, columns.lga, columns.ward)),
      totalSettlements: voronoiSet.size,
      foundInVoronoiAndGridded,
      missingVoronoi,
      voronoiCount: drillState || drillLga || drillWard ? voronoiRecords.length : result.voronoi.rowCount,
      griddedCount: drillState || drillLga || drillWard ? griddedRecords.length : result.griddedTa?.rowCount ?? 0,
    }
  }, [result, settlementListRef, drillState, drillLga, drillWard])

  const loadProgress = useMemo(() => {
    if (!result) return null
    const layers = [result.voronoi, result.griddedTa].filter((l): l is TargetAreaLayer => l !== null)
    if (layers.length === 0) return null
    const loaded = layers.reduce((sum, l) => sum + (l.loadedCount ?? l.records.length), 0)
    const total = layers.reduce((sum, l) => sum + l.rowCount, 0)
    return { loaded, total, complete: loaded >= total }
  }, [result])

  return (
    <div>
      <TargetAreaBufferForm onSubmit={handleSubmit} submitting={submitting} />

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
                download={`${sourceName ?? 'buffer_target_area'}_target_area.zip`}
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
          {(drillState || drillLga || drillWard) && (
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
              Filtered to{' '}
              <strong style={{ color: 'var(--color-text)' }}>{[drillState, drillLga, drillWard].filter(Boolean).join(' › ')}</strong>
              <button
                type="button"
                onClick={clearDrill}
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
          <TargetAreaBufferSummaryCards
            totalStates={analysis.totalStates}
            totalLgas={analysis.totalLgas}
            totalWards={analysis.totalWards}
            totalSettlements={analysis.totalSettlements}
            foundInVoronoiAndGridded={analysis.foundInVoronoiAndGridded}
            missingVoronoi={analysis.missingVoronoi}
          />
          <TAVolumeChart voronoiCount={analysis.voronoiCount} griddedCount={analysis.griddedCount} />
          <TargetAreaGeoBreakdownTable
            data={filteredGeoBreakdown}
            totalCount={geoBreakdown.length}
            hasPlannedList={false}
            filterState={drillState}
            filterLga={drillLga}
            filterWard={drillWard}
            onFilterStateChange={handleDrillStateChange}
            onFilterLgaChange={handleDrillLgaChange}
            onFilterWardChange={setDrillWard}
            stateOptions={geoStateOptions}
            lgaOptions={geoLgaOptions}
            wardOptions={geoWardOptions}
            filterLocationType={null}
            onFilterLocationTypeChange={() => {}}
          />
        </>
      )}

      {!result && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a planned settlement list above to generate a buffer-based voronoi and gridded target area.
        </div>
      )}
    </div>
  )
}
