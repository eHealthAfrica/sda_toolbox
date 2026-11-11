import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, submitReachAnalysis } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { parseReachCsv } from '../../api/parseResult'
import type { ParsedReachResult, ReachFormInput, ReachRecord, ReachRunInfo } from '../../types/reach'
import { detectColumns } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import {
  cellText,
  computeAccessibilityByGroup,
  computeAccessibilityCounts,
  computeMissedPopulationByGroup,
  computePopulationSummary,
  computeReachCounts,
  computeSourceCounts,
  computeVisitationByGroup,
  computeVisitationCounts,
  countUniqueColumn,
  countUniqueKeys,
  lgaKey,
  wardKey,
} from '../../utils/reachAggregate'
import type {
  AccessibilityCountEntry,
  CountEntry,
  GroupAccessibilityEntry,
  GroupPopulationEntry,
  GroupVisitationEntry,
  PopulationSummary,
  ReachCountEntry,
  SourceCount,
} from '../../utils/reachAggregate'
import type { ReachVisitationStatus } from '../../types/reach'
import ReachForm from './ReachForm'
import ReachRunningCard from './ReachRunningCard'
import JobProgress from '../jobLogs/JobProgress'
import { JOB_LOGS_ENABLED, newClientJobId } from '../../utils/jobLogs'
import { REACH_STEPS } from '../../utils/jobProgress'
import ReachEmptyStateCard from './ReachEmptyStateCard'
import ReachSummaryCards from './ReachSummaryCards'
import ReachVisitationCards from './ReachVisitationCards'
import ReachCountCards from './ReachCountCards'
import LgaVisitationChart from './LgaVisitationChart'
import SourceBreakdownChart from './SourceBreakdownChart'
import AccessibilityCards from './AccessibilityCards'
import AccessibilityByStateChart from './AccessibilityByStateChart'
import PopulationSummaryCards from './PopulationSummaryCards'
import MissedPopulationChart from './MissedPopulationChart'
import ReachMap from './ReachMap'
import ReachSettlementListTable from './ReachSettlementListTable'
import TabbedPanel from '../common/TabbedPanel'

// The shared state -> LGA -> ward drill-down every chart on this page (bar
// charts, the map, the settlement table) participates in — except
// SourceBreakdownChart ("Validated by"), which stays a whole-result view by
// request, since it answers "which data source confirmed this" rather than
// "where geographically."
type DrillLevel = 'state' | 'lga' | 'ward'

// Whole-result figures that don't change as the drill selection moves — the
// dataset's own size (how many states/LGAs/wards/settlements it covers) and
// the "Validated by" source breakdown, which is deliberately not scoped.
interface ReachAnalysis {
  columns: DetectedColumns
  totalSettlements: number
  totalStates: number
  totalLgas: number
  totalWards: number
  sourceCounts: SourceCount[]
  records: ReachRecord[]
}

// Everything that DOES change with the drill selection — cards and charts
// below the breadcrumb all read from this instead of `analysis` directly.
interface ReachScopedView {
  records: ReachRecord[]
  groupColumn: string | null
  visitationCounts: CountEntry<ReachVisitationStatus>[]
  reachCounts: ReachCountEntry[]
  visitationByGroup: GroupVisitationEntry[]
  accessibilityCounts: AccessibilityCountEntry[]
  accessibilityByGroup: GroupAccessibilityEntry[]
  populationSummary: PopulationSummary | null
  missedByGroup: GroupPopulationEntry[]
}

export default function ReachAnalysisPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedReachResult | null>(null)
  // The raw CSV response, kept alongside the parsed records purely so the
  // download button can hand back exactly what /validation produced — same
  // csvBlob convention as H2HTrackingPage.
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  // Which of the map/list views is showing inside the shared TabbedPanel
  // frame below — same "one frame, one tab bar" convention as
  // H2HTrackingPage's settlementView, including defaulting to the table
  // (the map is still one click away via the tab).
  const [settlementView, setSettlementView] = useState<'map' | 'list'>('list')
  // What was submitted for the run in flight / the run behind `result`. The
  // CSV response doesn't echo its inputs, and the running + empty-result
  // cards need to say what was being processed.
  const [runInfo, setRunInfo] = useState<ReachRunInfo | null>(null)
  // The id sent with the request so the pipeline progress bar can ask the backend
  // for this run's log lines while it is still going. Stays null (and the
  // bar renders nothing) unless VITE_JOB_LOGS=true.
  const [logJobId, setLogJobId] = useState<string | null>(null)
  // Wraps the form so the empty-result card's "Back to the form" can scroll
  // to it (the form owns its own state, so the page can't focus a field).
  const formRef = useRef<HTMLDivElement>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: ReachFormInput) {
    setSubmitting(true)
    setError(null)
    setDrillState(null)
    setDrillLga(null)
    setRunInfo({
      plannedFileName: input.plannedSettlementsFile?.name ?? null,
      dataSourcesFileName: input.dataSourcesFile?.name ?? null,
      tracksFileName: input.tracksFile?.name ?? null,
      method: input.method,
    })
    const jobId = startJob('reach', input.plannedSettlementsFile?.name ?? 'REACH analysis run')
    const clientJobId = newClientJobId()
    setLogJobId(JOB_LOGS_ENABLED ? clientJobId : null)
    try {
      const csvBlob = await submitReachAnalysis(input, clientJobId)
      const parsed = await parseReachCsv(csvBlob, `${input.plannedSettlementsFile?.name.split('.')[0] ?? 'reach'}_REACH.csv`)
      setResult(parsed)
      setResultBlob(csvBlob)
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while running the REACH analysis.')
      }
      setResult(null)
      setResultBlob(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  // POST /validation's response is the raw CSV itself (see
  // api/client.ts::submitReachAnalysis) — no separate archive/ZIP step like
  // H2H's, so the download just hands back exactly that blob.
  function handleDownloadCsv() {
    if (!resultBlob) return
    const baseName = (result?.sourceFilename ?? 'reach_results').replace(/\.[^./]+$/, '')
    const url = URL.createObjectURL(resultBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${baseName}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const analysis = useMemo<ReachAnalysis | null>(() => {
    if (!result) return null

    const columns = detectColumns(result.columns)
    const records = result.records

    return {
      columns,
      totalSettlements: records.length,
      totalStates: countUniqueColumn(records, columns.state),
      totalLgas: countUniqueKeys(records, (r) => lgaKey(r, columns.state, columns.lga)),
      totalWards: countUniqueKeys(records, (r) => wardKey(r, columns.state, columns.lga, columns.ward)),
      sourceCounts: computeSourceCounts(records),
      records,
    }
  }, [result])

  // If a fresh run's data no longer has the previously-selected state (a
  // second, different upload in the same session), fall back to the top
  // level rather than showing an empty scope with a stale breadcrumb —
  // same "clamp on new data" idea as DailyReportResults' active-tab clamp.
  useEffect(() => {
    if (!analysis || !drillState) return
    const stillPresent = analysis.records.some((r) => cellText(r, analysis.columns.state) === drillState)
    if (!stillPresent) {
      setDrillState(null)
      setDrillLga(null)
    }
  }, [analysis, drillState])

  const drillLevel: DrillLevel = drillLga ? 'ward' : drillState ? 'lga' : 'state'

  const scoped = useMemo<ReachScopedView | null>(() => {
    if (!analysis) return null
    const { columns, records } = analysis

    let scopedRecords = records
    if (drillState) scopedRecords = scopedRecords.filter((r) => cellText(r, columns.state) === drillState)
    if (drillLga) scopedRecords = scopedRecords.filter((r) => cellText(r, columns.lga) === drillLga)

    const groupColumn = drillLevel === 'state' ? columns.state : drillLevel === 'lga' ? columns.lga : columns.ward

    return {
      records: scopedRecords,
      groupColumn,
      visitationCounts: computeVisitationCounts(scopedRecords),
      reachCounts: computeReachCounts(scopedRecords),
      visitationByGroup: computeVisitationByGroup(scopedRecords, groupColumn),
      accessibilityCounts: computeAccessibilityCounts(scopedRecords, columns.accessibility),
      accessibilityByGroup: computeAccessibilityByGroup(scopedRecords, groupColumn, columns.accessibility),
      populationSummary: computePopulationSummary(scopedRecords, columns.population),
      missedByGroup: computeMissedPopulationByGroup(scopedRecords, columns.population, groupColumn),
    }
  }, [analysis, drillState, drillLga, drillLevel])

  const groupNoun = drillLevel === 'state' ? 'state' : drillLevel === 'lga' ? 'LGA' : 'ward'
  const groupNounPlural = drillLevel === 'state' ? 'states' : drillLevel === 'lga' ? 'LGAs' : 'wards'
  const scopeSuffix = drillLga ? ` in ${drillState} → ${drillLga}` : drillState ? ` in ${drillState}` : ''

  // Options for the settlement table's State/LGA selects. States come from
  // the whole result; LGAs only from the picked state, since an LGA name
  // alone repeats across states (see lgaKey in utils/reachAggregate.ts).
  const stateOptions = useMemo(() => {
    if (!analysis) return []
    const seen = new Set<string>()
    for (const record of analysis.records) {
      const state = cellText(record, analysis.columns.state)
      if (state) seen.add(state)
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [analysis])

  const lgaOptions = useMemo(() => {
    if (!analysis || !drillState) return []
    const seen = new Set<string>()
    for (const record of analysis.records) {
      if (cellText(record, analysis.columns.state) !== drillState) continue
      const lga = cellText(record, analysis.columns.lga)
      if (lga) seen.add(lga)
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [analysis, drillState])

  function handleDrillSelect(group: string) {
    if (drillLevel === 'state') setDrillState(group)
    else if (drillLevel === 'lga') setDrillLga(group)
    // Ward is the deepest level this page drills to — its charts never get
    // an onSelect handler in the first place (see the JSX below), so this
    // branch is unreachable in practice; kept as a no-op rather than
    // silently drilling past ward if that ever changes.
  }

  return (
    <div>
      <div ref={formRef}>
        <ReachForm onSubmit={handleSubmit} submitting={submitting} />
      </div>

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

      {submitting && runInfo && <ReachRunningCard run={runInfo} />}

      <JobProgress jobId={logJobId} running={submitting} steps={REACH_STEPS} />

      {/* A finished run with zero rows gets its own card instead of the
          dashboard — every card/chart below would otherwise render as zeros. */}
      {result && analysis && analysis.records.length === 0 && !submitting && (
        <ReachEmptyStateCard
          variant="no-rows"
          run={runInfo}
          onBackToForm={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      )}

      {analysis && scoped && analysis.records.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <button
                type="button"
                onClick={() => {
                  setDrillState(null)
                  setDrillLga(null)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: drillState ? 'pointer' : 'default',
                  color: drillState ? 'var(--color-primary)' : 'var(--color-text)',
                  fontWeight: drillState ? 400 : 600,
                  textDecoration: drillState ? 'underline' : 'none',
                }}
              >
                All states
              </button>
              {drillState && (
                <>
                  <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                  <button
                    type="button"
                    onClick={() => setDrillLga(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: drillLga ? 'pointer' : 'default',
                      color: drillLga ? 'var(--color-primary)' : 'var(--color-text)',
                      fontWeight: drillLga ? 400 : 600,
                      textDecoration: drillLga ? 'underline' : 'none',
                    }}
                  >
                    {drillState}
                  </button>
                </>
              )}
              {drillLga && (
                <>
                  <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                  <span style={{ fontWeight: 600 }}>{drillLga}</span>
                </>
              )}
            </div>

            {resultBlob && (
              <button
                type="button"
                onClick={handleDownloadCsv}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--color-surface)',
                  color: 'var(--color-primary)',
                  border: '1px solid var(--color-primary)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 14px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⬇ Download results CSV
              </button>
            )}
          </div>

          <ReachSummaryCards
            totalSettlements={analysis.totalSettlements}
            totalStates={analysis.totalStates}
            totalLgas={analysis.totalLgas}
            totalWards={analysis.totalWards}
          />
          <ReachVisitationCards counts={scoped.visitationCounts} />
          <ReachCountCards counts={scoped.reachCounts} />

          <LgaVisitationChart
            data={scoped.visitationByGroup}
            title={`Reach status by ${groupNoun}${scopeSuffix}`}
            groupLabel={groupNounPlural}
            emptyMessage={`No ${groupNoun} column detected in the result.`}
            onSelect={drillLevel !== 'ward' ? handleDrillSelect : undefined}
          />
          <SourceBreakdownChart data={analysis.sourceCounts} totalSettlements={analysis.totalSettlements} />

          <AccessibilityCards counts={scoped.accessibilityCounts} />
          <AccessibilityByStateChart
            data={scoped.accessibilityByGroup}
            title={`Accessibility status by ${groupNoun}${scopeSuffix}`}
            groupLabel={groupNounPlural}
            emptyMessage={`No ${groupNoun}/accessibility columns detected in the result.`}
            onSelect={drillLevel !== 'ward' ? handleDrillSelect : undefined}
          />

          {scoped.populationSummary ? (
            <>
              <PopulationSummaryCards summary={scoped.populationSummary} totalSettlements={scoped.records.length} />
              <MissedPopulationChart
                data={scoped.missedByGroup}
                title={`Potentially missed children by ${groupNoun}${scopeSuffix}`}
                groupLabel={groupNounPlural}
                emptyMessage={`No ${groupNoun} column detected in the result.`}
                onSelect={drillLevel !== 'ward' ? handleDrillSelect : undefined}
              />
            </>
          ) : (
            <div
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                padding: '14px 16px',
                marginBottom: 24,
                fontSize: 12.5,
                color: 'var(--color-text-muted)',
              }}
            >
              No population/target column was detected in this result, so population coverage and "potentially missed
              children" can't be shown — REACH's own analysis doesn't add a population figure, it only passes through
              whatever the uploaded planned settlements file already had.
            </div>
          )}

          <TabbedPanel
            activeKey={settlementView}
            onChange={(key) => setSettlementView(key as 'map' | 'list')}
            tabs={[
              {
                key: 'map',
                label: 'Map',
                content: <ReachMap records={scoped.records} columns={analysis.columns} bare />,
              },
              {
                key: 'list',
                label: 'List',
                content: (
                  <ReachSettlementListTable
                    records={scoped.records}
                    columns={analysis.columns}
                    filterState={drillState}
                    filterLga={drillLga}
                    onFilterStateChange={(state) => {
                      setDrillState(state)
                      setDrillLga(null)
                    }}
                    onFilterLgaChange={setDrillLga}
                    stateOptions={stateOptions}
                    lgaOptions={lgaOptions}
                    bare
                  />
                ),
              },
            ]}
          />
        </>
      )}

      {!result && !submitting && !error && <ReachEmptyStateCard variant="idle" />}
    </div>
  )
}
