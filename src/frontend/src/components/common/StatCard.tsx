import type { CSSProperties, ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: ReactNode
  accentColor?: string
  hint?: string
  // Optional — lets a card double as a filter toggle (e.g. MlosQcPage's
  // issue-flag cards filtering the settlement table below). Cards that
  // don't pass onClick render exactly as before.
  onClick?: () => void
  active?: boolean
}

const cardStyle = (accentColor?: string, clickable?: boolean, active?: boolean): CSSProperties => ({
  background: active ? '#eaf1fb' : 'var(--color-surface)',
  border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
  borderTop: accentColor ? `3px solid ${accentColor}` : '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-sm)',
  padding: '14px 16px',
  minWidth: 150,
  flex: '1 1 150px',
  cursor: clickable ? 'pointer' : undefined,
  transition: 'border-color .12s, background .12s',
})

export default function StatCard({ label, value, accentColor, hint, onClick, active }: StatCardProps) {
  return (
    <div
      style={cardStyle(accentColor, !!onClick, active)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{hint}</div>
      )}
      {onClick && (
        <div style={{ fontSize: 10.5, color: 'var(--color-primary)', marginTop: 6, fontWeight: 600 }}>
          {active ? 'Filtering below · click to clear' : 'Click to filter below'}
        </div>
      )}
    </div>
  )
}
