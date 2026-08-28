import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ContactAnalysisFormInput } from '../../types/contactAnalysis'
import FileDropzone from '../common/FileDropzone'

interface ContactAnalysisFormProps {
  onSubmit: (input: ContactAnalysisFormInput) => void
  submitting: boolean
}

// Reserved label(+hint) height (in px), shared by both fields in the row
// below, so their dropzone boxes start at the same y-offset regardless of
// which one's own label/hint happens to wrap onto more lines — see the
// matching comment on FileDropzone's labelMinHeight prop.
const ROW_LABEL_HEIGHT = 56

export default function ContactAnalysisForm({ onSubmit, submitting }: ContactAnalysisFormProps) {
  const [baseFile, setBaseFile] = useState<File | null>(null)
  const [previousCampaignFile, setPreviousCampaignFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!baseFile) {
      setFormError('A baseline settlement list is required.')
      return
    }
    if (!previousCampaignFile) {
      setFormError('A previous campaigns file is required.')
      return
    }
    setFormError(null)
    onSubmit({ baseFile, previousCampaignFile })
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
        marginBottom: 24,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <FileDropzone
          label="Baseline settlement list *"
          hint="Settlements to evaluate contact and coverage for"
          accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
          file={baseFile}
          onChange={setBaseFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
        />

        <FileDropzone
          label="Previous campaigns Excel workbook *"
          hint="One sheet per campaign round"
          accept=".xlsx,.xls"
          file={previousCampaignFile}
          onChange={setPreviousCampaignFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
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
          {submitting ? 'Processing…' : 'Run contact analysis'}
        </button>
      </div>

      {formError && (
        <div style={{ marginTop: 12, color: 'var(--color-critical)', fontSize: 12 }}>
          {formError}
        </div>
      )}
    </form>
  )
}
