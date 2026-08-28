import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'

interface FileDropzoneProps {
  label: string
  // Optional short helper line rendered under the label, in a lighter
  // weight/case than the label itself — for a supporting detail (accepted
  // formats, a structural requirement) that would otherwise bloat the label
  // into a multi-line wall of uppercase text. Keeping the label itself short
  // is what keeps a row of dropzones lined up cleanly.
  hint?: string
  accept: string
  file: File | null
  onChange: (file: File | null) => void
  // Opt-in width-basis flex sizing for the specific case where this
  // component sits as a DIRECT CHILD of a ROW-direction flex container
  // (e.g. `{ display: 'flex', gap, flexWrap: 'wrap' }`) alongside other
  // fields, and should grow/shrink to help fill that row — see the long
  // comment on the root div below for why this must default to *off*.
  fillWidth?: boolean
  // Reserves this much height for the label(+hint) block above the dropzone
  // box, so the box itself starts at the same y-offset as its siblings in
  // the same form row regardless of how many lines THIS field's own label
  // happens to wrap to — without it, a field with a long label/hint (e.g.
  // REACH's "Data sources" field) pushes its dropzone box down relative to
  // a field with a short one-line label sitting right next to it. Left
  // unset (the default) for any existing caller that isn't part of a
  // shared-row layout, so this never changes behavior it wasn't asked to.
  labelMinHeight?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Click-to-choose + drag-and-drop file field, matching the dropzone pattern
// already established in the mockup.html design (.dropzone — dashed border,
// highlights on drag-over, "Choose a file or drag it here") but wired up as a
// real interactive control rather than static markup: a hidden native
// <input type="file"> handles the click-to-choose path (so this stays a real
// file input for form semantics/accessibility), while onDragOver/onDrop
// handle the drag path. Once a file is picked, a summary row appears below
// with its name/size and a remove (✕) button — the dropzone itself stays
// visible underneath so dropping a replacement file works at any time.
export default function FileDropzone({ label, hint, accept, file, onChange, fillWidth = false, labelMinHeight }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.files?.[0] ?? null)
    // Reset so choosing the same file again (e.g. after removing it) still fires onChange.
    e.target.value = ''
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) onChange(dropped)
  }

  // `flex: '1 1 240px'` is a WIDTH-basis pattern — it only means what it
  // looks like ("grow/shrink from a 240px-wide starting point") when this
  // div is a direct child of a ROW-direction flex container. `flex-basis`
  // (and flex-grow/shrink) resolve along the flex container's MAIN axis,
  // not literally "width": inside a COLUMN-direction flex container (e.g.
  // a field wrapper that stacks this dropzone above a hint/warning line)
  // the exact same style makes this box 240px *tall* instead. As a direct
  // CSS Grid item, `flex-*` is ignored entirely, so it's a no-op there
  // either way. Only apply it when a caller explicitly confirms it's
  // sitting in a row-flex context via `fillWidth` — everywhere else, a
  // plain `width: 100%` gives the same "fill the available column/cell"
  // result without ever being reinterpreted as a height.
  const rootStyle = fillWidth
    ? { display: 'flex' as const, flexDirection: 'column' as const, gap: 5, minWidth: 240, flex: '1 1 240px' }
    : { display: 'flex' as const, flexDirection: 'column' as const, gap: 5, minWidth: 240, width: '100%' }

  return (
    <div style={rootStyle}>
      <div style={{ minHeight: labelMinHeight, boxSizing: 'border-box' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          {label}
        </label>
        {hint && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{hint}</div>
        )}
      </div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        style={{
          border: `1.5px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '18px 14px',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: 12,
          background: dragOver ? '#f7faff' : 'var(--color-surface)',
          cursor: 'pointer',
        }}
      >
        <input ref={inputRef} type="file" accept={accept} onChange={handleInputChange} style={{ display: 'none' }} />
        <div>
          <b style={{ color: 'var(--color-primary)' }}>Choose a file</b> or drag it here
        </div>
      </div>
      {file && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-md)',
            padding: '7px 10px',
            fontSize: 11.5,
          }}
        >
          <span>
            📄 {file.name} <span style={{ color: 'var(--color-text-muted)' }}>— {formatBytes(file.size)}</span>
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
            style={{ color: 'var(--color-text-muted)', cursor: 'pointer' }}
            role="button"
            aria-label={`Remove ${file.name}`}
          >
            ✕
          </span>
        </div>
      )}
    </div>
  )
}
