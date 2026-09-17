import { useState } from 'react'
import type { FormEvent } from 'react'
import type { DuplicateCheckerFormInput } from '../../types/duplicateChecker'
import FileDropzone from '../common/FileDropzone'

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

// Default matches the backend's own default (toolbox/mlos/validation/
// review/attributes/deep_search.py::review_ward_settlement_for_duplicates,
// falling back to CONFIG['THRESHOLDS']['INTRA-WARD'] when unset — 92 is that
// config value) — now user-suppliable via the `threshold` query param on
// POST /duplicate-deep-search/.
const DEFAULT_THRESHOLD = 92
const THRESHOLD_MIN = 80
const THRESHOLD_MAX = 100

export default function DuplicateCheckerForm({ onSubmit, submitting }: DuplicateCheckerFormProps) {
  const [settlementsFile, setSettlementsFile] = useState<File | null>(null)
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!settlementsFile) {
      setFormError('A settlement list file is required.')
      return
    }
    setFormError(null)
    onSubmit({ settlementsFile, threshold })
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 24,
        marginBottom: 24,
      }}
    >
      <FileDropzone
        label="Settlement list (MLoS file) *"
        accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
        file={settlementsFile}
        onChange={setSettlementsFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 240 }}>
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
          {submitting ? 'Processing…' : 'Run Duplicate Check'}
        </button>
      </div>

      {formError && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>
      )}
    </form>
  )
}
