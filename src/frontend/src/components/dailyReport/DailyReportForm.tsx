import { useState } from 'react'
import type { FormEvent } from 'react'
import type { DailyReportFormInput } from '../../types/dailyReport'
import { findDayOfActivityColumn, findCumulativeColumn, extractDayNumber } from '../../utils/columns'
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
const NONE_OPTION = ''

/**
 * Upload form for POST /reports/daily. `settlement_list` is the only real
 * file upload; `campaign_day_col`/`cumulative_day_col` are Query params on
 * the real route (see api/client.ts::submitDailyReport) — collected here the
 * same way regardless, same convention as every other form in this app.
 *
 * Both column pickers are populated from the UPLOADED FILE'S OWN HEADERS
 * (utils/dailyReport.ts::readSettlementListHeaders), read client-side the
 * moment a file is chosen — not typed blind, and not a fixed illustrative
 * list. Defaults: Day column defaults to the first header matching /\bday\b/i
 * (utils/columns.ts::findDayOfActivityColumn — the same heuristic the H2H
 * page already uses for its own day-of-activity column); once a Day column
 * is picked, the Cumulative column defaults to whatever
 * findCumulativeColumn guesses from it (a "day_{N}_cumm"-shaped header,
 * N taken from the Day column's own name via extractDayNumber). Either
 * default can be overridden, and either field can be left at "None" — the
 * form only requires at least one, matching the real route's own validation.
 *
 * Falls back to free-text inputs when header detection finds nothing (an
 * unsupported extension, or an unreadable file) — never blocks entry on a
 * client-side parse failure the real backend wouldn't itself be bothered by.
 */
export default function DailyReportForm({ onSubmit, submitting }: DailyReportFormProps) {
  const [settlementFile, setSettlementFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [campaignDayCol, setCampaignDayCol] = useState<string>(NONE_OPTION)
  const [cumulativeDayCol, setCumulativeDayCol] = useState<string>(NONE_OPTION)
  const [formError, setFormError] = useState<string | null>(null)
  const [headerReadError, setHeaderReadError] = useState<string | null>(null)

  async function handleFileChange(file: File | null) {
    setSettlementFile(file)
    setCampaignDayCol(NONE_OPTION)
    setCumulativeDayCol(NONE_OPTION)
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
      if (dayDefault) {
        setCampaignDayCol(dayDefault)
        const dayNumber = extractDayNumber(dayDefault)
        if (dayNumber !== null) {
          const cummDefault = findCumulativeColumn(fileHeaders, dayNumber)
          if (cummDefault) setCumulativeDayCol(cummDefault)
        }
      }
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
    if (!campaignDayCol && !cumulativeDayCol) {
      setFormError('Choose at least one of the Day column or Cumulative column.')
      return
    }
    setFormError(null)
    onSubmit({
      settlementFile,
      campaignDayCol: campaignDayCol || null,
      cumulativeDayCol: cumulativeDayCol || null,
    })
  }

  const canSubmit = !!settlementFile && (!!campaignDayCol || !!cumulativeDayCol) && !submitting
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
        Upload a settlement list carrying a day-of-activity column, a cumulative-status column, or both — at least one
        is required (the real route rejects a request with neither).
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
              <option value={NONE_OPTION}>None</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Cumulative column (cumulative_day_col)</label>
          {useFreeText ? (
            <input
              type="text"
              value={cumulativeDayCol}
              onChange={(e) => setCumulativeDayCol(e.target.value)}
              placeholder="e.g. day_4_cumm"
              style={{ ...selectStyle, minWidth: 180 }}
            />
          ) : (
            <select value={cumulativeDayCol} onChange={(e) => setCumulativeDayCol(e.target.value)} style={{ ...selectStyle, minWidth: 180 }}>
              <option value={NONE_OPTION}>None</option>
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
