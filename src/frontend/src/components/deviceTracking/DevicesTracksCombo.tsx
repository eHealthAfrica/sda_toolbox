import { fmt, k1 } from '../../utils/deviceTrackingAggregate'
import type { ComboRow, ThresholdInfo } from '../../utils/deviceTrackingEngine'
import { ChartCard, WindowSlider, monoStyle, useRowWindow } from './deviceTrackingShared'
import type { AreaProps } from './deviceTrackingShared'

interface DevicesTracksComboProps extends AreaProps {
  rows: ComboRow[]
  maxDevices: number
  maxTracks: number
  threshold: ThresholdInfo
  scopeName: string
  onCsv: () => void
}

const HEIGHT = 230

// Columns: devices deployed per area. Line: tracks. An area is orange when its
// tracks per device-day fall under the threshold — the area in view's own
// average, less one standard deviation across its sub-areas. The threshold is
// recalculated for every area, date range and filter.
export default function DevicesTracksCombo({ rows, maxDevices, maxTracks, threshold, scopeName, levelNoun, leaf, onDrill, resetKey, onCsv }: DevicesTracksComboProps) {
  const win = useRowWindow(rows.length, resetKey)
  const shown = rows.slice(win.at, win.at + 5)
  const n = Math.max(1, shown.length)
  const yLine = (tr: number) => 100 - (tr / maxTracks) * 88
  const points = shown.map((c, i) => `${(((i + 0.5) / n) * 100).toFixed(2)},${yLine(c.tracks).toFixed(2)}`).join(' ')
  const gridCols = `repeat(${n}, minmax(0, 1fr))`

  return (
    <ChartCard
      title={`Devices deployed and tracks by ${levelNoun}`}
      blurb={`Columns: devices deployed. Line: tracks. Orange = below the threshold of ${fmt(threshold.threshold)} tracks per device-day: ${scopeName}'s average of ${fmt(threshold.average)}, less a tolerance of ${fmt(threshold.tolerance)} (one standard deviation across its ${levelNoun}s). Both are recalculated for every area, date range and filter.`}
      csvLabel="Download devices deployed and tracks as CSV"
      onCsv={onCsv}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: '#9CC2EC' }} />
          Devices deployed
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg aria-hidden width="22" height="12" viewBox="0 0 22 12">
            <path d="M1 6h20" stroke="#17212B" strokeWidth="2" />
            <circle cx="11" cy="6" r="4" fill="#17212B" stroke="#fff" strokeWidth="1.5" />
          </svg>
          Tracks
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: '#E07B24', boxShadow: 'inset 0 0 0 2px #8A3B06' }} />
          Below threshold
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: HEIGHT, fontSize: 11, color: 'var(--color-text-secondary)', textAlign: 'right', minWidth: 28 }}>
          <span>{fmt(maxDevices)}</span>
          <span>Devices</span>
          <span>0</span>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              position: 'relative',
              height: HEIGHT,
              borderLeft: '1px solid #9AA5B1',
              borderRight: '1px solid #9AA5B1',
              borderBottom: '1px solid #9AA5B1',
              background: 'linear-gradient(#EEF2F6 1px, transparent 1px) 0 0 / 100% 25%',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 8, position: 'absolute', inset: 0, alignItems: 'end', padding: '0 4px' }}>
              {shown.map((c) => {
                const title = `${c.name}: ${c.devices} devices, ${fmt(c.tracks)} tracks, ${fmt(c.perDeviceDay)} per device-day against ${fmt(threshold.threshold)}${c.low ? ' (below threshold)' : ''}`
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => onDrill(c.name)}
                    disabled={leaf}
                    title={title}
                    aria-label={title}
                    style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', height: '100%', background: 'transparent', border: 0, padding: 0, cursor: leaf ? 'default' : 'pointer' }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: '56%',
                        maxWidth: 64,
                        borderRadius: '4px 4px 0 0',
                        height: `${Math.max(2, (c.devices / maxDevices) * 88)}%`,
                        background: c.low ? '#E07B24' : '#9CC2EC',
                        boxShadow: c.low ? 'inset 0 0 0 2px #8A3B06' : undefined,
                      }}
                    />
                  </button>
                )
              })}
            </div>
            {shown.length > 0 && (
              <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                <polyline points={points} fill="none" stroke="#17212B" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            {shown.map((c, i) => (
              <span key={c.name}>
                <span
                  title={`${c.name}: ${fmt(c.tracks)} tracks`}
                  style={{
                    position: 'absolute',
                    left: `${((i + 0.5) / n) * 100}%`,
                    top: `${yLine(c.tracks)}%`,
                    width: 10,
                    height: 10,
                    margin: '-5px 0 0 -5px',
                    borderRadius: '50%',
                    border: '2px solid #fff',
                    boxShadow: '0 0 0 1px #17212B',
                    background: c.low ? '#8A3B06' : '#17212B',
                    pointerEvents: 'none',
                  }}
                />
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: `${((i + 0.5) / n) * 100}%`,
                    top: `${yLine(c.tracks)}%`,
                    transform: 'translate(-50%,-22px)',
                    fontSize: 11,
                    color: '#17212B',
                    background: 'rgba(255,255,255,.85)',
                    padding: '0 3px',
                    borderRadius: 3,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    ...monoStyle,
                  }}
                >
                  {k1(c.tracks)}
                </span>
              </span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 8, padding: '0 4px' }}>
            {shown.map((c) => (
              <div key={c.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0, textAlign: 'center' }}>
                <button
                  type="button"
                  className="dt-areaname"
                  onClick={() => onDrill(c.name)}
                  disabled={leaf}
                  title={c.name}
                  style={{
                    maxWidth: '100%',
                    background: 'transparent',
                    border: 0,
                    padding: '2px 0',
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: leaf ? 'var(--color-text)' : 'var(--color-primary)',
                    cursor: leaf ? 'default' : 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </button>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{c.devices} devices</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 4,
                    ...monoStyle,
                    ...(c.low ? { background: '#FCE8D5', color: '#8A3B06', fontWeight: 600 } : { color: 'var(--color-text-secondary)' }),
                  }}
                >
                  {fmt(c.perDeviceDay)} / device-day
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: HEIGHT, fontSize: 11, color: 'var(--color-text-secondary)', minWidth: 32 }}>
          <span>{k1(maxTracks)}</span>
          <span>Tracks</span>
          <span>0</span>
        </div>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Nothing matches the current filters.</div>}
      <WindowSlider win={win} total={rows.length} noun="areas" />
    </ChartCard>
  )
}
