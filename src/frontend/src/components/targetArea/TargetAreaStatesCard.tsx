import type { TargetAreaRunSummary } from '../../types/targetArea'
import { statesRunText } from '../../utils/targetAreaRun'

interface TargetAreaStatesCardProps {
  summary: TargetAreaRunSummary | null
}

// The first thing under the form after a run: how many states were generated, which ones, and — as a line
// list — the states that were not run with the reason each was skipped, so nobody has to read the server log
// to learn why a state is missing from the download.
export default function TargetAreaStatesCard({ summary }: TargetAreaStatesCardProps) {
  if (!summary) return null

  const total = summary.statesRun.length + summary.skipped.length
  if (total === 0) return null

  const skippedCount = summary.skipped.length
  const accent = skippedCount > 0 ? 'var(--color-critical)' : 'var(--color-good)'

  return (
    <section
      aria-label="States in this run"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderTop: `3px solid ${accent}`,
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '14px 16px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>States</div>
          <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{statesRunText(summary)} ran</div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
          {skippedCount === 0
            ? total === 1
              ? 'The state in the master list was generated.'
              : `All ${total} states in the master list were generated.`
            : `${skippedCount} ${skippedCount === 1 ? 'state was' : 'states were'} skipped and ${skippedCount === 1 ? 'is' : 'are'} not in the download.`}
        </div>
      </div>

      {summary.statesRun.length > 0 && (
        <ul
          aria-label="States that ran"
          style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}
        >
          {summary.statesRun.map((state) => (
            <li
              key={state}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 999,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
              }}
            >
              {state}
            </li>
          ))}
        </ul>
      )}

      {skippedCount > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-critical)', marginBottom: 6 }}>
            Not run ({skippedCount})
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {summary.skipped.map((item) => (
              <li
                key={item.state}
                style={{
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: '7px 0',
                  borderTop: '1px solid var(--color-border)',
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontWeight: 700, minWidth: 110 }}>{item.state}</span>
                <span style={{ flex: '1 1 260px', color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>
                  {item.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
