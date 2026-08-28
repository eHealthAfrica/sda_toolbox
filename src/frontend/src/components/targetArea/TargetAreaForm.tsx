import { useState } from 'react'
import type { FormEvent } from 'react'
import { TARGET_AREA_IDENTIFIERS } from '../../types/targetArea'
import type { TargetAreaFormInput, TargetAreaIdentifier } from '../../types/targetArea'
import FileDropzone from '../common/FileDropzone'

interface TargetAreaFormProps {
  onSubmit: (input: TargetAreaFormInput) => void
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

export default function TargetAreaForm({ onSubmit, submitting }: TargetAreaFormProps) {
  const [mlosFile, setMlosFile] = useState<File | null>(null)
  const [plannedListFile, setPlannedListFile] = useState<File | null>(null)
  const [identifier, setIdentifier] = useState<TargetAreaIdentifier | ''>('')
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!mlosFile) {
      setFormError('A master list of settlements (MLoS) file is required.')
      return
    }
    setFormError(null)
    onSubmit({ mlosFile, plannedListFile, identifier: identifier || null })
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
        label="Master list of settlements (MLoS) *"
        accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
        file={mlosFile}
        onChange={setMlosFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <FileDropzone
        label="Planned settlements list (optional — subsets the TA to just this list)"
        accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
        file={plannedListFile}
        onChange={setPlannedListFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <div style={fieldStyle}>
        <label style={{ ...labelStyle, minHeight: ROW_LABEL_HEIGHT, display: 'block', boxSizing: 'border-box' }} htmlFor="identifier">
          Unique identifier method <span style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <select id="identifier" style={inputStyle} value={identifier} onChange={(e) => setIdentifier(e.target.value as TargetAreaIdentifier)}>
          <option value="">Default</option>
          {TARGET_AREA_IDENTIFIERS.map((id) => (
            <option key={id} value={id}>
              {id}
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
