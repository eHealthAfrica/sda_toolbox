import { useState } from 'react'
import type { ParsedDailyReportResult } from '../../types/dailyReport'

interface DailyReportResultsProps {
  result: ParsedDailyReportResult
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-sm)',
  padding: '14px 16px',
}

/**
 * Renders whichever PNG chart images api/parseResult.ts::parseDailyReportZip
 * found in the response ZIP — a "Day" tab and a "Cumulative" tab, each with
 * the summary chart and the LGA breakdown chart DailyReport.generate_report
 * produces for that set. A tab is only offered when its set is actually
 * present (the real route only builds a "day" set when campaign_day_col was
 * supplied, only a "cumulative" set when cumulative_day_col was — see
 * types/dailyReport.ts), so this never shows an empty panel.
 */
export default function DailyReportResults({ result }: DailyReportResultsProps) {
  const availableTabs: Array<'day' | 'cumulative'> = [
    ...(result.day ? (['day'] as const) : []),
    ...(result.cumulative ? (['cumulative'] as const) : []),
  ]
  const [requestedTab, setRequestedTab] = useState<'day' | 'cumulative'>(availableTabs[0] ?? 'day')

  if (availableTabs.length === 0) return null

  // Clamp rather than trust the stored state directly: if a later `result`
  // (a second successful run in the same session) no longer has the
  // previously-active set, fall back to whichever tab IS available instead
  // of rendering a tab bar with nothing selected underneath it.
  const activeTab = availableTabs.includes(requestedTab) ? requestedTab : availableTabs[0]
  const activeSet = activeTab === 'day' ? result.day : result.cumulative

  return (
    <div>
      {availableTabs.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {availableTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setRequestedTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--color-primary)' : 'var(--color-surface)',
                color: activeTab === tab ? '#fff' : 'var(--color-text)',
                border: `1px solid ${activeTab === tab ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {tab === 'day' ? 'Day' : 'Cumulative'}
            </button>
          ))}
        </div>
      )}

      {activeSet && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
              {activeTab === 'day' ? 'Day summary' : 'Cumulative summary'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 10 }}>generate_summary_report</div>
            <img src={activeSet.summary.url} alt={activeSet.summary.filename} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
            <a
              href={activeSet.summary.url}
              download={activeSet.summary.filename}
              style={{ fontSize: 11.5, color: 'var(--color-primary)', display: 'inline-block', marginTop: 8 }}
            >
              ⬇ {activeSet.summary.filename}
            </a>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
              {activeTab === 'day' ? 'Day breakdown by LGA' : 'Cumulative breakdown by LGA'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 10 }}>generate_lga_reports</div>
            <img src={activeSet.breakdown.url} alt={activeSet.breakdown.filename} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
            <a
              href={activeSet.breakdown.url}
              download={activeSet.breakdown.filename}
              style={{ fontSize: 11.5, color: 'var(--color-primary)', display: 'inline-block', marginTop: 8 }}
            >
              ⬇ {activeSet.breakdown.filename}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
