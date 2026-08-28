import { useState } from 'react'
import type { FormEvent } from 'react'
import { TRACKS_EXTENSION_OPTIONS } from '../../types/h2h'
import type { TrackingFormInput } from '../../types/h2h'
import FileDropzone from '../common/FileDropzone'
import ToggleSwitch from '../common/ToggleSwitch'

interface TrackingFormProps {
  onSubmit: (input: TrackingFormInput) => void
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
// Reserved label height (in px), shared by every field in the grid row
// below, so their boxes/selects all start at the same y-offset regardless
// of which one's own label happens to wrap onto more lines — see the
// matching comment on FileDropzone's labelMinHeight prop.
const ROW_LABEL_HEIGHT = 56

export default function TrackingForm({ onSubmit, submitting }: TrackingFormProps) {
  const [tracksFile, setTracksFile] = useState<File | null>(null)
  const [dipFile, setDipFile] = useState<File | null>(null)
  const [analysisDay, setAnalysisDay] = useState(1)
  const [isMopUp, setIsMopUp] = useState(false)
  const [tracksExtension, setTracksExtension] = useState('')
  const [generateReport, setGenerateReport] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!tracksFile || !dipFile) {
      setFormError('Both a tracks file and a DIP (planned settlements) file are required.')
      return
    }
    setFormError(null)
    onSubmit({
      tracksFile,
      dipFile,
      analysisDay,
      isMopUp,
      tracksExtension: tracksExtension || null,
      generateReport,
    })
  }

  const tracksIsZip = tracksFile?.name.toLowerCase().endsWith('.zip')

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        marginBottom: 24,
      }}
    >
      {/* A plain sibling flex row below (not another grid item spanning
          `1 / -1`) so its placement can't be affected by how many columns
          `auto-fit` decides to give this row — that combination previously
          left a large empty gap between the two rows whenever the form was
          wide enough for auto-fit to add unused trailing columns. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
        <FileDropzone
          label="Planned settlements (DIP file) *"
          accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
          file={dipFile}
          onChange={setDipFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
        />

        <div style={fieldStyle}>
          <FileDropzone
            label="GPS tracks *"
            accept=".gpkg,.csv,.sqlite,.kml,.kmz,.zip"
            file={tracksFile}
            onChange={setTracksFile}
            labelMinHeight={ROW_LABEL_HEIGHT}
          />
          {tracksIsZip && (
            <span style={{ fontSize: 11, color: 'var(--color-warning)' }}>
              .zip uploads need "Tracks extension" set below.
            </span>
          )}
        </div>

        <div style={fieldStyle}>
          <label style={{ ...labelStyle, minHeight: ROW_LABEL_HEIGHT, display: 'block', boxSizing: 'border-box' }} htmlFor="analysis_day">
            Analysis day *
          </label>
          <input
            id="analysis_day"
            type="number"
            min={1}
            style={inputStyle}
            value={analysisDay}
            onChange={(e) => setAnalysisDay(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        <div style={fieldStyle}>
          <label
            style={{ ...labelStyle, minHeight: ROW_LABEL_HEIGHT, display: 'block', boxSizing: 'border-box' }}
            htmlFor="tracks_extension"
          >
            Tracks extension {tracksIsZip ? '*' : '(if tracks is a .zip)'}
          </label>
          <select
            id="tracks_extension"
            style={inputStyle}
            value={tracksExtension}
            onChange={(e) => setTracksExtension(e.target.value)}
          >
            <option value="">—</option>
            {TRACKS_EXTENSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ToggleSwitch id="is_mop_up" checked={isMopUp} onChange={setIsMopUp} label="Mop-up day" />
          <ToggleSwitch
            id="generate_report"
            checked={generateReport}
            onChange={setGenerateReport}
            label="Generate daily reports"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginLeft: 'auto',
            alignSelf: 'flex-end',
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
          {submitting ? 'Processing…' : 'Run tracking analysis'}
        </button>
      </div>

      {formError && <div style={{ color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
