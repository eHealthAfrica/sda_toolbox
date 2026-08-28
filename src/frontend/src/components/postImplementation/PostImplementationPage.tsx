import { useMemo, useState } from 'react'
import { submitPostImplementationReport, ApiError } from '../../api/client'
import type { PostImplementationFormInput, PostReport } from '../../types/postImplementation'
import { countReportsByState, uniqueLgasForState, uniqueStates } from '../../utils/postImplementationAggregate'
import { CATEGORICAL_PALETTE } from '../../utils/colors'
import { useJobTracker } from '../../state/jobTracker'
import PostImplementationForm from './PostImplementationForm'
import PostImplementationSummaryCards from './PostImplementationSummaryCards'
import ChartCountByStateChart from './ChartCountByStateChart'
import PostImplementationChartTable from './PostImplementationChartTable'
import PostImplementationGallery from './PostImplementationGallery'
import TabbedPanel from '../common/TabbedPanel'
import type { TabbedPanelTab } from '../common/TabbedPanel'

// Reporting · Post Implementation Report. Calls POST /reports/post
// (api/client.ts::submitPostImplementationReport) and renders whatever
// list[PostReport] comes back directly — one LGA-level summary pie chart
// and one ward-level breakdown bar chart per LGA in the uploaded settlement
// list, each carrying its own state/lga/level fields plus a raw Plotly
// figure spec that PostImplementationGallery renders live, rather than the
// old ZIP-of-PNGs-plus-filename-parsing contract.
export default function PostImplementationPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; detail: unknown } | null>(null)
  const [reports, setReports] = useState<PostReport[] | null>(null)
  const [activeTab, setActiveTab] = useState<'summary' | 'breakdown'>('summary')
  const [filterState, setFilterState] = useState<string | null>(null)
  const [filterLga, setFilterLga] = useState<string | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: PostImplementationFormInput) {
    setSubmitting(true)
    setError(null)
    setReports(null)
    setFilterState(null)
    setFilterLga(null)
    const jobId = startJob('post-implementation', input.settlementFile?.name ?? 'Post Implementation Report run')
    try {
      const result = await submitPostImplementationReport(input)
      setReports(result)
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ message: `Request failed with status ${err.status}.`, detail: err.detail })
      } else {
        setError({ message: err instanceof Error ? err.message : 'The request failed.', detail: null })
      }
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  const allReports = reports ?? []
  const summaryReports = useMemo(() => allReports.filter((r) => r.level === 'lga'), [allReports])
  const breakdownReports = useMemo(() => allReports.filter((r) => r.level === 'ward'), [allReports])
  const summaryCountByState = useMemo(() => countReportsByState(allReports, 'lga'), [allReports])
  const breakdownCountByState = useMemo(() => countReportsByState(allReports, 'ward'), [allReports])
  const stateOptions = useMemo(() => uniqueStates(allReports), [allReports])
  const lgaOptions = useMemo(() => uniqueLgasForState(allReports, filterState), [allReports, filterState])
  const totalLgas = useMemo(() => new Set(allReports.map((r) => `${r.state}__${r.lga}`)).size, [allReports])

  function handleSelectState(state: string) {
    setFilterState((prev) => (prev === state ? null : state))
    setFilterLga(null)
  }
  function handleFilterStateChange(state: string | null) {
    setFilterState(state)
    setFilterLga(null)
  }
  function handleRowSelect(state: string, lga: string) {
    setFilterState(state)
    setFilterLga(lga)
  }

  const tableProps = {
    stateOptions,
    lgaOptions,
    filterState,
    filterLga,
    onFilterStateChange: handleFilterStateChange,
    onFilterLgaChange: setFilterLga,
    onRowSelect: handleRowSelect,
    bare: true as const,
  }

  const tabs: TabbedPanelTab[] = [
    {
      key: 'summary',
      label: `Summary charts (${summaryReports.length})`,
      content: <PostImplementationChartTable reports={summaryReports} levelLabel="Summary" {...tableProps} />,
    },
    {
      key: 'breakdown',
      label: `Breakdown charts (${breakdownReports.length})`,
      content: <PostImplementationChartTable reports={breakdownReports} levelLabel="Breakdown" {...tableProps} />,
    },
  ]

  return (
    <div>
      <PostImplementationForm onSubmit={handleSubmit} submitting={submitting} />

      {error && (
        <div
          style={{
            background: '#fbe6e6',
            border: '1px solid #f0b8b8',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
            marginBottom: 16,
            fontSize: 12.5,
            color: '#7a2020',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠ The Generate Reports request failed</div>
          <div style={{ marginBottom: error.detail ? 8 : 0 }}>{error.message}</div>
          {error.detail !== null && error.detail !== undefined && (
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 11,
                background: 'rgba(0,0,0,.05)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 10px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail)}
            </div>
          )}
        </div>
      )}

      {submitting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '12px 0', textAlign: 'center' }}>
          Generating reports…
        </div>
      )}

      {reports && allReports.length > 0 && (
        <>
          <PostImplementationSummaryCards
            totalImages={allReports.length}
            totalStates={stateOptions.length}
            totalLgas={totalLgas}
            totalSummaryCharts={summaryReports.length}
            totalBreakdownCharts={breakdownReports.length}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 24 }}>
            <ChartCountByStateChart
              data={summaryCountByState}
              title="LGA Summary charts generated, by state"
              color={CATEGORICAL_PALETTE[0]}
              emptyMessage="No summary charts found in the response."
              onSelectState={handleSelectState}
            />
            <ChartCountByStateChart
              data={breakdownCountByState}
              title="Ward Breakdown charts generated, by state"
              color={CATEGORICAL_PALETTE[4]}
              emptyMessage="No breakdown charts found in the response."
              onSelectState={handleSelectState}
            />
          </div>

          <TabbedPanel tabs={tabs} activeKey={activeTab} onChange={(key) => setActiveTab(key as 'summary' | 'breakdown')} />

          <PostImplementationGallery reports={allReports} filterState={filterState} filterLga={filterLga} />
        </>
      )}

      {reports && allReports.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          The response contained no report figures.
        </div>
      )}

      {!submitting && !error && !reports && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a settlement list above and choose a status column to generate charts.
        </div>
      )}
    </div>
  )
}
