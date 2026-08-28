import { useState } from 'react'
import type { FormEvent } from 'react'
import { STATE_OPTIONS, TRACKS_EXTENSION_OPTIONS } from '../../types/h2h'
import type { StateName } from '../../types/h2h'
import type { TracksFormInput } from '../../types/compilerTracks'
import FileDropzone from '../common/FileDropzone'
import MultiStateSelect from '../common/MultiStateSelect'

interface TracksFormProps {
  onSubmit: (input: TracksFormInput) => void
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

// Upload form for POST /compiler/tracks. tracks_path is the only real file
// upload — tracks_extension/states/remove_invalid_tracks are all Query
// params on the real route (see api/client.ts::submitCombineTracks), not
// form fields, but they're still collected here the same way since the
// distinction is purely a wire-format detail the form shouldn't surface.
// `states` used to be a single optional state; the route now takes any
// number of them (MultiStateSelect below), unioning their boundaries.
export default function TracksForm({ onSubmit, submitting }: TracksFormProps) {
  const [tracksFile, setTracksFile] = useState<File | null>(null)
  const [tracksExtension, setTracksExtension] = useState('csv')
  const [states, setStates] = useState<StateName[]>([])
  const [removeInvalidTracks, setRemoveInvalidTracks] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!tracksFile) {
      setFormError('A tracks file is required.')
      return
    }
    setFormError(null)
    onSubmit({ tracksFile, tracksExtension, states, removeInvalidTracks })
  }

  const canSubmit = !!tracksFile && !submitting

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
        Upload a zipped folder of individual track files (or a single track file). State clipping is optional and
        supports any number of states — leave it empty to keep every compiled point, or pick several to clip to their
        combined boundary.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FileDropzone
          label="Tracks file (.zip or single file)"
          accept=".zip,.csv,.xlsx,.xls,.sqlite,.gpkg,.kml,.kmz"
          file={tracksFile}
          onChange={setTracksFile}
          fillWidth
        />
        <div style={fieldStyle}>
          <label style={labelStyle}>Track file extension</label>
          <select value={tracksExtension} onChange={(e) => setTracksExtension(e.target.value)} style={{ ...selectStyle, minWidth: 110 }}>
            {TRACKS_EXTENSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <MultiStateSelect
          label="Clip to states (optional)"
          options={STATE_OPTIONS}
          selected={states}
          onChange={(next) => setStates(next as StateName[])}
          minWidth={170}
        />
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
          {submitting ? 'Combining…' : 'Combine tracks ▸'}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 3px' }}>
        <input
          type="checkbox"
          id="removeInvalidTracks"
          checked={removeInvalidTracks}
          onChange={(e) => setRemoveInvalidTracks(e.target.checked)}
          style={{ width: 15, height: 15, cursor: 'pointer' }}
        />
        <label htmlFor="removeInvalidTracks" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer' }}>
          Remove invalid tracks
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
        On by default — this drops more than slow-speed points; see the caveat below before relying on the label
        alone.
      </div>
      {formError && <div style={{ marginTop: 10, color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
