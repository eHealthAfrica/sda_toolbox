import { useState } from 'react'
import { submitCombineLgaData, ApiError } from '../../api/client'
import { parseCsvDataset } from '../../api/parseResult'
import { analyzeLgaDataArchive } from '../../utils/compilerLgaDataPreflight'
import type { LgaDataFormInput, LgaDataPreflight } from '../../types/compilerLgaData'
import { useJobTracker } from '../../state/jobTracker'
import LgaDataForm from './LgaDataForm'
import LgaDataPreflightCards from './LgaDataPreflightCards'
import LgaDataPreflightTable from './LgaDataPreflightTable'

interface CombinedResult {
  recordCount: number
  columns: string[]
}

// Compiler · Combine LGA Data. Makes the real call to POST /compiler/lga_data
// (types/compilerLgaData.ts has notes on the route's known limits). On top of
// that it adds (a) a client-side preflight that shows real per-dataset counts
// the moment a file is chosen, regardless of what the backend call does, and
// (b) the server's own message when the call fails, instead of a generic
// "request failed" one.
export default function LgaDataPage() {
  const [preflight, setPreflight] = useState<LgaDataPreflight | null>(null)
  const [preflighting, setPreflighting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; detail: unknown } | null>(null)
  const [result, setResult] = useState<CombinedResult | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleFileSelected(file: File) {
    setPreflighting(true)
    setPreflight(null)
    setResult(null)
    setError(null)
    try {
      const analyzed = await analyzeLgaDataArchive(file)
      setPreflight(analyzed)
    } catch (err) {
      console.warn('LGA data preflight failed:', err)
      setPreflight(null)
    } finally {
      setPreflighting(false)
    }
  }

  async function handleSubmit(input: LgaDataFormInput) {
    setSubmitting(true)
    setError(null)
    setResult(null)
    const jobId = startJob('compiler-lga-data', input.lgaFile?.name ?? 'Combine LGA Data run')
    try {
      const blob = await submitCombineLgaData(input.lgaFile as File, input.fileExtension || null, input.state)
      const parsed = await parseCsvDataset(blob)
      setResult({ recordCount: parsed.records.length, columns: parsed.columns })
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        // detail === '' means the message is already readable (see throwIfNotOk in api/client.ts).
        setError(
          err.detail === ''
            ? { message: err.message, detail: null }
            : { message: `Request failed with status ${err.status}.`, detail: err.detail },
        )
      } else {
        setError({ message: err instanceof Error ? err.message : 'The request failed.', detail: null })
      }
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <LgaDataForm onFileSelected={handleFileSelected} onSubmit={handleSubmit} submitting={submitting} />

      {preflighting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '12px 0', textAlign: 'center' }}>
          Scanning archive…
        </div>
      )}

      {preflight && preflight.datasets.length > 0 && (
        <>
          <LgaDataPreflightCards preflight={preflight} />
          <LgaDataPreflightTable preflight={preflight} />
        </>
      )}

      {error && (
        <div
          style={{
            background: '#fbe6e6',
            border: '1px solid #f0b8b8',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
            marginBottom: 16,
            fontSize: 12.5,
            color: '#7a2020',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠ The Combine request failed</div>
          <div style={{ marginBottom: error.detail ? 8 : 0 }}>{error.message}</div>
          {error.detail !== null && error.detail !== undefined && (
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 11,
                background: 'rgba(0,0,0,.05)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 10px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail)}
            </div>
          )}
        </div>
      )}

      {submitting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '12px 0', textAlign: 'center' }}>
          Calling the real endpoint…
        </div>
      )}

      {result && (
        <div
          style={{
            background: '#e6f6e6',
            border: '1px solid #bfe6bf',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
            marginBottom: 16,
            fontSize: 12.5,
            color: '#14532d',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ Combined</div>
          {result.recordCount.toLocaleString()} records across {result.columns.length} columns.
        </div>
      )}
    </div>
  )
}
