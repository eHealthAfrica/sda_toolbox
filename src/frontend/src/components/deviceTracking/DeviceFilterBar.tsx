import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DayInfo } from '../../utils/deviceTrackingAggregate'
import type { Scope } from '../../utils/deviceTrackingEngine'

interface DeviceFilterBarProps {
  stateOptions: string[]
  lgaOptions: string[]
  wardOptions: string[]
  scope: Scope
  onScopeChange: (scope: Scope) => void
  // Every day in the result, and the selected range as indices into it.
  days: DayInfo[]
  from: number
  to: number
  onRangeChange: (from: number, to: number) => void
  onReset: () => void
  rangeLabel: string
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

interface MonthDef {
  title: string
  // 0 = Monday
  firstWeekday: number
  length: number
  // day of month -> index into `days`
  indexByDay: Map<number, number>
}

function buildMonths(days: DayInfo[]): MonthDef[] {
  const byMonth = new Map<string, MonthDef>()
  days.forEach((d, i) => {
    const [y, m, dd] = d.key.split('-').map(Number)
    const key = `${y}-${m}`
    let month = byMonth.get(key)
    if (!month) {
      month = {
        title: `${MONTHS_LONG[m - 1]} ${y}`,
        firstWeekday: (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7,
        length: new Date(Date.UTC(y, m, 0)).getUTCDate(),
        indexByDay: new Map(),
      }
      byMonth.set(key, month)
    }
    month.indexByDay.set(dd, i)
  })
  return Array.from(byMonth.values())
}

const selectStyle: CSSProperties = {
  minHeight: 40,
  minWidth: 180,
  padding: '0 10px',
  border: '1px solid #3F5F80',
  borderRadius: 8,
  background: '#fff',
  color: '#17212B',
  fontSize: 13,
}
const darkLabel: CSSProperties = { fontSize: 12, color: '#B9CBE0' }
const lightButton: CSSProperties = {
  minHeight: 40,
  padding: '0 14px',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

// The area filters (state / LGA / ward, dark bar) and the date-range picker
// (white bar) of the page. Every chart, list and download follows both. The
// calendar only lets you pick days that are in the result; the first click
// sets the start, the second the end.
export default function DeviceFilterBar({ stateOptions, lgaOptions, wardOptions, scope, onScopeChange, days, from, to, onRangeChange, onReset, rangeLabel }: DeviceFilterBarProps) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<number | null>(null)
  const months = useMemo(() => buildMonths(days), [days])

  const a = Math.min(from, to)
  const b = Math.max(from, to)
  const buttonLabel = days.length === 0 ? '—' : a === b ? days[a].long : `${days[a].long} – ${days[b].long}`

  function pickDay(i: number) {
    if (anchor === null) {
      onRangeChange(i, i)
      setAnchor(i)
    } else {
      onRangeChange(Math.min(anchor, i), Math.max(anchor, i))
      setAnchor(null)
    }
  }

  function cellStyle(inData: boolean, i: number): CSSProperties {
    const base: CSSProperties = { height: 36, borderRadius: 8, fontSize: 13, padding: 0 }
    if (!inData) return { ...base, border: 0, background: 'transparent', color: 'var(--color-text-muted)', cursor: 'default', opacity: 0.5 }
    const selected = i >= a && i <= b
    const edge = i === a || i === b || anchor === i
    if (edge) return { ...base, border: 0, background: '#1F5FA8', color: '#fff', fontWeight: 600, cursor: 'pointer' }
    if (selected) return { ...base, border: 0, background: '#C9DCF2', color: '#17212B', cursor: 'pointer' }
    return { ...base, border: '1px solid #C3CFDB', background: '#E4ECF5', color: '#17212B', cursor: 'pointer' }
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, background: '#17324F', borderRadius: 10, padding: '12px 16px', color: '#fff' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 8 }}>
          <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#B9CBE0' }}>Area filters</span>
          <span style={{ fontSize: 12, color: '#DCE6F1' }}>Every chart, list and download follows them</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor="dt-state" style={darkLabel}>
            State
          </label>
          <select id="dt-state" value={scope.state ?? ''} onChange={(e) => onScopeChange({ state: e.target.value || null, lga: null, ward: null })} style={selectStyle}>
            <option value="">All states</option>
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor="dt-lga" style={darkLabel}>
            LGA
          </label>
          <select id="dt-lga" value={scope.lga ?? ''} disabled={!scope.state} onChange={(e) => onScopeChange({ state: scope.state, lga: e.target.value || null, ward: null })} style={{ ...selectStyle, opacity: scope.state ? 1 : 0.6 }}>
            <option value="">{scope.state ? 'All LGAs' : 'Pick a state first'}</option>
            {lgaOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor="dt-ward" style={darkLabel}>
            Ward
          </label>
          <select id="dt-ward" value={scope.ward ?? ''} disabled={!scope.lga} onChange={(e) => onScopeChange({ ...scope, ward: e.target.value || null })} style={{ ...selectStyle, opacity: scope.lga ? 1 : 0.6 }}>
            <option value="">{scope.lga ? 'All wards' : 'Pick an LGA first'}</option>
            {wardOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
          <span id="dt-dates-label" style={{ fontSize: 12, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Dates
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v)
              setAnchor(null)
            }}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-labelledby="dt-dates-label"
            disabled={days.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 40, minWidth: 260, padding: '0 12px', border: '1px solid #C3CFDB', borderRadius: 8, background: '#fff', color: '#17212B', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
          >
            <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1F5FA8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 10h18" />
            </svg>
            <span style={{ flex: 1 }}>{buttonLabel}</span>
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#52606D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {open && (
            <div
              role="dialog"
              aria-label="Choose a date range"
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 6,
                zIndex: 30,
                background: '#fff',
                border: '1px solid #C3CFDB',
                borderRadius: 12,
                boxShadow: '0 12px 32px rgba(15, 41, 75, .18)',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                width: 'max-content',
                maxWidth: 'calc(100vw - 48px)',
              }}
            >
              <div style={{ fontSize: 13, color: '#3E4C59' }}>
                {anchor !== null
                  ? `Start: ${days[anchor].long}. Now pick the last day (or the same day again for one day).`
                  : 'Pick the first day, then the last. Only days in the result can be chosen.'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
                {months.map((m) => (
                  <div key={m.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, textAlign: 'center', color: '#17212B' }}>{m.title}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 38px)', gap: 2, fontSize: 11, color: '#52606D', textAlign: 'center' }}>
                      {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                        <span key={d}>{d}</span>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 38px)', gap: 2 }}>
                      {Array.from({ length: m.firstWeekday }, (_, k) => (
                        <span key={`pad-${k}`} />
                      ))}
                      {Array.from({ length: m.length }, (_, k) => {
                        const dayNum = k + 1
                        const i = m.indexByDay.get(dayNum)
                        const inData = i !== undefined
                        return (
                          <button
                            key={dayNum}
                            type="button"
                            disabled={!inData}
                            onClick={() => inData && pickDay(i)}
                            aria-pressed={inData ? i >= a && i <= b : undefined}
                            aria-label={inData ? `${days[i].long}${i >= a && i <= b ? ', selected' : ''}` : `${dayNum} ${m.title}, not in the result`}
                            style={cellStyle(inData, i ?? -1)}
                          >
                            {dayNum}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#52606D' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: '#1F5FA8' }} />
                    Selected
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: '#E4ECF5', border: '1px solid #C3CFDB' }} />
                    Day in the result
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      onRangeChange(0, days.length - 1)
                      setAnchor(null)
                    }}
                    style={{ ...lightButton, minHeight: 36, background: '#fff', borderColor: '#C3CFDB' }}
                  >
                    All days
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      setAnchor(null)
                    }}
                    style={{ minHeight: 36, padding: '0 14px', border: 0, background: '#1F5FA8', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <button type="button" onClick={onReset} style={lightButton}>
          Reset all
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--color-text-secondary)' }}>{rangeLabel}</div>
      </div>
    </>
  )
}
