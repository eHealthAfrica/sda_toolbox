import { useState } from 'react'
import { submitDailyReport, ApiError } from '../../api/client'
import type { DailyReportFormInput, DailyPostReport } from '../../types/dailyReport'
import { useJobTracker } from '../../state/jobTracker'
import DailyReportForm from './DailyReportForm'
import DailyReportChartsPanel from './DailyReportChartsPanel'

// Reporting · Daily Report. POST /reports/daily was reworked server-side
// (toolbox/apps/tracking/reporter/campaign_day_reporting.py) to return the
// exact same list[PostReport] JSON contract POST /reports/post already
// used — this page mirrors PostImplementationPage's structure and
// rendering behaviour as closely as DailyReport's real shape allows.
//
// All of the "given a list[PostReport], render it" logic (summary cards,
// click-to-filter charts by state, the TabbedPanel of chart tables, and the
// gallery) now lives in DailyReportChartsPanel, shared with H2HTrackingPage
// since Gridded H2H's optional reports are the literal same DailyReport-
// produced shape, just reached through a different endpoint — see that
// component's docstring.
export default function DailyReportPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; detail: unknown } | null>(null)
  const [reports, setReports] = useState<DailyPostReport[] | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: DailyReportFormInput) {
    setSubmitting(true)
    setError(null)
    setReports(null)
    const jobId = startJob('daily-report', input.settlementFile?.name ?? 'Daily Report run')
    try {
      const result = await submitDailyReport(input)
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

  return (
    <div>
      <DailyReportForm onSubmit={handleSubmit} submitting={submitting} />

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

      {reports && allReports.length > 0 && <DailyReportChartsPanel reports={allReports} />}

      {reports && allReports.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          The response contained no report figures.
        </div>
      )}

      {!submitting && !error && !reports && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a settlement list above and choose a Day column and a Coverage column to generate charts.
        </div>
      )}
    </div>
  )
}
