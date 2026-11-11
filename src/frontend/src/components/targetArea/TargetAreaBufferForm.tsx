import { useState } from 'react'
import type { FormEvent } from 'react'
import { BUFFER_DISTANCE_DEFAULT, BUFFER_DISTANCE_MAX, BUFFER_DISTANCE_MIN } from '../../types/targetArea'
import type { BufferTargetAreaFormInput } from '../../types/targetArea'
import FileDropzone from '../common/FileDropzone'

interface TargetAreaBufferFormProps {
  onSubmit: (input: BufferTargetAreaFormInput) => void
  submitting: boolean
}

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }
// Same reserved label height as TargetAreaForm's ROW_LABEL_HEIGHT, so the
// dropzone and the slider start at the same y-offset in the row below
// regardless of how many lines either field's own label wraps to.
const ROW_LABEL_HEIGHT = 56

export default function TargetAreaBufferForm({ onSubmit, submitting }: TargetAreaBufferFormProps) {
  const [plannedSettlementListFile, setPlannedSettlementListFile] = useState<File | null>(null)
  const [bufferDistance, setBufferDistance] = useState(BUFFER_DISTANCE_DEFAULT)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!plannedSettlementListFile) {
      setFormError('A planned settlement list file is required.')
      return
    }
    setFormError(null)
    onSubmit({ plannedSettlementListFile, bufferDistance })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 20,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 24,
        marginBottom: 24,
      }}
    >
      <FileDropzone
        label="Planned settlement list *"
        accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
        file={plannedSettlementListFile}
        onChange={setPlannedSettlementListFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <div style={fieldStyle}>
        <label style={{ ...labelStyle, minHeight: ROW_LABEL_HEIGHT, display: 'block', boxSizing: 'border-box' }} htmlFor="buffer-distance">
          Buffer distance <span style={{ fontWeight: 400, color: 'var(--color-text)' }}>{bufferDistance}m</span>
        </label>
        <input
          id="buffer-distance"
          type="range"
          min={BUFFER_DISTANCE_MIN}
          max={BUFFER_DISTANCE_MAX}
          step={10}
          value={bufferDistance}
          onChange={(e) => setBufferDistance(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--color-primary)' }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10.5,
            color: 'var(--color-text-muted)',
          }}
        >
          <span>{BUFFER_DISTANCE_MIN}m</span>
          <span>{BUFFER_DISTANCE_MAX}m</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gridColumn: '1 / -1' }}>
        <button
          type="submit"
          disabled={submitting}
          style={{
            background: submitting ? 'var(--color-text-muted)' : 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '9px 20px',
            fontSize: 13,
            fontWeight: 600,
            cursor: submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? 'Processing…' : 'Generate target area'}
        </button>
      </div>

      {formError && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-critical)', fontSize: 12 }}>
          {formError}
        </div>
      )}
    </form>
  )
}
