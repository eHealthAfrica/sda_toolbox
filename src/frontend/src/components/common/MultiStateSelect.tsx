import { useEffect, useRef, useState } from 'react'

interface MultiStateSelectProps {
  label: string
  options: readonly string[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Shown on the closed trigger when nothing is selected. */
  emptyLabel?: string
  minWidth?: number
}

const triggerStyle = {
  padding: '7px 9px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12.5,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  cursor: 'pointer',
  textAlign: 'left' as const,
}
const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.02em',
}

/**
 * A compact multi-select for picking any number of states, used wherever a
 * form needs "clip/filter to these states" rather than the app's more common
 * single-state `<select>`. No native equivalent reads well here — a native
 * `<select multiple>` needs a fixed-height listbox and ctrl/cmd-click, which
 * doesn't fit these forms' single-row layout or match how the rest of the
 * app's dropdowns behave — so this is a button that opens a checkbox panel
 * instead, closing on an outside click or Escape.
 */
export default function MultiStateSelect({ label, options, selected, onChange, emptyLabel = 'All states', minWidth = 170 }: MultiStateSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function toggle(option: string) {
    onChange(selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option])
  }

  const summary = selected.length === 0 ? emptyLabel : selected.length <= 2 ? selected.join(', ') : `${selected.length} states selected`

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 5, minWidth }}>
      <label style={labelStyle}>{label}</label>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...triggerStyle, minWidth }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected.length === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
          {summary}
        </span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 10, flex: 'none' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            width: 300,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 16px rgba(16,24,40,.12)',
            zIndex: 20,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
              {selected.length} of {options.length} selected
            </span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => onChange([...options])}
                style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                Clear
              </button>
            </div>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', padding: '6px 10px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2px 10px' }}>
            {options.map((option) => (
              <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 2px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} style={{ width: 13, height: 13, cursor: 'pointer', flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{option}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
