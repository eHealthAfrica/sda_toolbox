import { useState } from 'react'
import { submitValidateDip } from '../../api/client'
import { parseValidateDipResponse } from '../../utils/microplanValidateParse'
import type { ValidateDipAnalysis } from '../../types/microplanValidate'
import { useJobTracker } from '../../state/jobTracker'
import ValidateDipForm from './ValidateDipForm'
import IngestNoteCard from './IngestNoteCard'
import ValidateTitleCards from './ValidateTitleCards'
import MissingDayAndLgaBreakdown from './MissingDayAndLgaBreakdown'
import ValidateRecordsTable from './ValidateRecordsTable'

// Microplan · Validate DIP. Unlike Microplan · Combine DMP Files, the
// backend route here (POST /dip/validator) is a genuine match — it already
// takes a settlements file + a team allocation file and returns exactly the
// DIP/Ward Review/Team Review workbook this page displays. So this page
// calls the real endpoint and PARSES its response (utils/
// microplanValidateParse.ts) rather than recomputing the validation logic
// client-side. The download button re-downloads that same response blob —
// there's nothing to rebuild.
export default function ValidateDipPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<ValidateDipAnalysis | null>(null)
  const [responseBlob, setResponseBlob] = useState<Blob | null>(null)
  const [downloadName, setDownloadName] = useState('DIP Validation.xlsx')
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(settlementsFile: File, teamAllocationFile: File) {
    setSubmitting(true)
    setError(null)
    const jobId = startJob('microplan-validate', settlementsFile.name)
    try {
      const blob = await submitValidateDip(settlementsFile, teamAllocationFile)
      const result = await parseValidateDipResponse(blob, settlementsFile)
      if (result.dipRows.length === 0) {
        setError('No rows came back in the review workbook — check that the DIP file has Team Code and Day of Activity columns.')
        setAnalysis(null)
        setResponseBlob(null)
        failJob(jobId)
        return
      }
      setAnalysis(result)
      setResponseBlob(blob)
      setDownloadName(`${settlementsFile.name} Validation.xlsx`)
      completeJob(jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not validate this DIP — check both files and try again.')
      setAnalysis(null)
      setResponseBlob(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  function handleDownload() {
    if (!responseBlob) return
    const url = URL.createObjectURL(responseBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = downloadName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <ValidateDipForm onSubmit={handleSubmit} submitting={submitting} />

      {error && (
        <div
          style={{
            background: '#fbe6e6',
            border: '1px solid #f0b8b8',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 12.5,
            color: 'var(--color-critical)',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {analysis && (
        <>
          <IngestNoteCard analysis={analysis} />
          <ValidateTitleCards analysis={analysis} />
          <MissingDayAndLgaBreakdown analysis={analysis} />
          <ValidateRecordsTable analysis={analysis} onDownload={handleDownload} />
        </>
      )}

      {!analysis && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload the compiled DIP and the ward Team Allocation file above to see the validation results.
        </div>
      )}
    </div>
  )
}
