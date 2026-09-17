import { useMemo, useState } from 'react'
import Papa from 'papaparse'
import { ApiError, submitCoordinateReview } from '../../api/client'
import { parseCoordinateReviewCsv } from '../../api/parseResult'
import { useJobTracker } from '../../state/jobTracker'
import type {
  AgreementStatus,
  CoordinateDecision,
  CoordinateReviewFormInput,
  IndexedCoordinateRecord,
  ParsedCoordinateReviewResult,
} from '../../types/coordinateReview'
import { DECISION_CENTROID, DECISION_KEEP, DECISION_MANUAL } from '../../types/coordinateReview'
import { detectColumns, toNumber } from '../../utils/columns'
import {
  analyzeRow,
  baselineColumns as computeBaselineColumns,
  computeAgreementGroupBreakdown,
  computeAgreementSummary,
  computeGeographyCoverage,
  computeSourceStats,
  uniqueColumnValues,
} from '../../utils/coordinateReviewAggregate'
import CoordinateReviewForm from './CoordinateReviewForm'
import CoordinateReviewSummaryCards from './CoordinateReviewSummaryCards'
import CoordinateReviewSourcePanel from './CoordinateReviewSourcePanel'
import CoordinateReviewBreakdownChart from './CoordinateReviewBreakdownChart'
import CoordinateReviewResultsTable from './CoordinateReviewResultsTable'

type DrillLevel = 'state' | 'lga' | 'ward'

// Grounded in the real backend source (toolbox/mlos/validation/review/
// spatial/coordinate_reviewer.py, toolbox/apps/mlos/coord_review.py — read
// directly, not inferred from a sample export), reviewed and approved
// before this page was built. Kept visible here so the "what does each
// column mean" explanation travels with the page rather than living only in
// chat history.
function AboutThisTool() {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '14px 18px',
        marginBottom: 16,
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>What this tool is judging</div>
      <div>
        This isn&apos;t a per-source pass/fail score — it&apos;s a check on whether the settlement&apos;s{' '}
        <b>original coordinate</b> should be kept. If two or more sources land close to <b>each other</b> (regardless
        of whether they agree with the original point), that agreement is a candidate replacement worth reviewing.
      </div>
      <div style={{ marginTop: 6 }}>
        <b style={{ color: '#5a4000' }}>Consistent</b> — the agreeing sources also sit near the original point; no
        reason to change it. <b style={{ color: '#5a4000' }}>Review</b> — sources agree with each other away from the
        original; a credible alternative exists. <b style={{ color: '#5a4000' }}>No consensus</b> — sources don&apos;t
        agree with each other at all; there&apos;s nothing solid to act on either way.
      </div>
      <div style={{ marginTop: 6, color: 'var(--color-text-muted)', fontSize: 11 }}>
        Nothing is changed automatically — the Decision column per row is a client-side-only proposal (there&apos;s
        no backend endpoint to save it), purely a guide for the analyst.
      </div>
    </div>
  )
}

export default function CoordinateReviewPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedCoordinateReviewResult | null>(null)

  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  const [drillWard, setDrillWard] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<AgreementStatus | null>(null)
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set())
  const [decisions, setDecisions] = useState<Record<number, CoordinateDecision>>({})
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: CoordinateReviewFormInput) {
    if (!input.settlementsFile || !input.sourcesFile || !input.tracksFile) return // form already validates this
    setSubmitting(true)
    setError(null)
    setDrillState(null)
    setDrillLga(null)
    setDrillWard(null)
    setFilterStatus(null)
    setDecisions({})
    const jobId = startJob('mlos-coordinate-review', input.settlementsFile.name)
    try {
      const csvBlob = await submitCoordinateReview(input.settlementsFile, input.sourcesFile, input.tracksFile, input.useOsm)
      const parsed = await parseCoordinateReviewCsv(
        csvBlob,
        `${input.settlementsFile.name.split('.')[0] ?? 'settlements'}_coordinate_review.csv`,
      )
      setResult(parsed)
      setActiveSources(new Set(parsed.sourceNames))
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while running the coordinate review.')
      }
      setResult(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  const sourceNames = result?.sourceNames ?? []
  const baselineCols = useMemo(() => (result ? computeBaselineColumns(result.columns, result.sourceNames) : []), [result])
  const detected = useMemo(() => detectColumns(baselineCols), [baselineCols])

  const indexedRecords = useMemo<IndexedCoordinateRecord[]>(
    () => (result ? result.records.map((r, i) => ({ ...r, __idx: i })) : []),
    [result],
  )

  const scopedRecords = useMemo(() => {
    let recs = indexedRecords
    if (drillState && detected.state) recs = recs.filter((r) => String(r[detected.state!]) === drillState)
    if (drillLga && detected.lga) recs = recs.filter((r) => String(r[detected.lga!]) === drillLga)
    if (drillWard && detected.ward) recs = recs.filter((r) => String(r[detected.ward!]) === drillWard)
    return recs
  }, [indexedRecords, drillState, drillLga, drillWard, detected])

  const scopedWithAnalysis = useMemo(
    () => scopedRecords.map((r) => ({ record: r, analysis: analyzeRow(r, sourceNames, detected.latitude, detected.longitude) })),
    [scopedRecords, sourceNames, detected],
  )

  const filteredRecords = useMemo(() => {
    if (!filterStatus) return scopedRecords
    return scopedWithAnalysis.filter((x) => x.analysis.status === filterStatus).map((x) => x.record)
  }, [scopedWithAnalysis, scopedRecords, filterStatus])

  const coverage = useMemo(() => computeGeographyCoverage(scopedRecords, detected), [scopedRecords, detected])
  const summary = useMemo(() => computeAgreementSummary(scopedWithAnalysis.map((x) => x.analysis)), [scopedWithAnalysis])
  const statsBySource = useMemo(
    () => Object.fromEntries(sourceNames.map((s) => [s, computeSourceStats(scopedRecords, s)])),
    [sourceNames, scopedRecords],
  )

  const stateOptions = useMemo(() => uniqueColumnValues(indexedRecords, detected.state), [indexedRecords, detected])
  const lgaOptions = useMemo(() => {
    const scope = drillState && detected.state ? indexedRecords.filter((r) => String(r[detected.state!]) === drillState) : indexedRecords
    return uniqueColumnValues(scope, detected.lga)
  }, [indexedRecords, drillState, detected])
  const wardOptions = useMemo(() => {
    let scope = indexedRecords
    if (drillState && detected.state) scope = scope.filter((r) => String(r[detected.state!]) === drillState)
    if (drillLga && detected.lga) scope = scope.filter((r) => String(r[detected.lga!]) === drillLga)
    return uniqueColumnValues(scope, detected.ward)
  }, [indexedRecords, drillState, drillLga, detected])

  // The breakdown chart's own dimension: scoped by State/LGA drill only (NOT
  // Ward or the recommendation filter) so it stays fully interactive at
  // whichever level it's currently showing — same reasoning as Duplicate
  // Checker's chartRows, just expressed against the dynamically-detected
  // state/lga/ward column names this result has instead of fixed field
  // names.
  const chartLevel: DrillLevel = drillLga ? 'ward' : drillState ? 'lga' : 'state'
  const chartGroupColumn = chartLevel === 'ward' ? detected.ward : chartLevel === 'lga' ? detected.lga : detected.state
  const chartRows = useMemo(() => {
    if (drillLga && detected.state && detected.lga) {
      return indexedRecords.filter((r) => String(r[detected.state!]) === drillState && String(r[detected.lga!]) === drillLga)
    }
    if (drillState && detected.state) return indexedRecords.filter((r) => String(r[detected.state!]) === drillState)
    return indexedRecords
  }, [indexedRecords, drillState, drillLga, detected])
  const chartRowsWithAnalysis = useMemo(
    () => chartRows.map((r) => ({ record: r, analysis: analyzeRow(r, sourceNames, detected.latitude, detected.longitude) })),
    [chartRows, sourceNames, detected],
  )
  const groupBreakdown = useMemo(
    () => computeAgreementGroupBreakdown(chartRowsWithAnalysis, chartGroupColumn),
    [chartRowsWithAnalysis, chartGroupColumn],
  )

  const chartTitle =
    chartLevel === 'ward' ? 'Settlements by Ward' : chartLevel === 'lga' ? 'Settlements by LGA' : 'Settlements by State'
  const chartSubtitle =
    chartLevel === 'ward'
      ? `In ${drillLga}, ${drillState}. Click a ward to filter the table below, or a legend item to filter by recommendation.`
      : chartLevel === 'lga'
      ? `In ${drillState}. Click an LGA to drill into its wards, or a legend item to filter by recommendation.`
      : 'Click a state to drill into its LGAs, or a legend item to filter by recommendation.'
  const chartEmptyMessage =
    chartLevel === 'ward' ? 'No wards in this LGA.' : chartLevel === 'lga' ? 'No LGAs in this state.' : 'No results to chart yet.'

  function handleDrillStateChange(state: string | null) {
    setDrillState(state)
    setDrillLga(null)
    setDrillWard(null)
  }
  function handleDrillLgaChange(lga: string | null) {
    setDrillLga(lga)
    setDrillWard(null)
  }
  function toggleDrillWard(ward: string) {
    setDrillWard((w) => (w === ward ? null : ward))
  }
  function handleChartDrillUp() {
    if (drillLga) {
      setDrillLga(null)
      setDrillWard(null)
    } else {
      setDrillState(null)
      setDrillLga(null)
      setDrillWard(null)
    }
  }
  const chartOnSelect = chartLevel === 'state' ? handleDrillStateChange : chartLevel === 'lga' ? handleDrillLgaChange : toggleDrillWard
  const chartOnDrillUp = drillState ? handleChartDrillUp : undefined
  const chartDrillUpLabel = drillLga ? '← Back to LGAs' : '← Back to States'

  function toggleFilterStatus(status: AgreementStatus) {
    setFilterStatus((f) => (f === status ? null : status))
  }
  function toggleSource(source: string) {
    setActiveSources((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }
  function decide(idx: number, decision: CoordinateDecision) {
    setDecisions((prev) => ({ ...prev, [idx]: decision }))
  }

  const updateCount = useMemo(
    () => Object.values(decisions).filter((d) => d !== DECISION_KEEP && d !== DECISION_MANUAL).length,
    [decisions],
  )

  // Every column from the original result, plus the frontend's own
  // agreement read and decision — built from the FULL result, not whatever
  // the current geography/status filter has narrowed the table to.
  function handleDownloadFullCsv() {
    if (!result) return
    const rows = indexedRecords.map((record) => {
      const analysis = analyzeRow(record, sourceNames, detected.latitude, detected.longitude)
      const decision = decisions[record.__idx] ?? DECISION_KEEP
      const rest: Record<string, unknown> = {}
      for (const key of Object.keys(record)) {
        if (key === '__idx') continue
        rest[key] = record[key]
      }
      return {
        ...rest,
        agreement_status: analysis.status,
        agreement_cluster: analysis.cluster.join('+'),
        agreement_distance_m: analysis.distanceFromBaseline ?? '',
        decision,
      }
    })
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = result.sourceFilename || 'coordinate_review.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Just the baseline columns, with latitude/longitude swapped in for any
  // row where the analyst picked something other than "keep original" —
  // the settlement list this tool is meant to eventually feed back into,
  // not the full evidence dump (that's handleDownloadFullCsv above).
  function handleDownloadUpdatedList() {
    if (!result || !detected.latitude || !detected.longitude) return
    const rows = indexedRecords.map((record) => {
      const analysis = analyzeRow(record, sourceNames, detected.latitude, detected.longitude)
      const decision = decisions[record.__idx] ?? DECISION_KEEP
      const out: Record<string, unknown> = {}
      baselineCols.forEach((col) => {
        out[col] = record[col]
      })
      if (decision === DECISION_CENTROID && analysis.centroid) {
        out[detected.latitude!] = analysis.centroid.latitude
        out[detected.longitude!] = analysis.centroid.longitude
      } else if (decision !== DECISION_KEEP && decision !== DECISION_MANUAL) {
        const ev = analysis.cluster.includes(decision)
          ? { latitude: toNumber(record[`${decision}_latitude`] as string | number | null), longitude: toNumber(record[`${decision}_longitude`] as string | number | null) }
          : null
        if (ev && ev.latitude !== null && ev.longitude !== null) {
          out[detected.latitude!] = ev.latitude
          out[detected.longitude!] = ev.longitude
        }
      }
      out.coordinate_decision = decision
      return out
    })
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(result.sourceFilename || 'settlements').replace(/\.csv$/i, '')}_updated.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div>
      <CoordinateReviewForm onSubmit={handleSubmit} submitting={submitting} />

      {error && (
        <div
          style={{
            background: '#fdecea',
            border: '1px solid var(--color-critical)',
            color: '#7a2020',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {submitting && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 20 }}>
          Running the coordinate review — matching every settlement against each source sheet can take a while on a
          large master list…
        </div>
      )}

      {result && (
        <>
          <AboutThisTool />

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            {updateCount > 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                {updateCount} settlement{updateCount === 1 ? '' : 's'} marked for a coordinate update
              </span>
            )}
            <button
              type="button"
              onClick={handleDownloadUpdatedList}
              style={{
                background: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '8px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ⬇ Download updated settlement list
            </button>
            <button
              type="button"
              onClick={handleDownloadFullCsv}
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ⬇ Download full review CSV
            </button>
          </div>

          <CoordinateReviewSummaryCards coverage={coverage} summary={summary} activeStatus={filterStatus} onSelect={toggleFilterStatus} />

          <CoordinateReviewSourcePanel
            sourceNames={sourceNames}
            activeSources={activeSources}
            onToggleSource={toggleSource}
            statsBySource={statsBySource}
          />

          <CoordinateReviewBreakdownChart
            data={groupBreakdown}
            title={chartTitle}
            subtitle={chartSubtitle}
            emptyMessage={chartEmptyMessage}
            onSelect={chartOnSelect}
            onDrillUp={chartOnDrillUp}
            drillUpLabel={chartDrillUpLabel}
            activeOutcome={filterStatus}
            onToggleOutcome={toggleFilterStatus}
          />

          <CoordinateReviewResultsTable
            records={filteredRecords}
            totalCount={scopedRecords.length}
            baselineColumns={baselineCols}
            detected={detected}
            sourceNames={sourceNames}
            activeSources={activeSources}
            decisions={decisions}
            onDecide={decide}
            filterState={drillState}
            filterLga={drillLga}
            filterWard={drillWard}
            onFilterStateChange={handleDrillStateChange}
            onFilterLgaChange={handleDrillLgaChange}
            onFilterWardChange={(ward) => setDrillWard(ward)}
            stateOptions={stateOptions}
            lgaOptions={lgaOptions}
            wardOptions={wardOptions}
            filterStatus={filterStatus}
            onFilterStatusChange={setFilterStatus}
          />
        </>
      )}

      {!result && !submitting && !error && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Upload the three files above and run the review to see results here.
        </div>
      )}
    </div>
  )
}
