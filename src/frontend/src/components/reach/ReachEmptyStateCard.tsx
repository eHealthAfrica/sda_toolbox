import type { ReachRunInfo } from '../../types/reach'

interface ReachEmptyStateCardProps {
  // 'idle'    -> nothing has been run yet (first visit to the page).
  // 'no-rows' -> a run finished with HTTP 200 but its CSV has no settlement
  //              rows, so there is nothing to chart, map or list.
  variant: 'idle' | 'no-rows'
  // Only used by 'no-rows' — what the page knows about the run that produced
  // the empty result (the response itself carries no row or scan counts).
  run?: ReachRunInfo | null
  // Scrolls the page back up to the form. Only offered by 'no-rows'.
  onBackToForm?: () => void
}

const cardBase = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-sm)',
  padding: '18px 20px',
  marginBottom: 24,
} as const

// Replaces two things the page used to do: a single grey line when nothing
// has been run, and — for a run that returned zero rows — a dashboard of
// zero-valued cards over empty charts, which reads like a rendering fault
// rather than "the analysis found nothing to report".
export default function ReachEmptyStateCard({ variant, run, onBackToForm }: ReachEmptyStateCardProps) {
  if (variant === 'idle') {
    return (
      <div style={{ ...cardBase, borderStyle: 'dashed' }}>
        <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>No REACH analysis yet</h3>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
          Upload a planned settlements file and a data sources file above, then run the analysis. Results appear here:
          reach status by state, LGA and ward, which sources validated each settlement, accessibility, potentially
          missed children and a filterable settlement list.
        </div>
      </div>
    )
  }

  return (
    <div role="status" style={{ ...cardBase, borderLeft: '4px solid var(--color-warning, #b7791f)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span aria-hidden style={{ fontSize: 18, color: 'var(--color-warning, #b7791f)' }}>
          !
        </span>
        <h3 style={{ fontSize: 15, margin: 0 }}>The analysis returned no settlements</h3>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
        The run finished without an error, but the result has no settlement rows
        {run?.plannedFileName ? (
          <>
            {' '}
            for <b style={{ color: 'var(--color-text)' }}>{run.plannedFileName}</b>
          </>
        ) : null}
        , so there is nothing to chart, map or list.
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-muted)', marginTop: 10 }}>
        Check that the planned settlements file actually contains settlements, then run it again. If the file is
        correct, the backend may have dropped every row — worth asking whoever maintains the REACH service.
      </div>

      {onBackToForm && (
        <button
          type="button"
          onClick={onBackToForm}
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
          ↑ Back to the form
        </button>
      )}
    </div>
  )
}
