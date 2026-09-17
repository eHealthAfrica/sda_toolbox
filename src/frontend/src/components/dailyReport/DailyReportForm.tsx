import { useState } from 'react'
import type { FormEvent } from 'react'
import type { DailyReportFormInput } from '../../types/dailyReport'
import { findDayOfActivityColumn } from '../../utils/columns'
import { readSettlementListHeaders } from '../../utils/dailyReport'
import FileDropzone from '../common/FileDropzone'

interface DailyReportFormProps {
  onSubmit: (input: DailyReportFormInput) => void
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
 * Upload form for POST /reports/daily. `settlement_list` is the only file;
 * `campaign_day_col` and `coverage_col` are both now REQUIRED Query params
 * on the real route (see api/client.ts::submitDailyReport) — the old
 * optional day/cumulative pair, and the "at least one of two" validation it
 * needed, is gone. A single run always builds both a Day and a Cumulative
 * set (DailyReport.generate_report() always runs both passes).
 *
 * Both pickers are dropdowns populated from the UPLOADED FILE'S OWN HEADERS
 * (utils/dailyReport.ts::readSettlementListHeaders), read client-side the
 * moment a file is chosen — same convention as every other form in this
 * app. Day column defaults to the first header matching /\bday\b/i
 * (utils/columns.ts::findDayOfActivityColumn — the same heuristic the H2H
 * page already uses for its own day-of-activity column). Coverage column
 * defaults to whichever header contains "coverage", mirroring
 * PostImplementationForm's own `report_col` default exactly — this route
 * uses the very same DailyReport class, `coverage_col` parameter, and
 * default dev-harness column name ("Settlement Coverage") as Post
 * Implementation's `report_col`.
 *
 * Falls back to free-text inputs when header detection finds nothing (an
 * unsupported extension, or an unreadable file) — same fallback every other
 * form in this app uses; every readable upload gets the dropdown.
 */
export default function DailyReportForm({ onSubmit, submitting }: DailyReportFormProps) {
  const [settlementFile, setSettlementFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [campaignDayCol, setCampaignDayCol] = useState('')
  const [coverageCol, setCoverageCol] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [headerReadError, setHeaderReadError] = useState<string | null>(null)

  async function handleFileChange(file: File | null) {
    setSettlementFile(file)
    setCampaignDayCol('')
    setCoverageCol('')
    setHeaderReadError(null)
    if (!file) {
      setHeaders([])
      return
    }
    try {
      const fileHeaders = await readSettlementListHeaders(file)
      setHeaders(fileHeaders)
      if (fileHeaders.length === 0) {
        setHeaderReadError('Could not read column headers from this file client-side — enter the column names below directly.')
        return
      }
      const dayDefault = findDayOfActivityColumn(fileHeaders)
      if (dayDefault) setCampaignDayCol(dayDefault)
      const coverageDefault = fileHeaders.find((h) => /coverage/i.test(h))
      if (coverageDefault) setCoverageCol(coverageDefault)
    } catch {
      setHeaders([])
      setHeaderReadError('Could not read column headers from this file client-side — enter the column names below directly.')
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!settlementFile) {
      setFormError('A settlement list file is required.')
      return
    }
    if (!campaignDayCol.trim()) {
      setFormError('The campaign day column is required.')
      return
    }
    if (!coverageCol.trim()) {
      setFormError('The coverage/status column is required.')
      return
    }
    setFormError(null)
    onSubmit({ settlementFile, campaignDayCol: campaignDayCol.trim(), coverageCol: coverageCol.trim() })
  }

  const canSubmit = !!settlementFile && !!campaignDayCol.trim() && !!coverageCol.trim() && !submitting
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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Run settings</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Upload a settlement list carrying a day-of-activity column and a coverage/status column — one Daily and one
        Cumulative summary pie chart, plus one Daily and one Cumulative LGA-breakdown bar chart, get generated per
        state.
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FileDropzone label="Settlement list (.csv / .xlsx)" accept=".csv,.xlsx,.xls" file={settlementFile} onChange={handleFileChange} fillWidth />

        <div style={fieldStyle}>
          <label style={labelStyle}>Day column (campaign_day_col)</label>
          {useFreeText ? (
            <input
              type="text"
              value={campaignDayCol}
              onChange={(e) => setCampaignDayCol(e.target.value)}
              placeholder="e.g. Day 4"
              style={{ ...selectStyle, minWidth: 180 }}
            />
          ) : (
            <select value={campaignDayCol} onChange={(e) => setCampaignDayCol(e.target.value)} style={{ ...selectStyle, minWidth: 180 }}>
              <option value="">Choose a column…</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Coverage column (coverage_col)</label>
          {useFreeText ? (
            <input
              type="text"
              value={coverageCol}
              onChange={(e) => setCoverageCol(e.target.value)}
              placeholder="e.g. Settlement Coverage"
              style={{ ...selectStyle, minWidth: 220 }}
            />
          ) : (
            <select value={coverageCol} onChange={(e) => setCoverageCol(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
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
