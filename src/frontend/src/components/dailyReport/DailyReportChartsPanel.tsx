import { useMemo, useState } from 'react'
import type { DailyPostReport, DailyReportQualifier } from '../../types/dailyReport'
import { reportQualifier } from '../../types/dailyReport'
import { countReportsByState, uniqueStates } from '../../utils/dailyReportAggregate'
import { CATEGORICAL_PALETTE } from '../../utils/colors'
import DailyReportSummaryCards from './DailyReportSummaryCards'
import DailyReportCountByStateChart from './DailyReportCountByStateChart'
import DailyReportChartTable from './DailyReportChartTable'
import DailyReportGallery from './DailyReportGallery'
import TabbedPanel from '../common/TabbedPanel'
import type { TabbedPanelTab } from '../common/TabbedPanel'

interface DailyReportChartsPanelProps {
  reports: DailyPostReport[]
}

/**
 * The full "given a list[PostReport], render it" body — summary cards, the
 * two click-to-filter "charts by state" bars, a TabbedPanel of paginated/
 * filterable chart tables, and a gallery gated behind a State selection.
 * Extracted out of DailyReportPage.tsx so the exact same rendering can be
 * reused wherever else this app produces a DailyReport-shaped report list.
 *
 * Currently that's also H2HTrackingPage.tsx's "Generate daily reports"
 * results — those come from the literal same toolbox.reporting.DailyReport
 * class (via campaign/tracker.py::prepare_reports) as POST /reports/daily
 * does, just reached through GET /tracking/gridded/reports/{job_id} instead
 * of its own dedicated upload form. Reusing this component rather than
 * duplicating it is deliberate here — unlike Post Implementation's report
 * shape, which is a genuinely different endpoint/model with its own
 * components in components/postImplementation/, this really is the same
 * feature rendered in a second place, not a look-alike.
 */
export default function DailyReportChartsPanel({ reports }: DailyReportChartsPanelProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'breakdown'>('summary')
  const [filterState, setFilterState] = useState<string | null>(null)
  const [filterQualifier, setFilterQualifier] = useState<DailyReportQualifier | null>(null)

  const summaryReports = useMemo(() => reports.filter((r) => r.level === 'state'), [reports])
  const breakdownReports = useMemo(() => reports.filter((r) => r.level === 'lga'), [reports])
  const daySummaryCount = useMemo(() => summaryReports.filter((r) => reportQualifier(r) === 'day').length, [summaryReports])
  const cumulativeSummaryCount = summaryReports.length - daySummaryCount
  const dayBreakdownCount = useMemo(() => breakdownReports.filter((r) => reportQualifier(r) === 'day').length, [breakdownReports])
  const cumulativeBreakdownCount = breakdownReports.length - dayBreakdownCount
  const summaryCountByState = useMemo(() => countReportsByState(reports, 'state', null), [reports])
  const breakdownCountByState = useMemo(() => countReportsByState(reports, 'lga', null), [reports])
  const stateOptions = useMemo(() => uniqueStates(reports), [reports])

  function handleSelectState(state: string) {
    setFilterState((prev) => (prev === state ? null : state))
  }
  function handleRowSelect(state: string, qualifier: DailyReportQualifier) {
    setFilterState(state)
    setFilterQualifier(qualifier)
  }

  const tableProps = {
    stateOptions,
    filterState,
    filterQualifier,
    onFilterStateChange: setFilterState,
    onFilterQualifierChange: setFilterQualifier,
    onRowSelect: handleRowSelect,
    bare: true as const,
  }

  const tabs: TabbedPanelTab[] = [
    {
      key: 'summary',
      label: `Summary charts (${summaryReports.length})`,
      content: <DailyReportChartTable reports={summaryReports} levelLabel="Summary" {...tableProps} />,
    },
    {
      key: 'breakdown',
      label: `Breakdown charts (${breakdownReports.length})`,
      content: <DailyReportChartTable reports={breakdownReports} levelLabel="Breakdown" {...tableProps} />,
    },
  ]

  return (
    <>
      <DailyReportSummaryCards
        totalImages={reports.length}
        totalStates={stateOptions.length}
        daySummaryCount={daySummaryCount}
        cumulativeSummaryCount={cumulativeSummaryCount}
        dayBreakdownCount={dayBreakdownCount}
        cumulativeBreakdownCount={cumulativeBreakdownCount}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 24 }}>
        <DailyReportCountByStateChart
          data={summaryCountByState}
          title="State Summary charts generated, by state"
          color={CATEGORICAL_PALETTE[0]}
          emptyMessage="No summary charts found in the response."
          onSelectState={handleSelectState}
        />
        <DailyReportCountByStateChart
          data={breakdownCountByState}
          title="LGA Breakdown charts generated, by state"
          color={CATEGORICAL_PALETTE[4]}
          emptyMessage="No breakdown charts found in the response."
          onSelectState={handleSelectState}
        />
      </div>

      <TabbedPanel tabs={tabs} activeKey={activeTab} onChange={(key) => setActiveTab(key as 'summary' | 'breakdown')} />

      <DailyReportGallery reports={reports} filterState={filterState} filterQualifier={filterQualifier} />
    </>
  )
}
