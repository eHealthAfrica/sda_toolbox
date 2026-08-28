import { useState } from 'react'
import type { FormEvent } from 'react'
import FileDropzone from '../common/FileDropzone'

interface ValidateDipFormProps {
  onSubmit: (settlementsFile: File, teamAllocationFile: File) => void
  submitting: boolean
}

// Upload form for POST /dip/validator — two files: the compiled DIP
// (settlements_file) and the ward Team Allocation file (team_allocation_file).
export default function ValidateDipForm({ onSubmit, submitting }: ValidateDipFormProps) {
  const [settlementsFile, setSettlementsFile] = useState<File | null>(null)
  const [teamAllocationFile, setTeamAllocationFile] = useState<File | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!settlementsFile || !teamAllocationFile) return
    onSubmit(settlementsFile, teamAllocationFile)
  }

  const canSubmit = !!settlementsFile && !!teamAllocationFile && !submitting

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
        Upload the compiled DIP and the ward Team Allocation file — the same two files this route already accepts.
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <FileDropzone
          label="Compiled DIP (.csv / .xlsx)"
          accept=".csv,.xlsx,.xls"
          file={settlementsFile}
          onChange={setSettlementsFile}
          fillWidth
        />
        <FileDropzone
          label="Team allocation (.xlsx / .csv)"
          accept=".csv,.xlsx,.xls"
          file={teamAllocationFile}
          onChange={setTeamAllocationFile}
          fillWidth
        />
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
          marginTop: 14,
        }}
      >
        {submitting ? 'Validating…' : 'Run Validation ▸'}
      </button>
    </form>
  )
}
