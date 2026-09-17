import StatCard from '../common/StatCard'
import type { SourceStats } from '../../utils/coordinateReviewAggregate'

// Fixed categorical palette, assigned by each source's position in the
// detected list — stable across re-renders and shared by every component
// that needs to color a source consistently (the chips here, the evidence
// column headers, AgreementDiagram's dots).
const SOURCE_PALETTE = ['#4f5fe8', '#0f9d9d', '#a349a4', '#c07a1f', '#4a8f3c', '#c23c6b']

export function sourceColor(sourceNames: string[], source: string): string {
  const idx = sourceNames.indexOf(source)
  return SOURCE_PALETTE[idx >= 0 ? idx % SOURCE_PALETTE.length : 0]
}

interface CoordinateReviewSourcePanelProps {
  sourceNames: string[]
  activeSources: Set<string>
  onToggleSource: (source: string) => void
  statsBySource: Record<string, SourceStats>
}

// Multi-select source picker + per-source context cards. Every detected
// source always counts toward the agreement analysis regardless of what's
// toggled here — this only controls which sources' evidence columns show in
// the results table below, so an analyst can narrow a wide table down to
// just the sources they're currently comparing.
export default function CoordinateReviewSourcePanel({
  sourceNames,
  activeSources,
  onToggleSource,
  statsBySource,
}: CoordinateReviewSourcePanelProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 20,
        marginBottom: 24,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        Sources detected: {sourceNames.length}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2, marginBottom: 12 }}>
        All detected sources always count toward the agreement analysis below — this only toggles which sources show
        their evidence columns in the table.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {sourceNames.map((source) => {
          const active = activeSources.has(source)
          const color = sourceColor(sourceNames, source)
          return (
            <button
              key={source}
              type="button"
              onClick={() => onToggleSource(source)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: `1.5px solid ${active ? color : 'var(--color-border)'}`,
                background: active ? `${color}1a` : 'var(--color-bg)',
                color: active ? color : 'var(--color-text-muted)',
                borderRadius: 999,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, opacity: active ? 1 : 0.4 }} />
              {source}
            </button>
          )
        })}
      </div>

      {activeSources.size === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Select at least one source above to see its breakdown.</div>
      ) : (
        sourceNames
          .filter((s) => activeSources.has(s))
          .map((source) => {
            const stats = statsBySource[source]
            if (!stats) return null
            return (
              <div key={source} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: sourceColor(sourceNames, source) }} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{source}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <StatCard label="Match rate" value={`${stats.matchRate}%`} />
                  <StatCard label="Avg. distance to original" value={stats.avgDistance !== null ? `${stats.avgDistance}m` : '—'} />
                  <StatCard label="GRID3 pass rate" value={stats.grid3Rate !== null ? `${stats.grid3Rate}%` : '—'} />
                  <StatCard label="Near-tracks rate" value={stats.tracksRate !== null ? `${stats.tracksRate}%` : '—'} />
                </div>
              </div>
            )
          })
      )}
    </div>
  )
}
