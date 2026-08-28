import { useState } from 'react'
import type { FormEvent } from 'react'
import type { PostImplementationFormInput } from '../../types/postImplementation'
import { readSettlementListHeaders } from '../../utils/dailyReport'
import FileDropzone from '../common/FileDropzone'

interface PostImplementationFormProps {
  onSubmit: (input: PostImplementationFormInput) => void
  submitting: boolean
}

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 5, minWidth: 220 }
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

/**
 * Upload form for POST /reports/post. `settlement_list` is the only file;
 * `report_col` (the final visitation/coverage status column) is a DROPDOWN
 * populated from the UPLOADED FILE'S OWN HEADERS (utils/dailyReport.ts::
 * readSettlementListHeaders — reused as-is, its read logic isn't specific to
 * Daily Report), same convention as DailyReportForm, defaulting to whichever
 * header contains "coverage" if one exists (the backend's own dev harness
 * runs against a "Settlement Coverage" column). Falls back to a free-text
 * input only when header detection genuinely finds nothing (an unsupported
 * extension, or an unreadable file) — same fallback DailyReportForm uses;
 * every readable upload gets the dropdown.
 *
 * No "Limit to LGAs" field anymore — the route's optional `lois` filter was
 * removed server-side in a same-day backend update (not fixed, just dropped:
 * post_implementation_report.py's route signature no longer has a `lois`
 * parameter at all), so there's nothing left for a field like that to send.
 */
export default function PostImplementationForm({ onSubmit, submitting }: PostImplementationFormProps) {
  const [settlementFile, setSettlementFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [reportCol, setReportCol] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [headerReadError, setHeaderReadError] = useState<string | null>(null)

  async function handleFileChange(file: File | null) {
    setSettlementFile(file)
    setReportCol('')
    setHeaderReadError(null)
    if (!file) {
      setHeaders([])
      return
    }
    try {
      const fileHeaders = await readSettlementListHeaders(file)
      setHeaders(fileHeaders)
      if (fileHeaders.length === 0) {
        setHeaderReadError('Could not read column headers from this file client-side — enter the status column below directly.')
        return
      }
      const coverageDefault = fileHeaders.find((h) => /coverage/i.test(h))
      if (coverageDefault) setReportCol(coverageDefault)
    } catch {
      setHeaders([])
      setHeaderReadError('Could not read column headers from this file client-side — enter the status column below directly.')
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!settlementFile) {
      setFormError('A settlement list file is required.')
      return
    }
    if (!reportCol.trim()) {
      setFormError('The final visitation/coverage status column is required.')
      return
    }
    setFormError(null)
    onSubmit({ settlementFile, reportCol: reportCol.trim() })
  }

  const canSubmit = !!settlementFile && !!reportCol.trim() && !submitting
  const useFreeText = headers.length === 0

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
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Upload a settlement list carrying State, LGA and Ward columns plus a final visitation or coverage status column
        — one LGA summary pie chart and one ward-level breakdown bar chart get generated per LGA.
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FileDropzone
          label="Settlement list"
          hint="CSV or Excel, with State/LGA/Ward and a status column"
          accept=".csv,.xlsx,.xls"
          file={settlementFile}
          onChange={handleFileChange}
          fillWidth
        />

        <div style={fieldStyle}>
          <label style={labelStyle}>Status column (report_col)</label>
          {useFreeText ? (
            <input
              type="text"
              value={reportCol}
              onChange={(e) => setReportCol(e.target.value)}
              placeholder="e.g. Settlement Coverage"
              style={{ ...selectStyle, minWidth: 220 }}
            />
          ) : (
            <select value={reportCol} onChange={(e) => setReportCol(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
              <option value="">Choose a column…</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {headerReadError && <div style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 11.5 }}>{headerReadError}</div>}

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
        {submitting ? 'Generating…' : 'Generate Reports ▸'}
      </button>

      {formError && <div style={{ marginTop: 10, color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
