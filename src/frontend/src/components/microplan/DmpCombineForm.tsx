import { useState } from 'react'
import type { FormEvent } from 'react'
import type { DipExpansion } from '../../types/microplan'
import FileDropzone from '../common/FileDropzone'

interface DmpCombineFormProps {
  onSubmit: (file: File, dip: DipExpansion) => void
  submitting: boolean
}

// Upload form for the zipped DMP folder — a zip of zipped LGA archives, each
// containing that LGA's ward-level CSVs. `dip` mirrors the real endpoint's
// Query param (see api/client.ts::submitCombineDmpFiles) even though this
// page currently computes the expansion client-side.
export default function DmpCombineForm({ onSubmit, submitting }: DmpCombineFormProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dip, setDip] = useState<DipExpansion>('keep')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    onSubmit(file, dip)
  }

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
        Upload the zipped DMP folder — a ZIP of ZIPs, one per LGA, each containing that LGA's ward-level CSVs.
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <FileDropzone label="DMP files (.zip)" accept=".zip" file={file} onChange={setFile} fillWidth />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '7px 12px',
            background: '#fbfbfc',
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={dip === 'expand'}
            onChange={(e) => setDip(e.target.checked ? 'expand' : 'keep')}
          />
          Expand (days to columns)
        </label>
      </div>
      <button
        type="submit"
        disabled={!file || submitting}
        style={{
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          padding: '9px 20px',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: !file || submitting ? 'default' : 'pointer',
          opacity: !file || submitting ? 0.6 : 1,
          marginTop: 14,
        }}
      >
        {submitting ? 'Combining…' : 'Run Combine ▸'}
      </button>
    </form>
  )
}
