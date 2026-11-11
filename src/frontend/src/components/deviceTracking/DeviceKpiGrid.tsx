import type { Kpi } from '../../utils/deviceTrackingEngine'
import { monoStyle } from './deviceTrackingShared'

// The headline numbers for the area, dates and filters in view. The tracks per
// device-day card turns orange when any area is under the threshold, and
// draws the day-by-day trend of that ratio.
export default function DeviceKpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
      {kpis.map((k) => (
        <div
          key={k.label}
          style={{
            background: k.accent ? '#FFF8F1' : 'var(--color-surface)',
            border: `1px solid ${k.accent ? '#E07B24' : 'var(--color-border)'}`,
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</div>
          <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', ...monoStyle }}>{k.value}</div>
          <div style={{ fontSize: 12, color: k.accent ? '#8A3B06' : 'var(--color-text-secondary)', fontWeight: k.accent ? 600 : 400 }}>{k.sub}</div>
          {k.spark && (
            <>
              <svg role="img" aria-label={k.spark.text} viewBox="0 0 100 24" preserveAspectRatio="none" style={{ width: '100%', height: 24, marginTop: 4, overflow: 'visible' }}>
                <polyline points={k.spark.points} fill="none" stroke="#8A3B06" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              </svg>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', ...monoStyle }}>{k.spark.text}</div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
