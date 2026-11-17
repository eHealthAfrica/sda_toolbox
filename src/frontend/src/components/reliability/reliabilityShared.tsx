import type { CSSProperties, ReactNode } from 'react'
import type { IncidentSeverity, IncidentStatus } from '../../types/reliability'
import { categoryLabel } from '../../utils/reliability'

// Small building blocks shared by the Reliability page's cards, tables and
// pills, so each one looks and behaves the same everywhere.

export const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--color-text-muted)',
  fontWeight: 600,
  padding: '6px 8px',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}

export const tdStyle: CSSProperties = {
  padding: '8px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 12,
  verticalAlign: 'middle',
}

export const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 11.5,
}

export const buttonStyle: CSSProperties = {
  minHeight: 30,
  padding: '0 12px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

export const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  border: 'none',
  background: 'var(--color-primary)',
  color: '#fff',
}

interface CardProps {
  title: string
  sub?: ReactNode
  right?: ReactNode
  children: ReactNode
  style?: CSSProperties
}

export function Card({ title, sub, right, children, style }: CardProps) {
  return (
    <section className="card" style={{ minWidth: 0, ...style }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div className="card-title">{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '10px 0 2px' }}>{children}</div>
}

interface PillProps {
  label: string
  background: string
  color: string
  title?: string
}

export function Pill({ label, background, color, title }: PillProps) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        padding: '1px 9px',
        borderRadius: 20,
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background,
        color,
      }}
    >
      {label}
    </span>
  )
}

const SEVERITY_STYLE: Record<IncidentSeverity, { background: string; color: string; label: string }> = {
  sev1: { background: '#fbe6e6', color: 'var(--color-critical)', label: 'Sev 1' },
  sev2: { background: '#fdf1d6', color: '#8a5a00', label: 'Sev 2' },
  sev3: { background: '#e7eefc', color: 'var(--color-primary)', label: 'Sev 3' },
}

export function SeverityPill({ severity }: { severity: IncidentSeverity }) {
  const s = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.sev3
  return <Pill label={s.label} background={s.background} color={s.color} />
}

const STATUS_STYLE: Record<IncidentStatus, { background: string; color: string; label: string }> = {
  open: { background: '#fbe6e6', color: 'var(--color-critical)', label: 'Open' },
  acknowledged: { background: '#fdf1d6', color: '#8a5a00', label: 'Acknowledged' },
  resolved: { background: '#e9f8e9', color: '#0a7a0a', label: 'Resolved' },
}

export function IncidentStatusPill({ status }: { status: IncidentStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.open
  return <Pill label={s.label} background={s.background} color={s.color} />
}

// Counted categories (the ones that lower the success rate) get a red tint;
// the excluded ones (bad input, failed data checks) are grey so the eye goes
// to what the team can fix.
const EXCLUDED_CATEGORIES = new Set(['user_input', 'data_contract'])

export function CategoryPill({ category }: { category: string | null | undefined }) {
  const excluded = !!category && EXCLUDED_CATEGORIES.has(category)
  return (
    <Pill
      label={categoryLabel(category)}
      background={excluded ? '#eeede9' : '#fbe6e6'}
      color={excluded ? 'var(--color-text-secondary)' : 'var(--color-critical)'}
      title={excluded ? 'Not counted in the success rate' : 'Counted in the success rate'}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            style={{
              minHeight: 30,
              padding: '0 14px',
              border: 0,
              borderRight: '1px solid var(--color-border)',
              background: selected ? 'var(--color-primary)' : 'var(--color-surface)',
              color: selected ? '#fff' : 'var(--color-text-secondary)',
              fontSize: 12,
              fontWeight: selected ? 600 : 500,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
