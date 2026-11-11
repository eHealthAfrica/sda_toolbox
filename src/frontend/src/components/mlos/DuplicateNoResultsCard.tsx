import { THRESHOLD_MIN } from '../../types/duplicateChecker'
import type { DuplicateRunInfo } from '../../types/duplicateChecker'

interface DuplicateNoResultsCardProps {
  run: DuplicateRunInfo
  // Scrolls the page back up to the form so the user can lower the slider.
  // Only offered while the run's threshold is still above THRESHOLD_MIN.
  onAdjustThreshold: () => void
}

// Shown INSTEAD of the whole results dashboard when the backend finds no pair
// of settlements at or above the similarity threshold. In that case
// deep_search.py::duplicate_deep_search_protocol returns an empty DataFrame
// and the endpoint answers 200 with an empty CSV (no header row, no pairs) —
// a clean result, not a failure, but one the cards/chart/table would
// otherwise render as a screen full of zeros ending in "No flagged pairs
// match the current filters", which reads like a filter problem.
//
// The empty response carries no scan totals (wards/settlements checked), so
// this card only states what the page itself knows: the file and threshold.
export default function DuplicateNoResultsCard({ run, onAdjustThreshold }: DuplicateNoResultsCardProps) {
  const atLoosest = run.threshold <= THRESHOLD_MIN

  return (
    <div
      role="status"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderLeft: '4px solid var(--color-good)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '18px 20px',
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span aria-hidden style={{ fontSize: 18, color: 'var(--color-good)' }}>
          ✓
        </span>
        <h3 style={{ fontSize: 15, margin: 0 }}>No potential duplicates found</h3>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
        No two settlements in the same ward scored at or above a text similarity of{' '}
        <b style={{ color: 'var(--color-text)' }}>{run.threshold}</b> in{' '}
        <b style={{ color: 'var(--color-text)' }}>{run.fileName}</b>. There is nothing to review or download for this
        run.
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-muted)', marginTop: 10 }}>
        {atLoosest ? (
          <>This run already used the loosest similarity setting ({THRESHOLD_MIN}), so lowering it further isn't possible.</>
        ) : (
          <>
            A lower threshold treats less-similar names as possible matches, which can surface near-duplicates a
            stricter run skips (the slider goes down to {THRESHOLD_MIN}).
          </>
        )}
      </div>

      {!atLoosest && (
        <button
          type="button"
          onClick={onAdjustThreshold}
          style={{
            marginTop: 12,
            background: 'none',
            border: '1px solid var(--color-primary)',
            color: 'var(--color-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ↑ Try a lower threshold
        </button>
      )}
    </div>
  )
}
