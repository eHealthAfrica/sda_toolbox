import { useMemo, useState } from 'react'
import { ApiError, checkUuidBatch } from '../../api/client'
import type { ParsedUuidBatch, UuidCheckResult } from '../../types/uuidChecker'
import { parseUuidFile, parseUuidText } from '../../utils/uuidFile'
import { downloadCsv } from '../../utils/csvExport'
import { useJobTracker } from '../../state/jobTracker'
import StatCard from '../common/StatCard'
import FileDropzone from '../common/FileDropzone'
import UuidResultTable from './UuidResultTable'

const LARGE_BATCH_WARNING_THRESHOLD = 500
const EMPTY_BATCH: ParsedUuidBatch = { uuids: [], invalid: [], duplicateCount: 0 }

// POST /uuid_batch_checker — file (.csv/.txt) or pasted UUIDs, checked in one
// request, with a CSV export of the results. Malformed rows are filtered out
// client-side before the request goes out (see utils/uuidFile.ts) rather
// than sent, since the endpoint takes the whole list as one JSON body and a
// single bad UUID would 422 the entire batch.
export default function BatchUuidCheck() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedUuidBatch>(EMPTY_BATCH)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [showInvalid, setShowInvalid] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<UuidCheckResult[] | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleFileChange(file: File | null) {
    setResults(null)
    setError(null)
    setSelectedFile(file)
    setFileName(file?.name ?? null)
    if (!file) {
      setParsed(EMPTY_BATCH)
      return
    }
    try {
      const batch = await parseUuidFile(file)
      setParsed(batch)
      setPasteText('')
    } catch {
      setError('Could not read that file — make sure it is a plain .csv or .txt file.')
      setParsed(EMPTY_BATCH)
    }
  }

  function handlePasteChange(text: string) {
    setPasteText(text)
    setResults(null)
    setFileName(null)
    setParsed(text.trim() ? parseUuidText(text) : EMPTY_BATCH)
  }

  async function handleCheckBatch() {
    if (parsed.uuids.length === 0) return
    setChecking(true)
    setError(null)
    const jobId = startJob('uuid-checker', `Batch check · ${parsed.uuids.length.toLocaleString()} UUIDs`)
    try {
      const response = await checkUuidBatch(parsed.uuids)
      setResults(response)
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while checking this batch.')
      }
      setResults(null)
      failJob(jobId)
    } finally {
      setChecking(false)
    }
  }

  function handleDownload() {
    if (!results) return
    const rows = results.map((r) => ({ uuid: r.uuid, exists: r.exists }))
    const stamp = fileName ? fileName.replace(/\.[^.]+$/, '') : 'uuid_batch'
    downloadCsv(`${stamp}_results.csv`, rows)
  }

  const summary = useMemo(() => {
    if (!results) return null
    const existsCount = results.filter((r) => r.exists === 'EXISTS').length
    return { total: results.length, existsCount, notExistsCount: results.length - existsCount }
  }, [results])

  return (
    <div>
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-sm)',
          padding: 20,
          marginBottom: 24,
        }}
      >
        <FileDropzone label="UUID list (.csv or .txt) *" accept=".csv,.txt" file={selectedFile} onChange={handleFileChange} />
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer', padding: '4px 0' }}
          >
            {pasteOpen ? '▾ Hide paste option' : '▸ Or paste UUIDs instead'}
          </button>
          {pasteOpen && (
            <textarea
              placeholder={'One UUID per line —\n123e4567-e89b-12d3-a456-426614174000\n...'}
              value={pasteText}
              onChange={(e) => handlePasteChange(e.target.value)}
              rows={5}
              style={{
                width: '100%',
                marginTop: 6,
                padding: '8px 10px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                fontSize: 12.5,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                resize: 'vertical',
              }}
            />
          )}
        </div>

        {(fileName || pasteText.trim()) && (
          <div style={{ marginTop: 14, fontSize: 12.5 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--color-text-muted)' }}>
              <span>
                <strong style={{ color: 'var(--color-text)' }}>{parsed.uuids.length.toLocaleString()}</strong> valid UUID
                {parsed.uuids.length === 1 ? '' : 's'} detected
              </span>
              {parsed.duplicateCount > 0 && <span>{parsed.duplicateCount.toLocaleString()} duplicate(s) skipped</span>}
              {parsed.invalid.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowInvalid((v) => !v)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-critical)', fontSize: 12.5, cursor: 'pointer', padding: 0 }}
                >
                  {parsed.invalid.length.toLocaleString()} row(s) not UUID-shaped — skipped {showInvalid ? '▴' : '▾'}
                </button>
              )}
            </div>
            {showInvalid && parsed.invalid.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  maxHeight: 140,
                  overflowY: 'auto',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '6px 10px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 11.5,
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-bg)',
                }}
              >
                {parsed.invalid.map((entry, i) => (
                  <div key={i}>
                    row {entry.row}: "{entry.raw}"
                  </div>
                ))}
              </div>
            )}
            {parsed.uuids.length > LARGE_BATCH_WARNING_THRESHOLD && (
              <div style={{ marginTop: 8, color: 'var(--color-warning)' }}>
                {parsed.uuids.length.toLocaleString()} UUIDs is a large batch — the backend checks each one against the
                database in turn, so this may take a while.
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={handleCheckBatch}
            disabled={checking || parsed.uuids.length === 0}
            style={{
              background: checking || parsed.uuids.length === 0 ? 'var(--color-text-muted)' : 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '9px 22px',
              fontSize: 13,
              fontWeight: 600,
              cursor: checking || parsed.uuids.length === 0 ? 'default' : 'pointer',
            }}
          >
            {checking ? 'Checking…' : `Check batch${parsed.uuids.length > 0 ? ` (${parsed.uuids.length.toLocaleString()})` : ''}`}
          </button>
        </div>

        {error && <div style={{ color: 'var(--color-critical)', fontSize: 12, marginTop: 10 }}>{error}</div>}
      </div>

      {checking && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 20 }}>
          Checking {parsed.uuids.length.toLocaleString()} UUIDs against the settlements table…
        </div>
      )}

      {summary && (
        <>
          <section style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <StatCard label="Total checked" value={summary.total.toLocaleString()} accentColor="#2c5f9e" />
                <StatCard
                  label="Exists"
                  value={summary.existsCount.toLocaleString()}
                  accentColor="#0ca30c"
                  hint={`${((summary.existsCount / summary.total) * 100).toFixed(1)}% of batch`}
                />
                <StatCard
                  label="Not exists"
                  value={summary.notExistsCount.toLocaleString()}
                  accentColor="#d03b3b"
                  hint={`${((summary.notExistsCount / summary.total) * 100).toFixed(1)}% of batch`}
                />
              </div>
              <button
                type="button"
                onClick={handleDownload}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-primary)',
                  color: 'var(--color-primary)',
                  borderRadius: 'var(--radius-md)',
                  padding: '9px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                ⬇ Download results (CSV)
              </button>
            </div>
          </section>

          <UuidResultTable results={results ?? []} title="Batch results" />
        </>
      )}

      {!summary && !checking && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Upload a .csv or .txt file of UUIDs above (or paste them in) and run the batch check to see results here.
        </div>
      )}
    </div>
  )
}
