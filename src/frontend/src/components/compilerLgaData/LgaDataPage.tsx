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

// Compiler · Combine LGA Data. POST /compiler/lga_data is expected to fail
// against realistic input — see the top-of-file comment in
// types/compilerLgaData.ts for the three independent, code-confirmed
// reasons. This page still makes the real call rather than faking success;
// what it adds is (a) a client-side preflight that shows real per-dataset
// counts the moment a file is chosen, regardless of what the backend call
// does, and (b) an honest, specific explanation when that call fails,
// instead of a generic "request failed" message.
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
        setError({ message: `Request failed with status ${err.status}.`, detail: err.detail })
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

      <div
        style={{
          background: '#fbe6e6',
          border: '1px solid #f0b8b8',
          borderRadius: 'var(--radius-lg)',
          padding: '14px 16px',
          marginBottom: 16,
          fontSize: 12,
          lineHeight: 1.65,
          color: '#7a2020',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#7a2020' }}>
          ⚠ As written, this route cannot complete against real per-LGA data — three independent breakages
        </div>
        <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li style={{ marginBottom: 8 }}>
            <b>Zip nesting is one level deeper than the route ever unzips.</b> A real per-LGA export is a zip of
            per-LGA <i>zips</i>, each containing per-ward CSVs — but <code>extract_and_find_file</code> only calls{' '}
            <code>zipfile.extractall</code> once, then globs for the target extension. It finds zero files and
            returns <code>None</code>.
          </li>
          <li style={{ marginBottom: 8 }}>
            <b>
              That <code>None</code> immediately crashes the next line
            </b>{' '}
            — <code>get_excel_sheet_names(None)</code> tries to iterate <code>None</code> as a list of file paths.
          </li>
          <li style={{ marginBottom: 8 }}>
            <b>Even past that, the format doesn't match.</b> <code>get_excel_sheet_names</code> requires genuine{' '}
            <code>.xlsx</code> files; real per-LGA exports are plain <code>.csv</code>.
          </li>
          <li style={{ marginBottom: 0 }}>
            <b>Even with a perfectly flat, valid .xlsx zip, the route fails on its own last line</b> — it writes the
            merged CSV to one tempfile, then serves back a completely different, never-written path built by{' '}
            <code>generate_output_name</code>.
          </li>
        </ol>
      </div>

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
          <div style={{ marginTop: 8 }}>This is expected — see the caveat above for the three known reasons why.</div>
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
          <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ The route actually returned something this time</div>
          {result.recordCount.toLocaleString()} records across {result.columns.length} columns — worth checking
          whether the backend was fixed, or this input happened to sidestep all three known issues.
        </div>
      )}
    </div>
  )
}
