import { useState } from 'react'
import type { FormEvent } from 'react'
import { STATE_OPTIONS } from '../../types/h2h'
import type { StateName } from '../../types/h2h'
import type { QcFormInput } from '../../types/mlos'
import FileDropzone from '../common/FileDropzone'

interface QcFormProps {
  onSubmit: (input: QcFormInput) => void
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
// Reserved label height (in px), shared by every field in the row below, so
// their boxes/selects all start at the same y-offset regardless of which
// one's own label happens to wrap onto more lines — see the matching
// comment on FileDropzone's labelMinHeight prop.
const ROW_LABEL_HEIGHT = 56

export default function QcForm({ onSubmit, submitting }: QcFormProps) {
  const [mlosFile, setMlosFile] = useState<File | null>(null)
  const [state, setState] = useState<StateName | ''>('')
  // Defaults mirror the backend's own defaults (toolbox/apps/mlos/qc_mlos.py
  // ::validate_mlos): standardize=None and deep_search=None both read as
  // "off" unless explicitly set true; consistency=True is the one check
  // that's on by default.
  const [standardize, setStandardize] = useState(false)
  const [consistency, setConsistency] = useState(true)
  const [deepSearch, setDeepSearch] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!mlosFile) {
      setFormError('An MLoS settlement list file is required.')
      return
    }
    if (!state) {
      setFormError('A state is required — it resolves ward boundaries for the spatial checks.')
      return
    }
    setFormError(null)
    onSubmit({ mlosFile, state, standardize, consistency, deepSearch })
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
        file={mlosFile}
        onChange={setMlosFile}
        labelMinHeight={ROW_LABEL_HEIGHT}
      />

      <div style={fieldStyle}>
        <label style={{ ...labelStyle, minHeight: ROW_LABEL_HEIGHT, display: 'block', boxSizing: 'border-box' }} htmlFor="qc_state">
          State * <span style={{ fontWeight: 400 }}>— for ward boundary checks</span>
        </label>
        <select id="qc_state" style={inputStyle} value={state} onChange={(e) => setState(e.target.value as StateName)}>
          <option value="">Select a state…</option>
          {STATE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center', gridColumn: '1 / -1', flexWrap: 'wrap' }}>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={standardize} onChange={(e) => setStandardize(e.target.checked)} />
          Standardize first
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={consistency} onChange={(e) => setConsistency(e.target.checked)} />
          Consistency checks
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={deepSearch} onChange={(e) => setDeepSearch(e.target.checked)} />
          Deep duplicate search
        </label>

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
          {submitting ? 'Processing…' : 'Run QC & Validation'}
        </button>
      </div>

      {formError && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>
      )}
    </form>
  )
}
