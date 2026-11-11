import { DEVICE_TYPES } from '../../types/deviceTracking'
import type { DeviceKind } from '../../types/deviceTracking'
import type { DayInfo } from '../../utils/deviceTrackingAggregate'
import { fmt } from '../../utils/deviceTrackingAggregate'
import type { DashboardModel } from '../../utils/deviceTrackingEngine'
import { AreaName, ChartCard, DayLabels, LegendChip, Pair, StackedTrack, WindowSlider, fadeStyle, monoStyle, useRowWindow } from './deviceTrackingShared'
import type { AreaProps, CrossFilterProps } from './deviceTrackingShared'

interface DeviceTypeSectionProps extends AreaProps, CrossFilterProps {
  types: DashboardModel['types']
  days: DayInfo[]
  scopeName: string
  dayOn: boolean
  onCsvArea: () => void
  onCsvDate: () => void
}

const COL_HEIGHT = 150

// Phones against vaccine-buddy GTS devices (IMEI starting VBU). A team carries
// one or the other. Left: devices deployed per area, most vaccine buddies
// first. Right: how many of each reported on each day. A coloured part or a
// legend item filters the whole page to that device type.
export default function DeviceTypeSection({
  types,
  days,
  scopeName,
  levelNoun,
  leaf,
  onDrill,
  resetKey,
  sel,
  onToggle,
  dayOn,
  onCsvArea,
  onCsvDate,
}: DeviceTypeSectionProps) {
  const win = useRowWindow(types.rows.length, resetKey)
  const shown = types.rows.slice(win.at, win.at + 5)
  const maxDev = Math.max(1, ...types.rows.map((r) => r.phones + r.vbs))
  const maxRep = Math.max(1, ...types.byDay.map((d) => d.phones + d.vbs))
  const pick = (k: DeviceKind) => () => onToggle('type', k)
  const count = (r: { phones: number; vbs: number }, k: DeviceKind) => (k === 'phone' ? r.phones : r.vbs)

  return (
    <Pair>
      <ChartCard
        title={`Phones vs vaccine buddies by ${levelNoun}`}
        blurb="Devices deployed by type: team phones and vaccine-buddy GTS devices (IMEI starting VBU). A team carries one or the other. Most vaccine buddies first."
        csvLabel="Download phones vs vaccine buddies as CSV"
        onCsv={onCsvArea}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {types.legend.map((l) => (
            <LegendChip key={l.key} name={`${l.name} · ${fmt(l.count)}`} color={l.color} pressed={sel.type === l.key} dim={sel.type !== undefined && sel.type !== l.key} onClick={pick(l.key)} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map((r) => {
            const tot = r.phones + r.vbs
            return (
              <div key={r.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 170px) minmax(0, 1fr) 96px', gap: 12, alignItems: 'center', padding: '2px 4px' }}>
                <AreaName name={r.name} leaf={leaf} onDrill={onDrill} fontSize={13.5} />
                <StackedTrack
                  width={(tot / maxDev) * 100}
                  parts={DEVICE_TYPES.map((t) => ({
                    title: `${r.name} · ${t.name}: ${count(r, t.key)}`,
                    color: t.color,
                    share: tot ? (count(r, t.key) / tot) * 100 : 0,
                    onClick: pick(t.key),
                    fade: fadeStyle(sel.type, t.key),
                  }))}
                />
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 12, ...monoStyle }}>
                  <span>
                    {r.phones} / {r.vbs}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{tot ? `${Math.round((r.vbs / tot) * 100)}% VB` : '–'}</span>
                </span>
              </div>
            )
          })}
          {types.rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 4px' }}>Nothing matches the current filters.</div>}
        </div>
        <WindowSlider win={win} total={types.rows.length} />
      </ChartCard>

      <ChartCard
        title="Devices reporting by type, by date"
        blurb={`Phones and vaccine buddies that sent at least one track each selected day, in ${scopeName}.`}
        csvLabel="Download devices reporting by type as CSV"
        onCsv={onCsvDate}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(1, types.byDay.length)}, minmax(0, 1fr))`,
            gap: 10,
            alignItems: 'end',
            height: 190,
            borderBottom: '1px solid #9AA5B1',
            padding: '0 4px',
          }}
        >
          {types.byDay.map((d) => (
            <div
              key={d.dayIndex}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%' }}
              title={`${days[d.dayIndex].label}: ${d.phones} phones, ${d.vbs} vaccine buddies reporting`}
            >
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', ...monoStyle }}>{fmt(d.phones + d.vbs)}</span>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', width: '70%', maxWidth: 40 }}>
                {DEVICE_TYPES.map((t) => {
                  const n = count(d, t.key)
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className="dt-seg"
                      onClick={pick(t.key)}
                      title={`${days[d.dayIndex].label} · ${t.name}: ${n}`}
                      aria-label={`${days[d.dayIndex].label} · ${t.name}: ${n}`}
                      style={{
                        display: 'block',
                        border: 0,
                        padding: 0,
                        margin: 0,
                        cursor: 'pointer',
                        background: t.color,
                        width: '100%',
                        height: Math.round((n / maxRep) * COL_HEIGHT),
                        ...fadeStyle(sel.type, t.key),
                        ...(dayOn && sel.day !== d.dayIndex ? { opacity: 0.28 } : {}),
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <DayLabels
          days={days}
          dayIdx={types.byDay.map((d) => d.dayIndex)}
          selDay={sel.day}
          dayOn={dayOn}
          onPick={(i) => onToggle('day', i)}
          style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, types.byDay.length)}, minmax(0, 1fr))`, gap: 10, padding: '0 4px', textAlign: 'center' }}
        />
      </ChartCard>
    </Pair>
  )
}
