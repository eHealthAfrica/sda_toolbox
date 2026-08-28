import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'

interface MultiFileDropzoneProps {
  label: string
  accept: string
  files: File[]
  onChange: (files: File[]) => void
  // See the matching prop on FileDropzone (common/FileDropzone.tsx) — same
  // opt-in for a direct-child-of-row-flex sizing context.
  fillWidth?: boolean
  // See the matching prop on FileDropzone — reserves height for the label
  // block so this field's dropzone box lines up with its row siblings'
  // regardless of how many lines its own label wraps to. Unset by default.
  labelMinHeight?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Multi-file sibling of FileDropzone (common/FileDropzone.tsx) — same
// click-to-choose + drag-and-drop dropzone, but for the one form
// (UpdateValidationForm's "LGA validation files") that takes several files
// at once via a native <input multiple>. Kept as a separate component
// rather than adding a `multiple` mode to FileDropzone itself, since that
// would change the prop contract (file → files, onChange signature) for
// every existing single-file consumer of that component.
export default function MultiFileDropzone({ label, accept, files, onChange, fillWidth = false, labelMinHeight }: MultiFileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    onChange([...files, ...Array.from(e.target.files ?? [])])
    // Reset so choosing the same file(s) again still fires onChange.
    e.target.value = ''
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length > 0) onChange([...files, ...dropped])
  }

  function removeAt(index: number) {
    onChange(files.filter((_, i) => i !== index))
  }

  // See FileDropzone.tsx (common/FileDropzone.tsx) for why this must
  // default to a plain `width: 100%` rather than `flex: '1 1 240px'` — the
  // latter resolves as a HEIGHT basis (240px tall) when this component is
  // wrapped in a column-direction flex container instead of sitting as a
  // direct child of a row-direction one.
  const rootStyle = fillWidth
    ? { display: 'flex' as const, flexDirection: 'column' as const, gap: 5, minWidth: 240, flex: '1 1 240px' }
    : { display: 'flex' as const, flexDirection: 'column' as const, gap: 5, minWidth: 240, width: '100%' }

  return (
    <div style={rootStyle}>
      <label
        style={{
          display: 'block',
          minHeight: labelMinHeight,
          boxSizing: 'border-box',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </label>
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
        <input ref={inputRef} type="file" multiple accept={accept} onChange={handleInputChange} style={{ display: 'none' }} />
        <div>
          <b style={{ color: 'var(--color-primary)' }}>Choose files</b> or drag them here
        </div>
      </div>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
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
                  removeAt(i)
                }}
                style={{ color: 'var(--color-text-muted)', cursor: 'pointer' }}
                role="button"
                aria-label={`Remove ${file.name}`}
              >
                ✕
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
