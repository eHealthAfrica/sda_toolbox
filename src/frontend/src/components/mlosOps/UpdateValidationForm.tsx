import { useState } from 'react'
import type { FormEvent } from 'react'
import { POLICY_OPTIONS } from '../../types/mlosOps'
import type { PolicyOption, UpdateValidationFormInput } from '../../types/mlosOps'
import FileDropzone from '../common/FileDropzone'
import MultiFileDropzone from '../common/MultiFileDropzone'

interface UpdateValidationFormProps {
  onSubmit: (input: UpdateValidationFormInput) => void
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
// Reserved label height (in px), shared by every field in the row below, so
// their boxes/selects all start at the same y-offset regardless of which
// one's own label happens to wrap onto more lines — see the matching
// comment on FileDropzone's labelMinHeight prop.
const ROW_LABEL_HEIGHT = 56

export default function UpdateValidationForm({ onSubmit, submitting }: UpdateValidationFormProps) {
  const [mlosFile, setMlosFile] = useState<File | null>(null)
  const [lgaValidationFiles, setLgaValidationFiles] = useState<File[]>([])
  const [purpose, setPurpose] = useState<PolicyOption | ''>('')
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!mlosFile) {
      setFormError('An MLoS file is required.')
      return
    }
    if (lgaValidationFiles.length === 0) {
      setFormError('At least one LGA validation file (CSV or Excel workbook) is required.')
      return
    }
    if (!purpose) {
      setFormError('A purpose is required — it picks which attribute-remapping table the update pulls from.')
      return
    }
    setFormError(null)
    onSubmit({ mlosFile, lgaValidationFiles, purpose })
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
      <div style={fieldStyle}>
        <FileDropzone
          label="MLoS file *"
          accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
          file={mlosFile}
          onChange={setMlosFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
        />
        <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
          Upload a .csv to get the before/after comparison below.
        </div>
      </div>

      <MultiFileDropzone
        label="LGA validation files * — one or more CSV/Excel files, one sheet/file per LGA"
        accept=".csv,.xlsx"
        files={lgaValidationFiles}
        onChange={setLgaValidationFiles}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <div style={fieldStyle}>
        <label
          style={{ ...labelStyle, minHeight: ROW_LABEL_HEIGHT, display: 'block', boxSizing: 'border-box' }}
          htmlFor="update_purpose"
        >
          Purpose *
        </label>
        <select id="update_purpose" style={inputStyle} value={purpose} onChange={(e) => setPurpose(e.target.value as PolicyOption)}>
          <option value="">Select a purpose…</option>
          {POLICY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
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
          {submitting ? 'Processing…' : 'Run update'}
        </button>
      </div>

      {formError && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>
      )}
    </form>
  )
}
