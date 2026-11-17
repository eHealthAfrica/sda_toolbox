import { useState } from 'react'
import type { Level } from '../../utils/deviceTrackingEngine'

interface ExcelDownloadMenuProps {
  scopeName: string
  // "all 8 days", "Sat 27 Jun – Mon 29 Jun", …, and the filters in force.
  scopeLine: string
  hasState: boolean
  hasLga: boolean
  onDownload: (levels: Level[]) => void
}

const LEVELS: Array<{ key: Level; name: string; blurb: string }> = [
  { key: 'state', name: 'State summary', blurb: 'one row per state' },
  { key: 'lga', name: 'LGA summary', blurb: 'one row per LGA' },
  { key: 'ward', name: 'Ward summary', blurb: 'one row per ward' },
]

// The "Download Excel" button and the small dialog that picks which summary
// sheets go in the workbook. The summaries follow the area in view (a state
// has no state summary, only its LGAs and wards); the tracking, reporting,
// device-type, missed-day, flag and line-list sheets are always included.
export default function ExcelDownloadMenu({ scopeName, scopeLine, hasState, hasLga, onDownload }: ExcelDownloadMenuProps) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<Level[] | null>(null)

  const available = (lv: Level) => !(lv === 'state' && hasState) && !(lv === 'lga' && hasLga)
  const defaults: Level[] = hasLga ? ['ward'] : hasState ? ['lga', 'ward'] : ['state', 'lga']
  const picked = (chosen ?? defaults).filter(available)

  function toggleOpen() {
    setOpen((v) => !v)
    setChosen(null)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 40, padding: '0 16px', borderRadius: 8, border: 0, background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        Download Excel
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Excel workbook contents"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            zIndex: 30,
            width: 340,
            maxWidth: 'calc(100vw - 48px)',
            background: 'var(--color-surface)',
            border: '1px solid #C3CFDB',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(15, 41, 75, .18)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Summary sheets</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
            Every sheet covers {scopeName}, {scopeLine}.
          </div>
          {LEVELS.map((lv) => {
            const avail = available(lv.key)
            const on = avail && picked.includes(lv.key)
            return (
              <div key={lv.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 36 }}>
                <input
                  type="checkbox"
                  id={`dt-xl-${lv.key}`}
                  checked={on}
                  disabled={!avail}
                  onChange={() => setChosen(on ? picked.filter((k) => k !== lv.key) : [...picked, lv.key])}
                  style={{ width: 18, height: 18, margin: '2px 0 0', accentColor: '#1F5FA8' }}
                />
                <label htmlFor={`dt-xl-${lv.key}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13.5, cursor: avail ? 'pointer' : 'default', opacity: avail ? 1 : 0.6 }}>
                  <span style={{ fontWeight: 600 }}>{lv.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{avail ? lv.blurb : `not available inside ${scopeName}`}</span>
                </label>
              </div>
            )
          })}
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
            Always included: daily tracks, device reporting, device types, missed work days, flags by date, invalid team codes, code–device conflicts.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={toggleOpen} style={{ minHeight: 34, padding: '0 12px', border: '1px solid #C3CFDB', background: '#fff', color: '#1F5FA8', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => {
                onDownload(LEVELS.map((l) => l.key).filter((k) => picked.includes(k)))
                setOpen(false)
                setChosen(null)
              }}
              style={{ minHeight: 34, padding: '0 14px', border: 0, background: picked.length ? '#1F5FA8' : '#9AA5B1', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: picked.length ? 'pointer' : 'default' }}
            >
              Download
            </button>
          </div>
          {picked.length === 0 && <div style={{ fontSize: 12, color: '#8A3B06' }}>Pick at least one summary level.</div>}
        </div>
      )}
    </div>
  )
}
