import { useState } from 'react'
import type { FormEvent } from 'react'
import FileDropzone from '../common/FileDropzone'

interface DipGeneratorFormProps {
  onSubmit: (dipFile: File, validateDip: boolean, teamAllocationFile: File | null, batchSize: number) => void
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

// Upload form for POST /dip/generator — a compiled DIP, an optional
// validate_dip toggle (which requires a Team Allocation file when on — see
// the top-of-file comment in DipGeneratorPage.tsx: turning this on crashes
// every batch with a KeyError rather than actually validating anything, so
// use Microplan · Validate DIP for real validation instead), and a
// client-only "LGAs per batch" control that drives the batching workaround
// in utils/dipGeneratorParse.ts, not a real backend parameter.
export default function DipGeneratorForm({ onSubmit, submitting }: DipGeneratorFormProps) {
  const [dipFile, setDipFile] = useState<File | null>(null)
  const [validateDip, setValidateDip] = useState(false)
  const [teamAllocationFile, setTeamAllocationFile] = useState<File | null>(null)
  const [batchSize, setBatchSize] = useState(3)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!dipFile) {
      setFormError('A compiled DIP file is required.')
      return
    }
    if (validateDip && !teamAllocationFile) {
      setFormError('A Team Allocation file is required when validation is switched on.')
      return
    }
    setFormError(null)
    onSubmit(dipFile, validateDip, validateDip ? teamAllocationFile : null, batchSize)
  }

  const canSubmit = !!dipFile && (!validateDip || !!teamAllocationFile) && !submitting

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
        Upload the compiled DIP. Turn on validation to also require the ward Team Allocation file — see the design
        note below before relying on that toggle for anything.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FileDropzone label="DIP / Settlements file (.csv / .xlsx)" accept=".csv,.xlsx,.xls" file={dipFile} onChange={setDipFile} fillWidth />
        {validateDip && (
          <FileDropzone
            label="Team Allocation file (.xlsx / .csv)"
            accept=".csv,.xlsx,.xls"
            file={teamAllocationFile}
            onChange={setTeamAllocationFile}
            fillWidth
          />
        )}
        <div style={fieldStyle}>
          <label style={labelStyle}>LGAs per batch</label>
          <select value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} style={{ ...selectStyle, minWidth: 130 }}>
            <option value={1}>1</option>
            <option value={3}>3 (default)</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={9999}>All (single request)</option>
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
          {submitting ? 'Generating…' : 'Generate DIPs ▸'}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 3px' }}>
        <input
          type="checkbox"
          id="validateDipToggle"
          checked={validateDip}
          onChange={(e) => setValidateDip(e.target.checked)}
          style={{ width: 15, height: 15, cursor: 'pointer' }}
        />
        <label htmlFor="validateDipToggle" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer' }}>
          Validate against Team Allocation before generating (validate_dip)
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
        Off by default. Switching this on requires the Team Allocation upload above — see the design note for why it
        doesn't otherwise change what you get back.
      </div>
      {formError && <div style={{ marginTop: 10, color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
