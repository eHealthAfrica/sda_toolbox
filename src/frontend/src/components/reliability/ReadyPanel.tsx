import type { ReadyReport, ReadyStatus } from '../../types/reliability'
import { formatSeconds } from '../../utils/reliability'
import { EmptyNote, Pill } from './reliabilityShared'

interface ReadyPanelProps {
  report: ReadyReport | null
  // True once GET /ready answered 404, i.e. the backend has no readiness route.
  unavailable: boolean
}

const STATUS_STYLE: Record<ReadyStatus, { label: string; background: string; color: string }> = {
  ready: { label: 'Ready', background: '#e9f8e9', color: '#0a7a0a' },
  degraded: { label: 'Degraded', background: '#fdf1d6', color: '#8a5a00' },
  not_ready: { label: 'Not ready', background: '#fbe6e6', color: 'var(--color-critical)' },
}

// Live view of GET /ready: one line per check. A failing critical check is
// red; a failing non-critical one is amber (the service still works, but
// something it depends on for some tools is off).
export default function ReadyPanel({ report, unavailable }: ReadyPanelProps) {
  if (unavailable) {
    return <EmptyNote>This backend has no /ready route yet. See the Backend Spec, section “API contract”.</EmptyNote>
  }
  if (!report) return <EmptyNote>Checking…</EmptyNote>

  const status = STATUS_STYLE[report.status] ?? STATUS_STYLE.not_ready

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Pill label={status.label} background={status.background} color={status.color} />
        {report.uptime_seconds !== null && <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>up for {formatSeconds(report.uptime_seconds)}</span>}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {report.checks.map((check) => {
          const color = check.ok ? 'var(--color-good)' : check.critical ? 'var(--color-critical)' : '#b87a00'
          return (
            <li key={check.name} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderTop: '1px solid var(--color-border)', fontSize: 12 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color, flex: 'none', transform: 'translateY(-1px)' }} />
              <span style={{ fontWeight: 600 }}>{check.name.replace(/_/g, ' ')}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{check.ok ? 'ok' : check.critical ? 'failing (critical)' : 'failing'}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--color-text-secondary)', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>
                {check.detail ?? (check.ms !== null ? `${check.ms} ms` : '')}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
