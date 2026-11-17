import { FLAG_SETS } from '../../types/deviceTracking'

// Collapsible plain-language rules for every flag on the page, taken from the
// same definitions the charts' legends use so the two can never disagree.
export default function DeviceFlagDefinitions() {
  return (
    <details
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '14px 18px',
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13.5 }}>How the flags are worked out</summary>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
          marginTop: 12,
          fontSize: 12.5,
          lineHeight: 1.5,
          color: 'var(--color-text-secondary)',
        }}
      >
        {FLAG_SETS.map((set) => (
          <div key={set.id}>
            <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{set.title}</div>
            {set.cats.map((c) => (
              <div key={c.key}>
                <b>{c.name}</b> — {c.rule}
              </div>
            ))}
            {set.source === 'derived' && (
              <div style={{ marginTop: 4, color: 'var(--color-text-muted)' }}>Worked out on this page from team code, device and day; the backend does not return it.</div>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}
