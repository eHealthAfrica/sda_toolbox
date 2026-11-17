import { useEffect, useMemo, useState } from 'react'
import { ApiError, submitGenerateTA } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { loadTargetAreaInBatches } from '../../utils/targetAreaBatchLoader'
import { parseSettlementReference } from '../../utils/targetAreaReference'
import type { SettlementReference } from '../../utils/targetAreaReference'
import type { ParsedTargetAreaResult, TargetAreaFormInput, TargetAreaLayer, TargetAreaRecord, TargetAreaRunSummary } from '../../types/targetArea'
import { detectColumns } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import {
  computeTargetAreaGeoBreakdown,
  countUniqueKeys,
  differenceSize,
  filterRecordsByGeo,
  filterRecordsByWardMembership,
  intersectionSize,
  lgaKey,
  settlementKey,
  uniqueKeySet,
  wardKey,
} from '../../utils/targetAreaAggregate'
import TargetAreaForm from './TargetAreaForm'
import TargetAreaSummaryCards from './TargetAreaSummaryCards'
import TargetAreaStatesCard from './TargetAreaStatesCard'
import TAVolumeChart from './TAVolumeChart'
import TargetAreaGeoBreakdownTable from './TargetAreaGeoBreakdownTable'
// The polygon map (TargetAreaMap.tsx) was removed — the summary cards and
// volume chart below never needed decoded geometry, only attribute records
// and row counts, and the real spatial output is still the downloadable
// response ZIP. TargetAreaMap.tsx itself is now dead code left on disk (this
// session can't delete files on your machine) — see the delivery note.
// The two per-state bar charts (TargetAreaStateChart, voronoi-by-state and
// gridded-by-state) were replaced by TargetAreaGeoBreakdownTable below,
// which also drills to ward. TargetAreaStateChart.tsx is now dead code left
// on disk for the same reason as TargetAreaMap.tsx above.

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
  // Which states ran and which were skipped (and why), from the response's X-TA-Summary header.
  const [runSummary, setRunSummary] = useState<TargetAreaRunSummary | null>(null)
  const [sourceName, setSourceName] = useState<string | null>(null)
  // True references (records + detected columns + a de-duped key set) read
  // client-side from the raw uploads (before/while the request is in
  // flight) — see utils/targetAreaReference.ts for why this exists:
  // gridded_ta/voronoi alone can't tell you what's MISSING, only what's
  // present, so the "settlements without a voronoi TA" cards, and the
  // State/LGA/Ward breakdown table's "Settlements" column, need the actual
  // upload as ground truth. Both are null until a run completes;
  // masterListRef stays null forever if mlosFile was somehow absent
  // (shouldn't happen — submitGenerateTA itself requires it), plannedListRef
  // stays null if no planned list was uploaded OR its file couldn't be
  // parsed (see plannedListFileProvided to tell those apart). `analysis`
  // below derives its scoped key sets straight from these refs' own records
  // via filterRecordsByGeo + uniqueKeySet, rather than reading a flat key set
  // off the ref directly.
  const [masterListRef, setMasterListRef] = useState<SettlementReference | null>(null)
  const [plannedListRef, setPlannedListRef] = useState<SettlementReference | null>(null)
  const [plannedListFileProvided, setPlannedListFileProvided] = useState(false)
  // Set via the State/LGA/Ward filter selects on the breakdown table below —
  // that same three-level drill scopes the summary cards and volume chart
  // too (see the `analysis` useMemo), matching the "page owns the drill,
  // table is a controlled view" convention used by QcSettlementListTable/
  // MlosQcPage and CoordinateReviewPage. Picking a new state clears any LGA/
  // ward picked under a different state; picking a new LGA clears any ward
  // picked under a different LGA — same cascading-clear behavior those pages
  // use for their own State/LGA/Ward selects.
  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  const [drillWard, setDrillWard] = useState<string | null>(null)
  // A fourth, independent filter dimension — Location type (Planned / Not
  // Planned) — driven by the same breakdown table's own select (see
  // TargetAreaGeoBreakdownTable.tsx). Unlike State/LGA/Ward it isn't part of
  // the state→lga→ward cascade, so picking it never resets the geo drill and
  // vice versa; both apply together when both are set.
  const [drillLocationType, setDrillLocationType] = useState<'planned' | 'not-planned' | null>(null)
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
    setDrillLocationType(null)
  }

  async function handleSubmit(input: TargetAreaFormInput) {
    setSubmitting(true)
    setError(null)
    setResultBlob(null)
    setRunSummary(null)
    setResult(null)
    clearDrill()
    const jobId = startJob('target-area', input.mlosFile?.name ?? 'Target Area generation run')
    try {
      const [{ blob: zipBlob, summary }, masterRef, plannedRef] = await Promise.all([
        submitGenerateTA(input),
        input.mlosFile ? parseSettlementReference(input.mlosFile) : Promise.resolve(null),
        input.plannedListFile ? parseSettlementReference(input.plannedListFile) : Promise.resolve(null),
      ])
      // "Download results" hands back this raw blob regardless of how far
      // the batched parse/render below gets — set it up front so it's
      // available even if loadTargetAreaInBatches stops early on memory.
      setResultBlob(zipBlob)
      setRunSummary(summary)
      setSourceName(input.mlosFile ? input.mlosFile.name.split('.')[0] : 'target_area')
      setMasterListRef(masterRef)
      setPlannedListRef(plannedRef)
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
      setRunSummary(null)
      setMasterListRef(null)
      setPlannedListRef(null)
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

  // State + LGA + Ward breakdown feeding TargetAreaGeoBreakdownTable below.
  // Unlike `analysis` below, this is never itself scoped to the drill — it
  // always covers every row, so the state/LGA/ward select options below stay
  // complete and filteredGeoBreakdown has a full set to filter down from.
  // Defined above `analysis` (it used to come after) because `analysis` now
  // needs plannedWardKeys, derived from this, to apply the Location type
  // filter.
  const geoBreakdown = useMemo(() => {
    if (!result?.voronoi) return []
    const voronoiColumns = detectColumns(result.voronoi.columns)
    const griddedColumns = result.griddedTa ? detectColumns(result.griddedTa.columns) : null
    const subsetVoronoiColumns = result.subsetVoronoi ? detectColumns(result.subsetVoronoi.columns) : null
    const griddedSubsetColumns = result.griddedTaSubset ? detectColumns(result.griddedTaSubset.columns) : null
    return computeTargetAreaGeoBreakdown(
      masterListRef?.records ?? [],
      masterListRef?.columns ?? null,
      result.voronoi.records,
      voronoiColumns,
      result.griddedTa?.records ?? [],
      griddedColumns,
      result.subsetVoronoi?.records ?? [],
      subsetVoronoiColumns,
      result.griddedTaSubset?.records ?? [],
      griddedSubsetColumns,
      plannedListRef?.records ?? [],
      plannedListRef?.columns ?? null,
    )
  }, [result, masterListRef, plannedListRef])

  // Cascading State/LGA/Ward select options for the breakdown table's
  // filters, derived from the full (unscoped) geoBreakdown — same cascading
  // pattern as MlosQcPage's own stateOptions/lgaOptions/wardOptions.
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

  // The breakdown table's own rows — geoBreakdown narrowed by the active
  // drill (State/LGA/Ward and Location type alike), same scoping `analysis`
  // below applies to the summary cards and volume chart.
  const filteredGeoBreakdown = useMemo(
    () =>
      geoBreakdown.filter(
        (r) =>
          (!drillState || r.state === drillState) &&
          (!drillLga || r.lga === drillLga) &&
          (!drillWard || r.ward === drillWard) &&
          (!drillLocationType || (drillLocationType === 'planned' ? r.hasPlannedSettlements : !r.hasPlannedSettlements)),
      ),
    [geoBreakdown, drillState, drillLga, drillWard, drillLocationType],
  )

  // Precomputed once from geoBreakdown's own hasPlannedSettlements flag —
  // lets `analysis` scope the summary cards/volume chart by the Location
  // type filter using the exact same per-ward classification the breakdown
  // table's rows use. Reconstructs the state|lga|ward join wardKey() would
  // produce for each row's own (already cellText-extracted) state/lga/ward
  // strings, so a record matches this set by its own ward regardless of
  // which layer/column set it came from (see filterRecordsByWardMembership).
  const plannedWardKeys = useMemo(
    () =>
      new Set(
        geoBreakdown.filter((r) => r.hasPlannedSettlements).map((r) => [r.state, r.lga, r.ward].filter(Boolean).join(' | ')),
      ),
    [geoBreakdown],
  )

  const analysis = useMemo<TargetAreaAnalysis | null>(() => {
    if (!result || !result.voronoi) return null

    // Applies both drill dimensions together — the State/LGA/Ward geo scope,
    // then (when set) the Location type filter via plannedWardKeys — so
    // every records/set derived below reflects whichever combination of
    // filters is active, the same way filteredGeoBreakdown does for the
    // table's own rows.
    function applyDrill(records: TargetAreaRecord[], columns: DetectedColumns | null): TargetAreaRecord[] {
      const geoScoped = filterRecordsByGeo(records, columns, drillState, drillLga, drillWard)
      if (!drillLocationType) return geoScoped
      return filterRecordsByWardMembership(geoScoped, columns, plannedWardKeys, drillLocationType === 'planned' ? 'in' : 'out')
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

    // Prefer the TRUE reference — the raw MLoS upload, parsed client-side —
    // over a voronoi-vs-gridded diff, since a settlement absent from BOTH
    // outputs would be invisible to a voronoi-vs-gridded-only comparison.
    // Only fall back to the weaker gridded-vs-voronoi diff if the upload
    // itself couldn't be re-read (masterListRef null). The reference set is
    // derived fresh from masterListRef's own records via filterRecordsByGeo +
    // uniqueKeySet (rather than prefix-matching a flat key string, as the
    // state-only filterKeySetByState used to) so the drill can scope by
    // LGA/ward too, not just state.
    const scopedMasterListSet = masterListRef
      ? uniqueKeySet(applyDrill(masterListRef.records, masterListRef.columns), (r) =>
          settlementKey(r, masterListRef.columns.state, masterListRef.columns.lga, masterListRef.columns.ward, masterListRef.columns.settlement),
        )
      : null
    const missingVoronoi = scopedMasterListSet
      ? differenceSize(scopedMasterListSet, voronoiSet)
      : differenceSize(griddedSet, voronoiSet)
    const missingVoronoiReference: 'mlos' | 'gridded' = scopedMasterListSet ? 'mlos' : 'gridded'

    const subsetVoronoiColumns = result.subsetVoronoi ? detectColumns(result.subsetVoronoi.columns) : null
    const subsetVoronoiRecords = subsetVoronoiColumns ? applyDrill(result.subsetVoronoi!.records, subsetVoronoiColumns) : []
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
    const griddedSubsetRecords = griddedSubsetColumns ? applyDrill(result.griddedTaSubset!.records, griddedSubsetColumns) : []
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
    const scopedPlannedListSet = plannedListRef
      ? uniqueKeySet(applyDrill(plannedListRef.records, plannedListRef.columns), (r) =>
          settlementKey(
            r,
            plannedListRef.columns.state,
            plannedListRef.columns.lga,
            plannedListRef.columns.ward,
            plannedListRef.columns.settlement,
          ),
        )
      : null
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
      // rowCount from SELECT COUNT(*)) once a drill is active — rowCount
      // covers the whole layer, but geography/planned-membership isn't
      // knowable for rows a batched load hasn't reached yet, so a scoped
      // count can only reflect what's loaded so far. Byte-identical to
      // before when no drill is set.
      voronoiCount: drillState || drillLga || drillWard || drillLocationType ? voronoiRecords.length : result.voronoi.rowCount,
      griddedCount: drillState || drillLga || drillWard || drillLocationType ? griddedRecords.length : result.griddedTa?.rowCount ?? 0,
    }
  }, [
    result,
    masterListRef,
    plannedListRef,
    plannedListFileProvided,
    drillState,
    drillLga,
    drillWard,
    drillLocationType,
    plannedWardKeys,
  ])

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

      <TargetAreaStatesCard summary={runSummary} />

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
          {(drillState || drillLga || drillWard || drillLocationType) && (
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
              <strong style={{ color: 'var(--color-text)' }}>
                {[drillState, drillLga, drillWard, drillLocationType === 'planned' ? 'Planned' : drillLocationType === 'not-planned' ? 'Not Planned' : null]
                  .filter(Boolean)
                  .join(' › ')}
              </strong>
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
          <TargetAreaGeoBreakdownTable
            data={filteredGeoBreakdown}
            totalCount={geoBreakdown.length}
            hasPlannedList={analysis.hasPlannedList}
            filterState={drillState}
            filterLga={drillLga}
            filterWard={drillWard}
            onFilterStateChange={handleDrillStateChange}
            onFilterLgaChange={handleDrillLgaChange}
            onFilterWardChange={setDrillWard}
            stateOptions={geoStateOptions}
            lgaOptions={geoLgaOptions}
            wardOptions={geoWardOptions}
            filterLocationType={drillLocationType}
            onFilterLocationTypeChange={setDrillLocationType}
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
