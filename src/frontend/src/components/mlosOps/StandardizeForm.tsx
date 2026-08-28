import { useState } from 'react'
import type { FormEvent } from 'react'
import type { StandardizeFormInput } from '../../types/mlosOps'
import FileDropzone from '../common/FileDropzone'

interface StandardizeFormProps {
  onSubmit: (input: StandardizeFormInput) => void
  submitting: boolean
}

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 }

export default function StandardizeForm({ onSubmit, submitting }: StandardizeFormProps) {
  const [mlosFile, setMlosFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!mlosFile) {
      setFormError('An MLoS settlement list file is required.')
      return
    }
    setFormError(null)
    onSubmit({ mlosFile })
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
          label="Settlement list (MLoS file) *"
          accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
          file={mlosFile}
          onChange={setMlosFile}
        />
        <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
          Upload a .csv to get the before/after comparison below — other formats still run, but the client-side diff needs
          both files parsed as CSV.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
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
          {submitting ? 'Processing…' : 'Run standardization'}
        </button>
      </div>

      {formError && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>
      )}
    </form>
  )
}
