import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { WINDOW_SIZE } from '../../types/deviceTracking'
import type { Selection, SelectionDim } from '../../types/deviceTracking'
import type { DayInfo } from '../../utils/deviceTrackingAggregate'

// Small building blocks shared by every chart on the Team & Device Tracking
// page, so the cards, the "name drills down" buttons, the legend chips, the
// row sliders and the page-wide cross filter look and behave the same
// everywhere.

export const cardStyle: CSSProperties = {
  minWidth: 0,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-sm)',
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

export const monoStyle: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }

// What every chart that can set or show the page-wide filter is given.
export interface CrossFilterProps {
  sel: Selection
  onToggle: (dim: SelectionDim, value: Selection[SelectionDim]) => void
}

// The picked part of a chart is outlined; the other parts fade so the pick
// reads at a glance and a second one can be made. Nothing picked = no change.
// (Day and bucket indices start at 0, so compare with `undefined`.)
export function fadeStyle(current: unknown, value: unknown): CSSProperties {
  if (current === undefined) return {}
  return current === value ? { outline: '2px solid #17212B', outlineOffset: -2 } : { opacity: 0.28 }
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        margin: '8px 0 0',
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--color-text-secondary)',
      }}
    >
      {children}
    </h2>
  )
}

// Two cards side by side, stacking under 900px. Needs the matching rule in
// the page's <style> block (see DeviceTrackingPage) since inline styles can't
// carry a media query.
export function Pair({ children }: { children: ReactNode }) {
  return <div className="dt-pair">{children}</div>
}

interface ChartCardProps {
  title: string
  blurb: ReactNode
  csvLabel: string
  onCsv: () => void
  children: ReactNode
}

export function ChartCard({ title, blurb, csvLabel, onCsv, children }: ChartCardProps) {
  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{blurb}</p>
        </div>
        <CsvButton label={csvLabel} onClick={onCsv} />
      </div>
      {children}
    </section>
  )
}

export function CsvButton({ label, onClick, text = 'CSV' }: { label: string; onClick: () => void; text?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        flex: 'none',
        padding: '6px 12px',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-primary)',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {text}
    </button>
  )
}

interface AreaNameProps {
  name: string
  leaf: boolean
  onDrill: (name: string) => void
  fontSize?: number
}

// An area name that drills one level down when selected (state -> LGA ->
// ward). At ward level there is nowhere further to go, so it renders as
// plain text.
export function AreaName({ name, leaf, onDrill, fontSize = 13 }: AreaNameProps) {
  return (
    <button
      type="button"
      className="dt-areaname"
      onClick={() => onDrill(name)}
      disabled={leaf}
      title={name}
      style={{
        textAlign: 'left',
        background: 'transparent',
        border: 0,
        padding: '4px 0',
        fontSize,
        fontWeight: 500,
        color: leaf ? 'var(--color-text)' : 'var(--color-primary)',
        cursor: leaf ? 'default' : 'pointer',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}
    >
      {name}
    </button>
  )
}

interface LegendChipProps {
  name: string
  color: string
  pressed: boolean
  dim: boolean
  title?: string
  onClick: () => void
}

export function LegendChip({ name, color, pressed, dim, title, onClick }: LegendChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 28,
        padding: '0 10px',
        borderRadius: 16,
        cursor: 'pointer',
        fontSize: 12,
        border: pressed ? '1px solid var(--color-text)' : '1px solid var(--color-border)',
        background: pressed ? 'var(--color-bg)' : 'var(--color-surface)',
        color: pressed ? 'var(--color-text)' : 'var(--color-text-secondary)',
        fontWeight: pressed ? 600 : 400,
        opacity: dim ? 0.55 : 1,
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 3, background: color, flex: 'none' }} />
      {name}
    </button>
  )
}

export function ClearFilterButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        border: 0,
        background: 'transparent',
        color: 'var(--color-primary)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        textDecoration: 'underline',
      }}
    >
      Clear filter
    </button>
  )
}

// A horizontal stacked bar: one coloured button per part, sized by `share`
// (percent of the track). `width` is the track's own width as a percentage of
// its container, so bars across rows stay comparable.
export interface StackPart {
  title: string
  color: string
  share: number
  onClick: () => void
  fade?: CSSProperties
}

export function StackedTrack({ parts, width = 100 }: { parts: StackPart[]; width?: number }) {
  return (
    <span
      style={{
        display: 'flex',
        height: 16,
        borderRadius: 3,
        overflow: 'hidden',
        background: '#EEF2F6',
        width: `${Math.max(1, width)}%`,
      }}
    >
      {parts.map((p) => (
        <button
          key={p.title}
          type="button"
          className="dt-seg"
          onClick={p.onClick}
          title={p.title}
          aria-label={p.title}
          style={{ display: 'block', border: 0, padding: 0, margin: 0, cursor: 'pointer', background: p.color, height: '100%', width: `${p.share}%`, ...p.fade }}
        />
      ))}
    </span>
  )
}

// ---- days as filters -------------------------------------------------------------

// The day labels under a by-date chart (and above a heat grid) double as the
// page-wide day filter; picking the same day again clears it.
export function DayLabels({
  days,
  dayIdx,
  selDay,
  dayOn,
  onPick,
  style,
}: {
  days: DayInfo[]
  dayIdx: number[]
  selDay: number | undefined
  dayOn: boolean
  onPick: (i: number) => void
  style?: CSSProperties
}) {
  return (
    <div style={style}>
      {dayIdx.map((i) => {
        const picked = dayOn && selDay === i
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(i)}
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
  )
}

// ---- row windows --------------------------------------------------------------------

export interface RowWindow {
  at: number
  max: number
  show: boolean
  end: number
  setAt: (v: number) => void
}

// A by-area frame shows WINDOW_SIZE rows; the slider moves the window through
// the rest. It starts again from the top whenever `resetKey` changes (area,
// date range or filter moved).
export function useRowWindow(total: number, resetKey: string): RowWindow {
  const [state, setState] = useState({ key: resetKey, at: 0 })
  const max = Math.max(0, total - WINDOW_SIZE)
  const at = Math.min(state.key === resetKey ? state.at : 0, max)
  return {
    at,
    max,
    show: total > WINDOW_SIZE,
    end: Math.min(at + WINDOW_SIZE, total),
    setAt: (v) => setState({ key: resetKey, at: Math.max(0, Math.min(max, v)) }),
  }
}

const stepStyle = (off: boolean): CSSProperties => ({
  minHeight: 30,
  minWidth: 30,
  padding: '0 8px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid var(--color-border)',
  background: off ? 'var(--color-bg)' : 'var(--color-surface)',
  color: off ? 'var(--color-text-muted)' : 'var(--color-primary)',
  cursor: off ? 'default' : 'pointer',
})

export function WindowSlider({ win, total, noun = 'rows' }: { win: RowWindow; total: number; noun?: string }) {
  if (!win.show) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--color-border)', paddingTop: 10, marginTop: 'auto' }}>
      <button type="button" onClick={() => win.setAt(win.at - WINDOW_SIZE)} disabled={win.at === 0} aria-label={`Previous ${WINDOW_SIZE} ${noun}`} style={stepStyle(win.at === 0)}>
        ‹
      </button>
      <input
        type="range"
        min={0}
        max={win.max}
        step={1}
        value={win.at}
        onChange={(e) => win.setAt(Number(e.target.value))}
        aria-label={`Scroll through the ${total} ${noun}`}
        style={{ flex: 1, minWidth: 0, minHeight: 30, accentColor: '#1F5FA8', cursor: 'pointer' }}
      />
      <button type="button" onClick={() => win.setAt(win.at + WINDOW_SIZE)} disabled={win.at >= win.max} aria-label={`Next ${WINDOW_SIZE} ${noun}`} style={stepStyle(win.at >= win.max)}>
        ›
      </button>
      <span style={{ minWidth: 76, textAlign: 'right', fontSize: 12, color: 'var(--color-text-secondary)', ...monoStyle }}>
        {total ? win.at + 1 : 0}–{win.end} of {total}
      </span>
    </div>
  )
}

// What every by-area chart is given: the level it is drawn at, whether names
// can still drill down, and the key that sends its row window back to the top.
export interface AreaProps {
  levelNoun: string
  leaf: boolean
  onDrill: (name: string) => void
  resetKey: string
}
