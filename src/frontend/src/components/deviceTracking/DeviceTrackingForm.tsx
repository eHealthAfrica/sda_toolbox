import { useState } from 'react'
import type { FormEvent } from 'react'
import type { DeviceTrackingFormInput } from '../../types/deviceTracking'
import FileDropzone from '../common/FileDropzone'

interface DeviceTrackingFormProps {
  onSubmit: (input: DeviceTrackingFormInput) => void
  submitting: boolean
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }
const inputStyle = {
  padding: '7px 9px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
}
// Same shared label height every upload form on this app uses, so the
// dropzone boxes and the text field below all start at the same y-offset
// whichever label happens to wrap.
const ROW_LABEL_HEIGHT = 56

export default function DeviceTrackingForm({ onSubmit, submitting }: DeviceTrackingFormProps) {
  const [tracksFile, setTracksFile] = useState<File | null>(null)
  const [vaccineBuddyFile, setVaccineBuddyFile] = useState<File | null>(null)
  const [activityCode, setActivityCode] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!tracksFile) {
      setFormError('A GTS tracks file is required.')
      return
    }
    if (!activityCode.trim()) {
      setFormError('An activity code is required, e.g. IBRA1.')
      return
    }
    setFormError(null)
    onSubmit({ tracksFile, activityCode: activityCode.trim(), vaccineBuddyFile })
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
        label="GTS tracks *"
        accept=".gpkg,.csv,.sqlite,.kml,.kmz,.zip"
        file={tracksFile}
        onChange={setTracksFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ minHeight: ROW_LABEL_HEIGHT, boxSizing: 'border-box' }}>
          <label htmlFor="dt-activity-code" style={{ ...labelStyle, textTransform: 'uppercase', letterSpacing: '0.02em', fontSize: 11 }}>
            Activity code *
          </label>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
            The campaign code inside every team code, e.g. IBRA1 in KE-BRK-GAD-IBRA1-003.
          </div>
        </div>
        <input
          id="dt-activity-code"
          style={inputStyle}
          value={activityCode}
          onChange={(e) => setActivityCode(e.target.value)}
          placeholder="IBRA1"
          autoComplete="off"
        />
      </div>

      <FileDropzone
        label="Vaccine-buddy mapping (optional)"
        hint="Device ID to team code, for vaccine-buddy devices."
        accept=".csv,.xlsx,.xls"
        file={vaccineBuddyFile}
        onChange={setVaccineBuddyFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

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
          {submitting ? 'Processing…' : 'Run team & device analysis'}
        </button>
      </div>

      {formError && <div style={{ gridColumn: '1 / -1', color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
