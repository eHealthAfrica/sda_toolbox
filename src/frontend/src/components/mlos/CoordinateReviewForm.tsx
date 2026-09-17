import { useState } from 'react'
import type { FormEvent } from 'react'
import type { CoordinateReviewFormInput } from '../../types/coordinateReview'
import FileDropzone from '../common/FileDropzone'

interface CoordinateReviewFormProps {
  onSubmit: (input: CoordinateReviewFormInput) => void
  submitting: boolean
}

interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

// A real switch control (track + sliding thumb), not a native checkbox —
// built from a plain <button role="switch"> since this app has no shared
// Toggle component yet. Kept local to this form; promote to components/common
// if a second tool ever needs the same control.
function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 38,
        height: 21,
        borderRadius: 999,
        border: 'none',
        padding: 2,
        cursor: 'pointer',
        background: checked ? 'var(--color-primary)' : 'var(--color-border)',
        transition: 'background 0.15s ease',
        flex: 'none',
      }}
    >
      <span
        style={{
          display: 'block',
          width: 17,
          height: 17,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          transform: checked ? 'translateX(17px)' : 'translateX(0)',
          transition: 'transform 0.15s ease',
        }}
      />
    </button>
  )
}

// Three required uploads plus one toggle — POST /coordinate_review
// (toolbox/apps/mlos/coord_review.py) takes three bare UploadFile params
// (multipart body) plus a bare `use_osm: bool` with no default, which lands
// as a Query param instead (see api/client.ts::submitCoordinateReview for the
// full contract, including two upload caveats surfaced as hints below).
// Defaults off: pulling in OSM as an extra source is opt-in, not assumed.
export default function CoordinateReviewForm({ onSubmit, submitting }: CoordinateReviewFormProps) {
  const [settlementsFile, setSettlementsFile] = useState<File | null>(null)
  const [sourcesFile, setSourcesFile] = useState<File | null>(null)
  const [tracksFile, setTracksFile] = useState<File | null>(null)
  const [useOsm, setUseOsm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!settlementsFile || !sourcesFile || !tracksFile) {
      setFormError('A settlement list, a sources workbook, and a tracks file are all required.')
      return
    }
    setFormError(null)
    onSubmit({ settlementsFile, sourcesFile, tracksFile, useOsm })
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
        label="Settlement list *"
        hint="The baseline coordinates being judged."
        accept=".csv,.xlsx,.xls"
        file={settlementsFile}
        onChange={setSettlementsFile}
        labelMinHeight={40}
      />
      <FileDropzone
        label="Sources workbook *"
        hint="One sheet per source — .xlsx/.xls (every sheet is read) or .zip. A plain .csv is rejected."
        accept=".xlsx,.xls,.zip"
        file={sourcesFile}
        onChange={setSourcesFile}
        labelMinHeight={40}
      />
      <FileDropzone
        label="Tracks file *"
        hint="A single spatial file (.gpkg/.kml/.shp/.sqlite) or lat/lon csv/xlsx — a .zip currently fails server-side."
        accept=".gpkg,.kml,.shp,.sqlite,.csv,.xlsx,.xls"
        file={tracksFile}
        onChange={setTracksFile}
        labelMinHeight={40}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 220 }}>
        <div style={{ minHeight: 40, boxSizing: 'border-box' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
            Use OSM
          </label>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Include OpenStreetMap in the Review.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ToggleSwitch checked={useOsm} onChange={setUseOsm} label="Use OSM" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center', gridColumn: '1 / -1', flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={submitting}
          style={{
            marginLeft: 'auto',
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
          {submitting ? 'Processing…' : 'Run Coordinate Review'}
        </button>
      </div>

      {formError && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>
      )}
    </form>
  )
}
