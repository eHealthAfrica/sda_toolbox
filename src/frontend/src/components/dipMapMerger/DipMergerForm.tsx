import { useState } from 'react'
import type { FormEvent } from 'react'
import { STATE_OPTIONS } from '../../types/h2h'
import type { StateName } from '../../types/h2h'
import FileDropzone from '../common/FileDropzone'

interface DipMergerFormProps {
  onSubmit: (mapsFile: File, dipFile: File, lgas: string, state: StateName | null) => void
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

// Upload form for POST /dip/merger — two zips (Team Guide Maps, DIP) plus
// either a specific LGA list or a state (the backend requires one or the
// other; see api/client.ts::submitDipMapMerger). Each Microplan page keeps
// its own state selector rather than reading a shared/global one — same
// convention as MlosQcPage's QcForm.
export default function DipMergerForm({ onSubmit, submitting }: DipMergerFormProps) {
  const [mapsFile, setMapsFile] = useState<File | null>(null)
  const [dipFile, setDipFile] = useState<File | null>(null)
  const [lgas, setLgas] = useState('')
  const [state, setState] = useState<StateName | ''>('')
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!mapsFile || !dipFile) {
      setFormError('Both a Team Guide Maps zip and a DIP zip are required.')
      return
    }
    if (!lgas.trim() && !state) {
      setFormError('Provide either specific LGAs or a state.')
      return
    }
    setFormError(null)
    onSubmit(mapsFile, dipFile, lgas, state || null)
  }

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
        Upload the zipped Team Guide Maps and the zipped DIP PDFs. Leave LGAs blank to generate a map book for every
        LGA in the state selected below.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FileDropzone label="Team Guide Maps (.zip)" accept=".zip" file={mapsFile} onChange={setMapsFile} fillWidth />
        <FileDropzone label="DIP files (.zip)" accept=".zip" file={dipFile} onChange={setDipFile} fillWidth />
        <div style={fieldStyle}>
          <label style={labelStyle}>LGAs (optional)</label>
          <input
            type="text"
            placeholder="Leave blank for all LGAs in the state"
            value={lgas}
            onChange={(e) => setLgas(e.target.value)}
            style={{
              padding: '7px 9px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12.5,
              minWidth: 260,
            }}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>State</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value as StateName)}
            style={{
              padding: '7px 9px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12.5,
            }}
          >
            <option value="">Select a state…</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting}
          style={{
            background: submitting ? 'var(--color-text-muted)' : 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '9px 20px',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? 'Merging…' : 'Run Merge ▸'}
        </button>
      </div>
      {formError && (
        <div style={{ marginTop: 10, color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>
      )}
    </form>
  )
}
