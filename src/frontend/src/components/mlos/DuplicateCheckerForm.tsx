import { useState } from 'react'
import type { FormEvent } from 'react'
import type { DuplicateCheckerFormInput } from '../../types/duplicateChecker'
import { DEFAULT_THRESHOLD, THRESHOLD_MAX, THRESHOLD_MIN } from '../../types/duplicateChecker'
import FileDropzone from '../common/FileDropzone'
import ToggleSwitch from '../common/ToggleSwitch'

interface DuplicateCheckerFormProps {
  onSubmit: (input: DuplicateCheckerFormInput) => void
  submitting: boolean
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }
// Reserved label height (in px), shared by every field in the row below, so
// their boxes all start at the same y-offset regardless of which one's own
// label happens to wrap onto more lines — see the matching comment on
// FileDropzone's labelMinHeight prop and QcForm's identical convention.
const ROW_LABEL_HEIGHT = 56

// DEFAULT_THRESHOLD / THRESHOLD_MIN / THRESHOLD_MAX live in
// types/duplicateChecker.ts (the page's empty-result state needs them too).
// The default matches the backend's own (deep_search.py::
// review_ward_settlement_for_duplicates falls back to
// CONFIG['THRESHOLDS']['INTRA-WARD'] when unset — 92 is that config value).

export default function DuplicateCheckerForm({ onSubmit, submitting }: DuplicateCheckerFormProps) {
  const [settlementsFile, setSettlementsFile] = useState<File | null>(null)
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  // On by default: the backend route requires this flag and was previously always run with it on.
  const [crossReferenceSource, setCrossReferenceSource] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!settlementsFile) {
      setFormError('A settlement list file is required.')
      return
    }
    setFormError(null)
    onSubmit({ settlementsFile, threshold, crossReferenceSource })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        marginBottom: 24,
      }}
    >
      {/* File picker and run parameters side by side in one row, with wide gutters
          between them; the row wraps onto a second line only on narrow screens. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '28px 56px' }}>
        <FileDropzone
          label="Settlement list (MLoS file) *"
          accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
          file={settlementsFile}
          onChange={setSettlementsFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
          fillWidth
        />
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 240 }}>
          <div style={{ minHeight: ROW_LABEL_HEIGHT, boxSizing: 'border-box' }}>
            <label style={{ ...labelStyle, textTransform: 'uppercase', letterSpacing: '0.02em', fontSize: 11 }}>
              Text Similarity Threshold
            </label>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Increase or reduce to enforce strict or loose similarity limits.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--color-primary)' }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 30, textAlign: 'right' }}>{threshold}</span>
          </div>
        </div>

        <div style={{ flex: '0 1 240px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 200 }}>
          <div style={{ minHeight: ROW_LABEL_HEIGHT, boxSizing: 'border-box' }}>
            <label
              htmlFor="cross-reference-source"
              style={{ ...labelStyle, textTransform: 'uppercase', letterSpacing: '0.02em', fontSize: 11 }}
            >
              Cross-reference source
            </label>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Use the source of each duplicate to help triangulate duplicate settlements.
            </div>
          </div>
          <div>
            <ToggleSwitch
              id="cross-reference-source"
              checked={crossReferenceSource}
              onChange={setCrossReferenceSource}
              label={crossReferenceSource ? 'On' : 'Off'}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', paddingTop: 4 }}>
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
          {submitting ? 'Processing…' : 'Run Duplicate Check'}
        </button>
      </div>

      {formError && (
        <div style={{ color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>
      )}
    </form>
  )
}
