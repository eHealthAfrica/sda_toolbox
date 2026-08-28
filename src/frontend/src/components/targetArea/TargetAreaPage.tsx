import { useEffect, useMemo, useState } from 'react'
import { ApiError, submitGenerateTA } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { parseTargetAreaZip } from '../../api/parseResult'
import { parseSettlementKeySet } from '../../utils/targetAreaReference'
import type { ParsedTargetAreaResult, TargetAreaFormInput } from '../../types/targetArea'
import { detectColumns } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import {
  countUniqueKeys,
  differenceSize,
  intersectionSize,
  lgaKey,
  settlementKey,
  uniqueKeySet,
  wardKey,
} from '../../utils/targetAreaAggregate'
import TargetAreaForm from './TargetAreaForm'
import TargetAreaSummaryCards from './TargetAreaSummaryCards'
import TAVolumeChart from './TAVolumeChart'
import TargetAreaMap from './TargetAreaMap'

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
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: TargetAreaFormInput) {
    setSubmitting(true)
    setError(null)
    setResultBlob(null)
    const jobId = startJob('target-area', input.mlosFile?.name ?? 'Target Area generation run')
    try {
      const [zipBlob, masterSet, plannedSet] = await Promise.all([
        submitGenerateTA(input),
        input.mlosFile ? parseSettlementKeySet(input.mlosFile) : Promise.resolve(null),
        input.plannedListFile ? parseSettlementKeySet(input.plannedListFile) : Promise.resolve(null),
      ])
      const parsed = await parseTargetAreaZip(zipBlob)
      setResult(parsed)
      setResultBlob(zipBlob)
      setSourceName(input.mlosFile ? input.mlosFile.name.split('.')[0] : 'target_area')
      setMasterListSet(masterSet)
      setPlannedListSet(plannedSet)
      setPlannedListFileProvided(Boolean(input.plannedListFile))
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

    const voronoiRecords = result.voronoi.records
    const columns = detectColumns(result.voronoi.columns)
    const voronoiSet = uniqueKeySet(voronoiRecords, (r) =>
      settlementKey(r, columns.state, columns.lga, columns.ward, columns.settlement),
    )

    const griddedColumns = result.griddedTa ? detectColumns(result.griddedTa.columns) : null
    const griddedSet = result.griddedTa && griddedColumns
      ? uniqueKeySet(result.griddedTa.records, (r) =>
          settlementKey(r, griddedColumns.state, griddedColumns.lga, griddedColumns.ward, griddedColumns.settlement),
        )
      : new Set<string>()

    const foundInVoronoiAndGridded = intersectionSize(voronoiSet, griddedSet)

    // Prefer the TRUE reference — the raw MLoS upload, parsed client-side —
    // over a voronoi-vs-gridded diff, since a settlement absent from BOTH
    // outputs would be invisible to a voronoi-vs-gridded-only comparison.
    // Only fall back to the weaker gridded-vs-voronoi diff if the upload
    // itself couldn't be re-read (masterListSet null).
    const missingVoronoi = masterListSet ? differenceSize(masterListSet, voronoiSet) : differenceSize(griddedSet, voronoiSet)
    const missingVoronoiReference: 'mlos' | 'gridded' = masterListSet ? 'mlos' : 'gridded'

    const subsetVoronoiColumns = result.subsetVoronoi ? detectColumns(result.subsetVoronoi.columns) : null
    const subsetVoronoiSet = result.subsetVoronoi && subsetVoronoiColumns
      ? uniqueKeySet(result.subsetVoronoi.records, (r) =>
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
    const griddedSubsetSet = result.griddedTaSubset && griddedSubsetColumns
      ? uniqueKeySet(result.griddedTaSubset.records, (r) =>
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
    if (result.hasPlannedList) {
      if (plannedListSet) {
        plannedListSettlements = plannedListSet.size
        plannedListSource = 'file'
        plannedMissingVoronoi = differenceSize(plannedListSet, subsetVoronoiSet)
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
      voronoiCount: result.voronoi.rowCount,
      griddedCount: result.griddedTa?.rowCount ?? 0,
    }
  }, [result, masterListSet, plannedListSet, plannedListFileProvided])

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

      {submitting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Generating target areas…
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
          <TargetAreaMap
            voronoi={result?.voronoi ?? null}
            griddedTa={result?.griddedTa ?? null}
            subsetVoronoi={result?.subsetVoronoi ?? null}
            griddedTaSubset={result?.griddedTaSubset ?? null}
            hasPlannedList={analysis.hasPlannedList}
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
