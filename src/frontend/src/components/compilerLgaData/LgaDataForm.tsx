import { useState } from 'react'
import type { FormEvent } from 'react'
import { STATE_OPTIONS, TRACKS_EXTENSION_OPTIONS } from '../../types/h2h'
import type { StateName } from '../../types/h2h'
import type { LgaDataFormInput } from '../../types/compilerLgaData'
import FileDropzone from '../common/FileDropzone'

interface LgaDataFormProps {
  onFileSelected: (file: File) => void
  onSubmit: (input: LgaDataFormInput) => void
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
const selectStyle = {
  padding: '7px 9px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12.5,
}

// Upload form for POST /compiler/lga_data. lga_file is the only real file
// upload; file_extension/state are Query params on the real route (see
// api/client.ts::submitCombineLgaData), not form fields. `state` is marked
// "(accepted, unused)" rather than hidden — it's real on the signature, it
// just does nothing server-side (see types/compilerLgaData.ts).
//
// onFileSelected fires as soon as a file is chosen (before Combine is
// clicked) so the page can run the client-side preflight immediately —
// mirrors the Ingest note pattern on the DIP Generator page.
export default function LgaDataForm({ onFileSelected, onSubmit, submitting }: LgaDataFormProps) {
  const [lgaFile, setLgaFile] = useState<File | null>(null)
  const [fileExtension, setFileExtension] = useState('csv')
  const [state, setState] = useState<StateName | ''>('')
  const [formError, setFormError] = useState<string | null>(null)

  function handleFileChange(file: File | null) {
    setLgaFile(file)
    if (file) onFileSelected(file)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!lgaFile) {
      setFormError('An LGA data file is required.')
      return
    }
    setFormError(null)
    onSubmit({ lgaFile, fileExtension, state })
  }

  const canSubmit = !!lgaFile && !submitting

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
        Upload a zip of per-LGA validation data. The extension field only matters when the upload is a zip. Read the
        caveat below before expecting a working "Combine" button — see the note about why.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FileDropzone label="LGA data file (.zip / .xlsx / .xls / .csv)" accept=".zip,.xlsx,.xls,.csv" file={lgaFile} onChange={handleFileChange} fillWidth />
        <div style={fieldStyle}>
          <label style={labelStyle}>File extension inside zip</label>
          <select value={fileExtension} onChange={(e) => setFileExtension(e.target.value)} style={{ ...selectStyle, minWidth: 110 }}>
            {TRACKS_EXTENSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>State (accepted, unused)</label>
          <select value={state} onChange={(e) => setState(e.target.value as StateName | '')} style={{ ...selectStyle, minWidth: 130 }}>
            <option value="">None</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
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
          {submitting ? 'Combining…' : 'Combine ▸'}
        </button>
      </div>
      {formError && <div style={{ marginTop: 10, color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
