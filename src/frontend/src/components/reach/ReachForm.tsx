import { useState } from 'react'
import type { FormEvent } from 'react'
import { TRIANGULATION_METHODS, TRIANGULATION_METHOD_LABELS } from '../../types/reach'
import type { ReachFormInput, TriangulationMethod } from '../../types/reach'
import FileDropzone from '../common/FileDropzone'

interface ReachFormProps {
  onSubmit: (input: ReachFormInput) => void
  submitting: boolean
}

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }
const inputStyle = {
  padding: '7px 9px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
}
// Reserved label height (in px) for every field in the upload-fields row
// below, so all of their boxes/selects start at the same y-offset — sized
// to fit this form's longest label ("Data sources * — .zip of submissions,
// or an Excel workbook (one sheet per source)") at up to 3 wrapped lines,
// with a little headroom. Without this, a field with a long/wrapping label
// sits lower than a sibling with a short one-line label right next to it.
const ROW_LABEL_HEIGHT = 56

export default function ReachForm({ onSubmit, submitting }: ReachFormProps) {
  const [plannedSettlementsFile, setPlannedSettlementsFile] = useState<File | null>(null)
  const [dataSourcesFile, setDataSourcesFile] = useState<File | null>(null)
  const [tracksFile, setTracksFile] = useState<File | null>(null)
  const [method, setMethod] = useState<TriangulationMethod>('BOTH')
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!plannedSettlementsFile) {
      setFormError('A planned settlements file is required.')
      return
    }
    if (!dataSourcesFile) {
      setFormError('A data sources file is required.')
      return
    }
    setFormError(null)
    onSubmit({ plannedSettlementsFile, dataSourcesFile, tracksFile, method })
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
        label="Planned settlements *"
        accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
        file={plannedSettlementsFile}
        onChange={setPlannedSettlementsFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <FileDropzone
        label="Data sources * — .zip of submissions, or an Excel workbook (one sheet per source)"
        accept=".zip,.xlsx,.xls"
        file={dataSourcesFile}
        onChange={setDataSourcesFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <FileDropzone
        label='GPS tracks (optional — only used by the "coordinates" method)'
        accept=".gpkg,.csv,.sqlite,.kml,.kmz,.zip"
        file={tracksFile}
        onChange={setTracksFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <div style={fieldStyle}>
        <label style={{ ...labelStyle, minHeight: ROW_LABEL_HEIGHT, display: 'block', boxSizing: 'border-box' }} htmlFor="method">
          Triangulation method
        </label>
        <select id="method" style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value as TriangulationMethod)}>
          {TRIANGULATION_METHODS.map((m) => (
            <option key={m} value={m}>
              {TRIANGULATION_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
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
          {submitting ? 'Processing…' : 'Run REACH analysis'}
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
