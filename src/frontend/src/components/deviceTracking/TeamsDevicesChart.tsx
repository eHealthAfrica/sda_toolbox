import type { TeamsDevicesRow } from '../../utils/deviceTrackingEngine'
import { AreaName, ChartCard, WindowSlider, monoStyle, useRowWindow } from './deviceTrackingShared'
import type { AreaProps } from './deviceTrackingShared'

interface TeamsDevicesChartProps extends AreaProps {
  rows: TeamsDevicesRow[]
  onCsv: () => void
}

const TEAM_COLOR = '#1F5FA8'
const DEVICE_COLOR = '#9CC2EC'

function gapLabel(gap: number): string {
  return gap === 0 ? '±0' : gap > 0 ? `+${gap}` : String(gap)
}

// Paired bars per area: distinct team codes (dark) against distinct devices
// (light). The badge is devices minus teams — orange when an area has fewer
// devices than teams, i.e. a team with nothing to track on.
export default function TeamsDevicesChart({ rows, levelNoun, leaf, onDrill, resetKey, onCsv }: TeamsDevicesChartProps) {
  const win = useRowWindow(rows.length, resetKey)
  const shown = rows.slice(win.at, win.at + 5)
  const max = Math.max(1, ...rows.map((r) => Math.max(r.teams, r.devices)))
  const bar = (v: number, color: string) => (
    <span style={{ display: 'block', height: 10, borderRadius: 3, background: color, width: `${Math.max(2, (v / max) * 100)}%` }} />
  )

  return (
    <ChartCard
      title={`Teams vs devices by ${levelNoun}`}
      blurb="Distinct team codes and distinct devices (IMEI) that sent tracks. Select a name to drill down."
      csvLabel="Download teams vs devices as CSV"
      onCsv={onCsv}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: TEAM_COLOR }} />
          Teams
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: DEVICE_COLOR }} />
          Devices
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ padding: '0 5px', borderRadius: 4, background: '#FCE8D5', color: '#8A3B06', fontWeight: 600 }}>−1</span>
          fewer devices than teams
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((r) => {
          const gap = r.devices - r.teams
          return (
            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 170px) minmax(0, 1fr) 64px', gap: 12, alignItems: 'center', padding: 4 }}>
              <AreaName name={r.name} leaf={leaf} onDrill={onDrill} fontSize={13.5} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {bar(r.teams, TEAM_COLOR)}
                  <span style={{ fontSize: 12, ...monoStyle }}>{r.teams}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {bar(r.devices, DEVICE_COLOR)}
                  <span style={{ fontSize: 12, ...monoStyle }}>{r.devices}</span>
                </span>
              </span>
              <span
                style={{
                  justifySelf: 'end',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 4,
                  ...monoStyle,
                  ...(gap < 0 ? { background: '#FCE8D5', color: '#8A3B06' } : { background: '#EEF2F6', color: 'var(--color-text-secondary)' }),
                }}
                title={gap < 0 ? `${-gap} fewer ${-gap === 1 ? 'device' : 'devices'} than teams` : gap > 0 ? `${gap} more ${gap === 1 ? 'device' : 'devices'} than teams` : 'As many devices as teams'}
              >
                {gapLabel(gap)}
              </span>
            </div>
          )
        })}
        {rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 4px' }}>Nothing matches the current filters.</div>}
      </div>
      <WindowSlider win={win} total={rows.length} />
    </ChartCard>
  )
}
