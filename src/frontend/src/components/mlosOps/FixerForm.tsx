import { useState } from 'react'
import type { FormEvent } from 'react'
import { STATE_OPTIONS } from '../../types/mlosOps'
import type { FixerFormInput, StateName } from '../../types/mlosOps'
import FileDropzone from '../common/FileDropzone'

interface FixerFormProps {
  onSubmit: (input: FixerFormInput) => void
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

export default function FixerForm({ onSubmit, submitting }: FixerFormProps) {
  const [settlementFile, setSettlementFile] = useState<File | null>(null)
  const [shiftPoints, setShiftPoints] = useState(false)
  const [setGlobalId, setSetGlobalId] = useState(false)
  const [populateTakeoff, setPopulateTakeoff] = useState(false)
  const [duplicateCheck, setDuplicateCheck] = useState(false)
  const [state, setState] = useState<StateName | ''>('')
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!settlementFile) {
      setFormError('A settlement list file is required.')
      return
    }
    if (shiftPoints && !state) {
      setFormError('A state is required when "Shift proximity-violating points" is enabled — it resolves ward boundaries.')
      return
    }
    setFormError(null)
    onSubmit({ settlementFile, shiftPoints, setGlobalId, populateTakeoff, duplicateCheck, state: state || null })
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
      <div style={fieldStyle}>
        <FileDropzone
          label="Settlement list (MLoS file) *"
          accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
          file={settlementFile}
          onChange={setSettlementFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
        />
        <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
          Upload a .csv to get the before/after comparison below.
        </div>
      </div>

      <div style={fieldStyle}>
        <label
          style={{ ...labelStyle, minHeight: ROW_LABEL_HEIGHT, display: 'block', boxSizing: 'border-box' }}
          htmlFor="fixer_state"
        >
          State <span style={{ fontWeight: 400 }}>— required only if "Shift proximity-violating points" is on</span>
        </label>
        <select id="fixer_state" style={inputStyle} value={state} onChange={(e) => setState(e.target.value as StateName)}>
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
          <input type="checkbox" checked={shiftPoints} onChange={(e) => setShiftPoints(e.target.checked)} />
          Shift proximity-violating points
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={setGlobalId} onChange={(e) => setSetGlobalId(e.target.checked)} />
          Populate missing global IDs
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={populateTakeoff} onChange={(e) => setPopulateTakeoff(e.target.checked)} />
          Populate takeoff points
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={duplicateCheck} onChange={(e) => setDuplicateCheck(e.target.checked)} />
          Deep duplicate check
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
          {submitting ? 'Processing…' : 'Run fixer'}
        </button>
      </div>

      {formError && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>
      )}
    </form>
  )
}
