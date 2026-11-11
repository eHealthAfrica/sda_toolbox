import type { Chip } from '../../utils/deviceTrackingEngine'

// The page-wide filters picked from the charts, as removable chips. Only
// drawn while at least one is active.
export default function DeviceFilterChips({ chips, onRemove, onClearAll }: { chips: Chip[]; onRemove: (chip: Chip) => void; onClearAll: () => void }) {
  if (chips.length === 0) return null
  return (
    <div
      role="region"
      aria-label="Filters picked from the charts"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, background: '#FFF8E6', border: '1px solid #E8C87A', borderRadius: 10, padding: '10px 14px' }}
    >
      <span style={{ fontSize: 12, color: '#6B4E00', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Filtered by</span>
      {chips.map((c) => (
        <button
          key={c.dim}
          type="button"
          onClick={() => onRemove(c)}
          aria-label={`Remove filter ${c.label}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 30, padding: '0 10px', borderRadius: 16, border: '1px solid #17212B', background: '#fff', color: '#17212B', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
        >
          {c.label}
          <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ))}
      <button type="button" onClick={onClearAll} style={{ minHeight: 30, padding: '0 10px', border: 0, background: 'transparent', color: 'var(--color-primary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
        Clear all
      </button>
      <span style={{ flexBasis: '100%', fontSize: 12, color: '#6B4E00' }}>
        Every chart, card, line list and download on the page is narrowed to these. Select a chart part again to remove it.
      </span>
    </div>
  )
}
