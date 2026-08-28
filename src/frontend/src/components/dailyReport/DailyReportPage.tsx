import { useState } from 'react'
import { submitDailyReport, ApiError } from '../../api/client'
import { parseDailyReportZip } from '../../api/parseResult'
import { extractDayNumber } from '../../utils/columns'
import type { DailyReportFormInput, ParsedDailyReportResult } from '../../types/dailyReport'
import { useJobTracker } from '../../state/jobTracker'
import DailyReportForm from './DailyReportForm'
import DailyReportResults from './DailyReportResults'

// Reporting · Daily Report. POST /reports/daily is expected to fail today —
// see the top-of-file comment on api/client.ts::submitDailyReport for the
// three independent, code-confirmed reasons (an unconditional `raise` gate,
// a None-crash in detect_number for cumulative-only requests, and a
// positional-argument mismatch between write_in_memory_zip and
// DailyReport.writer that would crash even a fully-valid request). This
// page still makes the real call rather than faking or disabling it — same
// posture as LgaDataPage — and surfaces whatever the backend actually
// returns, honestly, rather than a generic failure message.
export default function DailyReportPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; detail: unknown } | null>(null)
  const [result, setResult] = useState<ParsedDailyReportResult | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: DailyReportFormInput) {
    setSubmitting(true)
    setError(null)
    setResult(null)
    const jobId = startJob('daily-report', input.settlementFile?.name ?? 'Daily Report run')
    try {
      const blob = await submitDailyReport(input)
      // Only meaningful once the backend is fixed — see
      // api/parseResult.ts::parseDailyReportZip. dayNumber mirrors what the
      // route itself would compute (detect_number(campaign_day_col)); a
      // cumulative-only request has no campaign_day_col to derive it from,
      // so this stays null for that case rather than guessing.
      const dayNumber = extractDayNumber(input.campaignDayCol)
      const parsed = await parseDailyReportZip(blob, dayNumber)
      setResult(parsed)
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

  return (
    <div>
      <DailyReportForm onSubmit={handleSubmit} submitting={submitting} />

      <div
        style={{
          background: '#fbe6e6',
          border: '1px solid #f0b8b8',
          borderRadius: 'var(--radius-lg)',
          padding: '14px 16px',
          marginBottom: 16,
          fontSize: 12,
          lineHeight: 1.65,
          color: '#7a2020',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#7a2020' }}>
          ⚠ Unlike some other routes on this list, this isn't a hollow stub — three separate bugs still block it
        </div>
        <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li style={{ marginBottom: 8 }}>
            <b>The route opens with an unconditional gate.</b> Line 42 of{' '}
            <code>campaign_day_reporting.py::generate_campaign_daily_report</code> is{' '}
            <code>raise ResourcesError('Not Available', 'This service is currently under development')</code>, before
            any of the real logic below it runs — that's the response you'll get from clicking "Generate Reports"
            above, today, exactly as returned.
          </li>
          <li style={{ marginBottom: 8 }}>
            <b>If that gate is removed, a cumulative-only request crashes next.</b> The route's own validation allows
            submitting only a Cumulative column — but line 58, <code>detect_number(campaign_day_col)</code>, runs
            unconditionally and passes <code>None</code> into a regex search, raising{' '}
            <code>TypeError: expected string or bytes-like object</code>.
          </li>
          <li style={{ marginBottom: 0 }}>
            <b>Even a fully valid request — both columns supplied — still fails one line later.</b>{' '}
            <code>write_in_memory_zip(daily_report, image_reports, campaign_day)</code> calls{' '}
            <code>DailyReport.writer(images, tmp_dir, campaign_day)</code> with three positional arguments, but{' '}
            <code>DailyReport.writer</code> is declared <code>writer(report_output, folder, **kwargs)</code> — no
            third positional parameter — so this raises{' '}
            <code>TypeError: writer() takes 2 positional arguments but 3 were given</code>. The Post-Implementation
            route's own writer (<code>PostImplementationReport.writer(report_output, folder, lga_list)</code>) has a
            real third parameter and works fine through the exact same helper — this one just doesn't.
          </li>
        </ol>
        <div style={{ marginTop: 10 }}>
          The underlying logic (reading the upload, fuzzy-matching the two column names, calling{' '}
          <code>DailyReport.generate_report()</code>, the chart styling itself) is fully written and reuses the same{' '}
          <code>Reporters</code>/<code>DailyReport</code> classes and <code>prep.py</code>/<code>viz.py</code> helpers
          already proven out by the working Post-Implementation route — none of that needs to change, just these
          three lines.
        </div>
      </div>

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
          <div style={{ marginTop: 8 }}>This is expected — see the caveat above for the three known reasons why.</div>
        </div>
      )}

      {submitting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '12px 0', textAlign: 'center' }}>
          Calling the real endpoint…
        </div>
      )}

      {result && (result.day || result.cumulative) && (
        <>
          <div
            style={{
              background: '#e6f6e6',
              border: '1px solid #bfe6bf',
              borderRadius: 'var(--radius-lg)',
              padding: '14px 16px',
              marginBottom: 16,
              fontSize: 12.5,
              color: '#14532d',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ The route actually returned reports this time</div>
            Worth checking whether the backend was fixed, since this shouldn't be reachable today.
          </div>
          <DailyReportResults result={result} />
        </>
      )}

      {!submitting && !error && !result && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a settlement list above and choose at least one of the two report columns to generate charts.
        </div>
      )}
    </div>
  )
}
