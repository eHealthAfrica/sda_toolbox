import { useMemo, useState } from 'react'
import Papa from 'papaparse'
import { ApiError, submitDuplicateChecker } from '../../api/client'
import { parseDuplicateCheckerCsv } from '../../api/parseResult'
import { useJobTracker } from '../../state/jobTracker'
import type {
  DuplicateCheckerFormInput,
  IndexedDuplicateRecord,
  ParsedDuplicateCheckerResult,
  ReviewDecision,
  ReviewOutcome,
} from '../../types/duplicateChecker'
import { DECISION_LABELS } from '../../types/duplicateChecker'
import {
  computeDuplicateGroupBreakdown,
  computeGeographyCoverage,
  computeReviewOutcomeCounts,
  uniqueFieldValues,
} from '../../utils/duplicateCheckerAggregate'
import DuplicateCheckerForm from './DuplicateCheckerForm'
import DuplicateCoverageCards from './DuplicateCoverageCards'
import DuplicateStatCards from './DuplicateStatCards'
import DuplicateBreakdownChart from './DuplicateBreakdownChart'
import DuplicatePairsTable from './DuplicatePairsTable'

type DrillLevel = 'state' | 'lga' | 'ward'

// Note text below is grounded in the REAL backend classification logic
// (toolbox/mlos/validation/review/attributes/deep_search.py::
// review_ward_settlement_for_duplicates — read directly, not inferred from
// the sample CSV): Duplicate Remove is distance <= 10m, Duplicate Review is
// 10-65m OR missing/invalid coordinates, Unlikely Potential Duplicate Review
// is > 65m with no upper bound. This corrects an earlier draft of this page
// that used "<65m" for Duplicate Remove — that figure is actually where
// Duplicate Review ends and Unlikely Potential Duplicate Review begins, not
// where Duplicate Remove ends.
function ReviewOutcomeNotes() {
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
      <div style={{ fontWeight: 600, marginBottom: 6 }}>What each review outcome means</div>
      <div>
        <b style={{ color: '#5a4000' }}>Duplicate Remove</b> — settlement names are similar and their coordinates are
        within 10 m of each other. Very likely the same place captured twice.
      </div>
      <div>
        <b style={{ color: '#5a4000' }}>Duplicate Review</b> — names are similar and either the coordinates are
        10–65 m apart, or coordinates are missing for one or both records so distance can't be checked. Needs a human
        look.
      </div>
      <div>
        <b style={{ color: '#5a4000' }}>Unlikely Potential Duplicate Review</b> — the names are similar, but the
        coordinates are far apart. Probably two distinct settlements with similar names.
      </div>
    </div>
  )
}

function DecisionMeaningNotes() {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '14px 18px',
        marginBottom: 24,
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>What each decision means (proposed workflow)</div>
      <div>
        <b style={{ color: '#5a4000' }}>Keep both</b> — both settlement records are legitimate and distinct; no
        changes needed. Excluded from the downloadable results, since this pair is resolved.
      </div>
      <div>
        <b style={{ color: '#5a4000' }}>Remove match</b> — this is a confirmed duplicate; one of the two records
        should be removed from the settlement list.
      </div>
      <div>
        <b style={{ color: '#5a4000' }}>Field check</b> — not enough information to decide from the office; flag it
        for a field team to verify on the ground.
      </div>
      <div style={{ marginTop: 6, color: 'var(--color-text-muted)', fontSize: 11 }}>
        Decisions are recorded in this browser only — there's no backend endpoint yet to save them, so they reset on
        a page refresh or a new run. What's captured here shapes the exported CSV's "decision" column and which pairs
        it excludes.
      </div>
    </div>
  )
}

export default function DuplicateCheckerPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedDuplicateCheckerResult | null>(null)

  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  const [drillWard, setDrillWard] = useState<string | null>(null)
  const [filterReview, setFilterReview] = useState<ReviewOutcome | null>(null)
  const [decisions, setDecisions] = useState<Record<number, ReviewDecision>>({})
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: DuplicateCheckerFormInput) {
    if (!input.settlementsFile) return // DuplicateCheckerForm already validates this before calling onSubmit
    setSubmitting(true)
    setError(null)
    setDrillState(null)
    setDrillLga(null)
    setDrillWard(null)
    setFilterReview(null)
    setDecisions({})
    const jobId = startJob('mlos-duplicate-checker', input.settlementsFile.name)
    try {
      const csvBlob = await submitDuplicateChecker(input.settlementsFile, input.threshold)
      const parsed = await parseDuplicateCheckerCsv(
        csvBlob,
        `${input.settlementsFile.name.split('.')[0] ?? 'settlements'}_duplicate_review.csv`,
      )
      setResult(parsed)
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while running the duplicate check.')
      }
      setResult(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  // Every record tagged with its position in the ORIGINAL parsed result —
  // the stable key the decision workflow and CSV export key off (see
  // types/duplicateChecker.ts::IndexedDuplicateRecord).
  const indexedRecords = useMemo<IndexedDuplicateRecord[]>(
    () => (result ? result.records.map((r, i) => ({ ...r, __idx: i })) : []),
    [result],
  )

  // Records narrowed by the State/LGA/Ward drill only — geography coverage
  // cards, the review-outcome stat cards, and the "Decided" count all read
  // from this (not filteredRecords), matching the approved mockup: those
  // reflect the current geographic scope regardless of which review outcome
  // is selected, so clicking "Duplicate Remove" doesn't collapse them into a
  // single trivial number.
  const scopedRecords = useMemo(() => {
    let recs = indexedRecords
    if (drillState) recs = recs.filter((r) => r.state === drillState)
    if (drillLga) recs = recs.filter((r) => r.lga === drillLga)
    if (drillWard) recs = recs.filter((r) => r.ward === drillWard)
    return recs
  }, [indexedRecords, drillState, drillLga, drillWard])

  // Geography drill + review-outcome filter together — what the pairs table
  // below actually shows.
  const filteredRecords = useMemo(() => {
    if (!filterReview) return scopedRecords
    return scopedRecords.filter((r) => r.review === filterReview)
  }, [scopedRecords, filterReview])

  const coverage = useMemo(() => computeGeographyCoverage(scopedRecords), [scopedRecords])
  const reviewCounts = useMemo(() => computeReviewOutcomeCounts(scopedRecords), [scopedRecords])
  const decidedCount = useMemo(
    () => scopedRecords.filter((r) => decisions[r.__idx] != null).length,
    [scopedRecords, decisions],
  )
  const keepCount = useMemo(() => Object.values(decisions).filter((d) => d === 'keep').length, [decisions])

  // The breakdown chart's own dimension: scoped by State/LGA drill only (NOT
  // Ward or the review-outcome filter) so it stays fully interactive at
  // whichever level it's currently showing — same reasoning as MLoS QC's
  // FlagBreakdownChart, just expressed against the fixed state/lga/ward
  // columns this result always has.
  const chartLevel: DrillLevel = drillLga ? 'ward' : drillState ? 'lga' : 'state'
  const chartRows = useMemo(() => {
    if (drillLga) return indexedRecords.filter((r) => r.state === drillState && r.lga === drillLga)
    if (drillState) return indexedRecords.filter((r) => r.state === drillState)
    return indexedRecords
  }, [indexedRecords, drillState, drillLga])
  const groupBreakdown = useMemo(() => computeDuplicateGroupBreakdown(chartRows, chartLevel), [chartRows, chartLevel])

  const chartTitle =
    chartLevel === 'ward' ? 'Flagged Settlements by Ward' : chartLevel === 'lga' ? 'Flagged Settlements by LGA' : 'Flagged Settlements by State'
  const chartSubtitle =
    chartLevel === 'ward'
      ? `In ${drillLga}, ${drillState}. Click a ward to filter the table below, or a legend item to filter by review outcome.`
      : chartLevel === 'lga'
      ? `In ${drillState}. Click an LGA to drill into its wards, or a legend item to filter by review outcome.`
      : 'Click a state to drill into its LGAs, or a legend item to filter by review outcome.'
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
  function toggleReviewFilter(outcome: ReviewOutcome) {
    setFilterReview((f) => (f === outcome ? null : outcome))
  }

  const chartOnSelect = chartLevel === 'state' ? handleDrillStateChange : chartLevel === 'lga' ? handleDrillLgaChange : toggleDrillWard
  const chartOnDrillUp = drillState ? handleChartDrillUp : undefined
  const chartDrillUpLabel = drillLga ? '← Back to LGAs' : '← Back to States'

  const stateOptions = useMemo(() => uniqueFieldValues(indexedRecords, 'state'), [indexedRecords])
  const lgaOptions = useMemo(() => {
    const scope = drillState ? indexedRecords.filter((r) => r.state === drillState) : indexedRecords
    return uniqueFieldValues(scope, 'lga')
  }, [indexedRecords, drillState])
  const wardOptions = useMemo(() => {
    let scope = indexedRecords
    if (drillState) scope = scope.filter((r) => r.state === drillState)
    if (drillLga) scope = scope.filter((r) => r.lga === drillLga)
    return uniqueFieldValues(scope, 'ward')
  }, [indexedRecords, drillState, drillLga])

  function decide(idx: number, decision: ReviewDecision) {
    setDecisions((prev) => ({ ...prev, [idx]: decision }))
  }
  function undoDecision(idx: number) {
    setDecisions((prev) => {
      const next = { ...prev }
      delete next[idx]
      return next
    })
  }

  // Builds the downloadable result set from the FULL original result (not
  // whatever the current geography/review filter has narrowed the table
  // to) — every flagged pair EXCEPT those decided "Keep both". Regenerated
  // fresh on each click rather than a pre-built blob URL (like MLoS QC's
  // static download link) because its content depends on `decisions`, which
  // can change between runs of this handler.
  function handleDownload() {
    if (!result) return
    const rows = result.records
      .map((r, idx) => ({ r, idx }))
      .filter(({ idx }) => decisions[idx] !== 'keep')
      .map(({ r, idx }) => {
        const decision = decisions[idx]
        return {
          state: r.state,
          lga: r.lga,
          ward: r.ward,
          'settlement 1': r['settlement 1'],
          'settlement 2': r['settlement 2'],
          score: r.score,
          distance: r.distance ?? '',
          review: r.review,
          decision: decision ? DECISION_LABELS[decision] : '',
        }
      })
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = result.sourceFilename || 'duplicate_review.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div>
      <DuplicateCheckerForm onSubmit={handleSubmit} submitting={submitting} />

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
          Running the duplicate check — comparing settlement names within each ward and checking coordinates can take
          a while on a large master list…
        </div>
      )}

      {result && (
        <>
          <ReviewOutcomeNotes />

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {keepCount > 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                {keepCount} pair{keepCount === 1 ? '' : 's'} "Kept both" — excluded from download
              </span>
            )}
            <button
              type="button"
              onClick={handleDownload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
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
              ⬇ Download results (CSV)
            </button>
          </div>

          <DuplicateCoverageCards coverage={coverage} />
          <DuplicateStatCards
            counts={reviewCounts}
            decidedCount={decidedCount}
            activeOutcome={filterReview}
            onSelect={toggleReviewFilter}
          />

          <DuplicateBreakdownChart
            data={groupBreakdown}
            title={chartTitle}
            subtitle={chartSubtitle}
            emptyMessage={chartEmptyMessage}
            onSelect={chartOnSelect}
            onDrillUp={chartOnDrillUp}
            drillUpLabel={chartDrillUpLabel}
            activeOutcome={filterReview}
            onToggleOutcome={toggleReviewFilter}
          />

          <DecisionMeaningNotes />

          <DuplicatePairsTable
            records={filteredRecords}
            totalCount={scopedRecords.length}
            decisions={decisions}
            onDecide={decide}
            onUndo={undoDecision}
            filterState={drillState}
            filterLga={drillLga}
            filterWard={drillWard}
            filterReview={filterReview}
            onFilterStateChange={handleDrillStateChange}
            onFilterLgaChange={handleDrillLgaChange}
            onFilterWardChange={(ward) => setDrillWard(ward)}
            onFilterReviewChange={setFilterReview}
            stateOptions={stateOptions}
            lgaOptions={lgaOptions}
            wardOptions={wardOptions}
          />
        </>
      )}

      {!result && !submitting && !error && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Upload a settlement list above and run the duplicate check to see results here.
        </div>
      )}
    </div>
  )
}
