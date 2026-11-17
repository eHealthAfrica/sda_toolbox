import type { DayInfo } from '../../utils/deviceTrackingAggregate'
import { heatColor } from '../../utils/deviceTrackingAggregate'
import { AreaName, ChartCard, WindowSlider, useRowWindow } from './deviceTrackingShared'
import type { AreaProps } from './deviceTrackingShared'

export interface HeatCell {
  text: string
  t: number // 0..1, light -> dark
  title: string
}

export interface HeatRow {
  name: string
  cells: HeatCell[]
}

interface DayHeatGridProps extends AreaProps {
  title: string
  blurb: string
  csvLabel: string
  onCsv: () => void
  days: DayInfo[]
  // The day indices drawn (one column each).
  dayIdx: number[]
  rows: HeatRow[]
  // Bottom "Total" row, one text per column.
  totals?: string[]
  selDay: number | undefined
  dayOn: boolean
  onPickDay: (i: number) => void
}

// One row per area, one column per day. The day headings and every cell are
// day filters for the whole page; names drill down.
export default function DayHeatGrid({
  title,
  blurb,
  csvLabel,
  onCsv,
  days,
  dayIdx,
  rows,
  totals,
  selDay,
  dayOn,
  onPickDay,
  leaf,
  onDrill,
  resetKey,
}: DayHeatGridProps) {
  const win = useRowWindow(rows.length, resetKey)
  const shown = rows.slice(win.at, win.at + 5)
  const cols = `150px repeat(${dayIdx.length}, minmax(0, 1fr))`

  return (
    <ChartCard title={title} blurb={blurb} csvLabel={csvLabel} onCsv={onCsv}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 150 + dayIdx.length * 56, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 4, textAlign: 'center' }}>
            <span />
            {dayIdx.map((i) => {
              const picked = dayOn && selDay === i
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onPickDay(i)}
                  aria-pressed={picked}
                  title="Filter the page to this day"
                  style={{
                    border: 0,
                    borderRadius: 4,
                    padding: '3px 0',
                    fontSize: 11,
                    cursor: 'pointer',
                    background: picked ? '#17212B' : 'transparent',
                    color: picked ? '#fff' : 'var(--color-text-secondary)',
                    fontWeight: picked ? 600 : 400,
                    opacity: dayOn && !picked ? 0.28 : 1,
                  }}
                >
                  {days[i].label}
                </button>
              )
            })}
          </div>
          {shown.map((r) => (
            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: cols, gap: 4 }}>
              <AreaName name={r.name} leaf={leaf} onDrill={onDrill} />
              {r.cells.map((c, j) => {
                const i = dayIdx[j]
                const picked = dayOn && selDay === i
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onPickDay(i)}
                    title={c.title}
                    aria-label={c.title}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 34,
                      border: 0,
                      padding: 0,
                      borderRadius: 4,
                      fontSize: 12,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      cursor: 'pointer',
                      background: heatColor(c.t),
                      color: c.t > 0.55 ? '#fff' : '#17212B',
                      opacity: dayOn && !picked ? 0.28 : 1,
                      outline: picked ? '2px solid #17212B' : undefined,
                      outlineOffset: picked ? -2 : undefined,
                    }}
                  >
                    {c.text}
                  </button>
                )
              })}
            </div>
          ))}
          {rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 4px' }}>Nothing matches the current filters.</div>}
          {totals && rows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 4, borderTop: '1px solid var(--color-border)', paddingTop: 6, marginTop: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, padding: '4px 2px' }}>Total</span>
              {totals.map((t, j) => (
                <span
                  key={dayIdx[j]}
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 0',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <WindowSlider win={win} total={rows.length} />
    </ChartCard>
  )
}
