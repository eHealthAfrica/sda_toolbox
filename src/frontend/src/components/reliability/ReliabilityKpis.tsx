import type { ReactNode } from 'react'
import type { OverallStats } from '../../types/reliability'
import { TONE_COLORS, formatMs, formatPct, formatSeconds, rateTone } from '../../utils/reliability'

interface ReliabilityKpisProps {
  overall: OverallStats
  target: number
  windowDays: number
}

function Tile({ label, value, foot, accent, children }: { label: string; value: ReactNode; foot: ReactNode; accent: string; children?: ReactNode }) {
  return (
    <div className="stat-tile" style={{ borderLeft: `3px solid ${accent}`, minWidth: 0 }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">{value}</div>
      {children}
      <div className="stat-foot">{foot}</div>
    </div>
  )
}

// A thin bar showing the success rate, with a tick at the target so "how far
// from 95%" reads without doing the sum.
function TargetBar({ rate, target, color }: { rate: number | null; target: number; color: string }) {
  return (
    <div
      role="img"
      aria-label={rate === null ? 'No success rate yet' : `Success rate ${formatPct(rate)} against a target of ${formatPct(target, 0)}`}
      style={{ position: 'relative', height: 6, borderRadius: 3, background: '#EEF2F6', margin: '6px 0 4px' }}
    >
      {rate !== null && <div style={{ width: `${Math.max(0, Math.min(1, rate)) * 100}%`, height: '100%', borderRadius: 3, background: color }} />}
      <div style={{ position: 'absolute', left: `${target * 100}%`, top: -3, bottom: -3, width: 2, background: 'var(--color-text)', opacity: 0.7 }} />
    </div>
  )
}

export default function ReliabilityKpis({ overall, target, windowDays }: ReliabilityKpisProps) {
  const tone = rateTone(overall.success_rate, target)
  const color = TONE_COLORS[tone]
  const counted = overall.completed + overall.failed_counted

  const mttrFoot =
    overall.resolved_incidents > 0
      ? `median ${formatSeconds(overall.mttr_median_seconds)} · p90 ${formatSeconds(overall.mttr_p90_seconds)} · ${overall.resolved_incidents} resolved`
      : 'no incidents resolved in this window'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
      <Tile
        label={`Success rate · last ${windowDays} days`}
        value={<span style={{ color }}>{formatPct(overall.success_rate)}</span>}
        accent={color}
        foot={
          counted > 0
            ? `target ${formatPct(target, 0)} · ${overall.completed} of ${counted} counted jobs completed`
            : `target ${formatPct(target, 0)} · no counted jobs in this window`
        }
      >
        <TargetBar rate={overall.success_rate} target={target} color={color} />
      </Tile>

      <Tile
        label="Mean time to resolve (MTTR)"
        value={formatSeconds(overall.mttr_seconds)}
        accent="var(--color-primary)"
        foot={mttrFoot}
      />

      <Tile
        label="Open incidents"
        value={overall.open_incidents}
        accent={overall.open_incidents > 0 ? 'var(--color-critical)' : 'var(--color-good)'}
        foot={overall.open_incidents > 0 ? 'still unresolved right now' : 'nothing unresolved right now'}
      />

      <Tile
        label="Job duration"
        value={formatMs(overall.p95_ms)}
        accent="var(--color-border)"
        foot={`p95 · median ${formatMs(overall.p50_ms)} · ${overall.total} jobs in window`}
      />
    </div>
  )
}
