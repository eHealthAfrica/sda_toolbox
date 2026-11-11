import { useEffect, useState } from 'react'
import { TRIANGULATION_METHOD_LABELS } from '../../types/reach'
import type { ReachRunInfo } from '../../types/reach'

interface ReachRunningCardProps {
  run: ReachRunInfo
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

// Shown while POST /validation is in flight. The endpoint is ONE request with
// no batching or progress reporting of its own (unlike the DIP generator's
// per-LGA batches), so there is no honest percentage to draw — this is an
// indeterminate bar plus what IS known: which files are being matched, which
// triangulation method is running, and how long it has been going.
export default function ReachRunningCard({ run }: ReachRunningCardProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const inputs: Array<{ label: string; value: string | null }> = [
    { label: 'Planned settlements', value: run.plannedFileName },
    { label: 'Data sources', value: run.dataSourcesFileName },
    { label: 'Tracks', value: run.tracksFileName },
  ]

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderLeft: '4px solid var(--color-primary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px 18px',
        marginBottom: 20,
      }}
    >
      <style>{`
        @keyframes reachIndeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Running REACH triangulation…</h3>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {formatElapsed(elapsed)} elapsed
        </div>
      </div>

      <div style={{ height: 8, background: '#eef0f2', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
        <div
          style={{
            height: '100%',
            width: '30%',
            background: 'linear-gradient(90deg, #2c5f9e, #4a83c9)',
            borderRadius: 8,
            animation: 'reachIndeterminate 1.4s ease-in-out infinite',
          }}
        />
      </div>

      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
        Matching every planned settlement against each data source. Large uploads can take several minutes — this page
        will show the results as soon as the run finishes, so you can leave it open.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 24px', fontSize: 12 }}>
        {inputs
          .filter((input) => input.value)
          .map((input) => (
            <div key={input.label}>
              <span style={{ color: 'var(--color-text-muted)' }}>{input.label}: </span>
              <b style={{ color: 'var(--color-text)' }}>{input.value}</b>
            </div>
          ))}
        <div>
          <span style={{ color: 'var(--color-text-muted)' }}>Method: </span>
          <b style={{ color: 'var(--color-text)' }}>{TRIANGULATION_METHOD_LABELS[run.method]}</b>
        </div>
      </div>
    </div>
  )
}
