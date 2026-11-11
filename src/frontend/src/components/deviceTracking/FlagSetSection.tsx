import type { SelectionDim } from '../../types/deviceTracking'
import type { DayInfo } from '../../utils/deviceTrackingAggregate'
import { fmt } from '../../utils/deviceTrackingAggregate'
import type { FlagSetModel } from '../../utils/deviceTrackingEngine'
import { AreaName, ChartCard, ClearFilterButton, DayLabels, LegendChip, Pair, StackedTrack, WindowSlider, fadeStyle, monoStyle, useRowWindow } from './deviceTrackingShared'
import type { AreaProps, CrossFilterProps } from './deviceTrackingShared'

interface FlagSetSectionProps extends AreaProps, CrossFilterProps {
  model: FlagSetModel
  days: DayInfo[]
  scopeName: string
  dayOn: boolean
  onCsvArea: () => void
  onCsvDate: () => void
}

const COL_HEIGHT = 150

// One flag family drawn as a pair: by area (left, a stacked bar per area) and
// by date (right, a stacked column per day). The legend chips and the
// coloured parts of either chart filter the WHOLE page to that flag; the
// other categories stay in the chart, faded, for a second pick. Names drill
// down and day labels filter to a day.
export default function FlagSetSection({ model, days, scopeName, levelNoun, leaf, onDrill, resetKey, sel, onToggle, dayOn, onCsvArea, onCsvDate }: FlagSetSectionProps) {
  const { set, area, byDay, selected } = model
  const dim = set.id as SelectionDim
  const win = useRowWindow(area.length, resetKey)
  const shown = area.slice(win.at, win.at + 5)
  const maxArea = Math.max(1, ...area.map((r) => r.total))
  const maxDay = Math.max(1, ...byDay.map((d) => d.total))
  const pick = (key: string) => () => onToggle(dim, key)
  const selName = selected ? set.cats.find((c) => c.key === selected)?.name ?? '' : ''
  const cols = `repeat(${Math.max(1, byDay.length)}, minmax(0, 1fr))`

  return (
    <Pair>
      <ChartCard title={`${set.title} by ${levelNoun}`} blurb={set.blurb} csvLabel={`Download ${set.title.toLowerCase()} by ${levelNoun} as CSV`} onCsv={onCsvArea}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {set.cats.map((c) => (
            <LegendChip key={c.key} name={c.name} color={c.color} title={c.rule} pressed={selected === c.key} dim={!!selected && selected !== c.key} onClick={pick(c.key)} />
          ))}
          {selected && <ClearFilterButton onClick={pick(selected)} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map((r) => (
            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 170px) minmax(0, 1fr) 56px', gap: 12, alignItems: 'center', padding: '2px 4px' }}>
              <AreaName name={r.name} leaf={leaf} onDrill={onDrill} fontSize={13.5} />
              <StackedTrack
                width={(r.total / maxArea) * 100}
                parts={set.cats.map((c, ci) => ({
                  title: `${r.name} · ${c.name}: ${r.values[ci]}`,
                  color: c.color,
                  share: r.total ? (r.values[ci] / r.total) * 100 : 0,
                  onClick: pick(c.key),
                  fade: fadeStyle(sel[dim], c.key),
                }))}
              />
              <span style={{ fontSize: 13, textAlign: 'right', ...monoStyle }}>{fmt(r.total)}</span>
            </div>
          ))}
          {area.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 4px' }}>Nothing matches the current filters.</div>}
        </div>
        <WindowSlider win={win} total={area.length} />
      </ChartCard>

      <ChartCard
        title={`${set.title} by date`}
        blurb={selected ? `"${selName}" is filtering the whole page; the other categories stay here, faded, for a second pick.` : `Flagged team-device-days in ${scopeName}, each selected day.`}
        csvLabel={`Download ${set.title.toLowerCase()} by date as CSV`}
        onCsv={onCsvDate}
      >
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'end', height: 190, borderBottom: '1px solid #9AA5B1', padding: '0 4px' }}>
          {byDay.map((d) => (
            <div
              key={d.dayIndex}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%' }}
              title={`${days[d.dayIndex].label}: ${set.cats.map((c, ci) => `${c.name} ${d.values[ci]}`).join(', ')}`}
            >
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', ...monoStyle }}>{fmt(d.total)}</span>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', width: '70%', maxWidth: 40 }}>
                {set.cats.map((c, ci) => (
                  <button
                    key={c.key}
                    type="button"
                    className="dt-seg"
                    onClick={pick(c.key)}
                    title={`${days[d.dayIndex].label} · ${c.name}: ${d.values[ci]}`}
                    aria-label={`${days[d.dayIndex].label} · ${c.name}: ${d.values[ci]}`}
                    style={{
                      display: 'block',
                      border: 0,
                      padding: 0,
                      margin: 0,
                      cursor: 'pointer',
                      background: c.color,
                      width: '100%',
                      height: Math.round((d.values[ci] / maxDay) * COL_HEIGHT),
                      ...fadeStyle(sel[dim], c.key),
                      ...(dayOn && sel.day !== d.dayIndex ? { opacity: 0.28 } : {}),
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <DayLabels
          days={days}
          dayIdx={byDay.map((d) => d.dayIndex)}
          selDay={sel.day}
          dayOn={dayOn}
          onPick={(i) => onToggle('day', i)}
          style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '0 4px', textAlign: 'center' }}
        />
      </ChartCard>
    </Pair>
  )
}
