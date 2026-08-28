import type { CSSProperties } from 'react'
import type { BreakdownSlice, CombineAnalysis } from '../../types/microplan'

interface CompositionBreakdownProps {
  analysis: CombineAnalysis
}

const PALETTE: Record<string, string> = {
  // Category
  rural: '#2c5f9e',
  scattered: '#e08a2c',
  urban: '#7a5cd0',
  // Accessibility — reuses the app's semantic good/warning/critical tokens
  'Fully Accessible': 'var(--color-good)',
  'Partially Accessible': 'var(--color-warning)',
  Inaccessible: 'var(--color-critical)',
  // Habitation
  Inhabited: '#2c5f9e',
  'Partially Inhabited': '#9aa5b1',
  // Special place type
  school: '#2c5f9e',
  mosque: '#7a5cd0',
  market: '#e08a2c',
  church: '#9aa5b1',
}

function colorFor(label: string): string {
  return PALETTE[label] ?? '#2c5f9e'
}

function BarList({ title, slices }: { title: string; slices: BreakdownSlice[] }) {
  const max = Math.max(1, ...slices.map((s) => s.count))
  const labelStyle: CSSProperties = { width: 150, flexShrink: 0, color: 'var(--color-text)' }
  const trackStyle: CSSProperties = { flex: 1, height: 9, background: '#eef0f2', borderRadius: 5, overflow: 'hidden' }
  const valueStyle: CSSProperties = { width: 90, textAlign: 'right', color: 'var(--color-text-muted)', flexShrink: 0 }

  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)' }}>{title.toUpperCase()}</div>
      {slices.map((s) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 11.5 }}>
          <div style={labelStyle}>{s.label}</div>
          <div style={trackStyle}>
            <div style={{ height: '100%', borderRadius: 5, width: `${(s.count / max) * 100}%`, background: colorFor(s.label) }} />
          </div>
          <div style={valueStyle}>
            {s.count.toLocaleString()} ({s.pct}%)
          </div>
        </div>
      ))}
    </div>
  )
}

// A first read of coverage and access quality before anyone opens the
// spreadsheet — computed straight from the parsed Settlements/Special
// Places arrays (utils/microplanCombine.ts).
export default function CompositionBreakdown({ analysis }: CompositionBreakdownProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Composition breakdown</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Computed from the combined Settlements sheet — a first read of coverage and access quality before anyone opens the spreadsheet.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        <BarList title="Settlement category" slices={analysis.categoryBreakdown} />
        <BarList title="Accessibility" slices={analysis.accessibilityBreakdown} />
        <BarList title="Habitation" slices={analysis.habitationBreakdown} />
        <BarList title="Special place type" slices={analysis.specialPlaceTypeBreakdown} />
      </div>
    </div>
  )
}
