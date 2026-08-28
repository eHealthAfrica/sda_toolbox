import { useState } from 'react'
import type { FormEvent } from 'react'
import { DISAGGREGATE_LEVELS } from '../../types/compilerDisaggregate'
import type { DisaggregateFormInput, DisaggregateLevel } from '../../types/compilerDisaggregate'
import FileDropzone from '../common/FileDropzone'

interface DisaggregateFormProps {
  onSubmit: (input: DisaggregateFormInput) => void
  submitting: boolean
}

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 5 }
const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.02em',
}

// Upload form for POST /compiler/disaggregate. mlos_file is the only real
// file upload; `level` is a Query param on the real route (see
// api/client.ts::submitDisaggregateMlos), not a form field, but collected
// here the same way regardless — that distinction is a wire-format detail.
export default function DisaggregateForm({ onSubmit, submitting }: DisaggregateFormProps) {
  const [mlosFile, setMlosFile] = useState<File | null>(null)
  const [level, setLevel] = useState<DisaggregateLevel>('LGA')
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!mlosFile) {
      setFormError('A Master List of Settlements file is required.')
      return
    }
    setFormError(null)
    onSubmit({ mlosFile, level })
  }

  const canSubmit = !!mlosFile && !submitting

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Run settings</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Upload the Master List of Settlements and choose the administrative level to split by.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FileDropzone label="MLoS file (.csv / .xlsx)" accept=".csv,.xlsx,.xls" file={mlosFile} onChange={setMlosFile} fillWidth />
        <div style={fieldStyle}>
          <label style={labelStyle}>Split by</label>
          <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {DISAGGREGATE_LEVELS.map((opt) => (
              <div
                key={opt}
                onClick={() => setLevel(opt)}
                style={{
                  padding: '7px 16px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: level === opt ? '#fff' : 'var(--color-text-muted)',
                  background: level === opt ? 'var(--color-primary)' : 'transparent',
                }}
              >
                {opt}
              </div>
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            background: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '9px 20px',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'default',
            opacity: canSubmit ? 1 : 0.6,
          }}
        >
          {submitting ? 'Disaggregating…' : 'Disaggregate ▸'}
        </button>
      </div>
      {formError && <div style={{ marginTop: 10, color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
