import { useState } from 'react'
import type { FormEvent } from 'react'
import FileDropzone from '../common/FileDropzone'
import { findDayOfActivityColumn, findTeamColumn } from '../../utils/columns'
import { readDipFileHeaders } from '../../utils/dipGeneratorParse'

interface DipGeneratorFormProps {
  onSubmit: (
    dipFile: File,
    validateDip: boolean,
    teamAllocationFile: File | null,
    batchSize: number,
    teamColumn: string | null,
    dayColumn: string | null,
  ) => void
  submitting: boolean
}

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 5 }
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

// Upload form for POST /dip/generator — a compiled DIP, an optional
// validate_dip toggle (which requires a Team Allocation file when on — see
// the top-of-file comment in DipGeneratorPage.tsx: turning this on crashes
// every batch with a KeyError rather than actually validating anything, so
// use Microplan · Validate DIP for real validation instead), a client-only
// "LGAs per batch" control that drives the batching workaround in
// utils/dipGeneratorParse.ts (not a real backend parameter), and the Team /
// Day-of-activity column pickers below.
//
// Those two pickers are populated from the UPLOADED FILE'S OWN HEADERS
// (utils/dipGeneratorParse.ts::readDipFileHeaders, read client-side the
// moment a file is chosen), same pattern as DailyReportForm's Day/
// Cumulative pickers. Each defaults to whatever findTeamColumn/
// findDayOfActivityColumn auto-detects, but is freely overridable — added
// specifically because that auto-detect is a narrow rule (e.g. a column
// named "Days" rather than "Day" won't match the regex) with previously no
// way to correct it. Neither column is a real /dip/generator parameter —
// both only sharpen this page's OWN client-side ingest note and per-team
// "Days" display (see buildIngestNote/buildAnalysis); the backend
// independently re-detects the day column itself when it actually
// generates PDFs, so an override here can't change what rows the backend
// drops, only how accurately this page predicts it.
export default function DipGeneratorForm({ onSubmit, submitting }: DipGeneratorFormProps) {
  const [dipFile, setDipFile] = useState<File | null>(null)
  const [validateDip, setValidateDip] = useState(false)
  const [teamAllocationFile, setTeamAllocationFile] = useState<File | null>(null)
  const [batchSize, setBatchSize] = useState(3)
  const [headers, setHeaders] = useState<string[]>([])
  const [teamColumn, setTeamColumn] = useState<string>(NONE_OPTION)
  const [dayColumn, setDayColumn] = useState<string>(NONE_OPTION)
  const [headerReadError, setHeaderReadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleFileChange(file: File | null) {
    setDipFile(file)
    setTeamColumn(NONE_OPTION)
    setDayColumn(NONE_OPTION)
    setHeaderReadError(null)
    if (!file) {
      setHeaders([])
      return
    }
    try {
      const fileHeaders = await readDipFileHeaders(file)
      setHeaders(fileHeaders)
      if (fileHeaders.length === 0) {
        setHeaderReadError('Could not read column headers from this file client-side — enter the column names below directly.')
        return
      }
      setTeamColumn(findTeamColumn(fileHeaders) ?? NONE_OPTION)
      setDayColumn(findDayOfActivityColumn(fileHeaders) ?? NONE_OPTION)
    } catch {
      setHeaders([])
      setHeaderReadError('Could not read column headers from this file client-side — enter the column names below directly.')
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!dipFile) {
      setFormError('A compiled DIP file is required.')
      return
    }
    if (validateDip && !teamAllocationFile) {
      setFormError('A Team Allocation file is required when validation is switched on.')
      return
    }
    setFormError(null)
    onSubmit(dipFile, validateDip, validateDip ? teamAllocationFile : null, batchSize, teamColumn || null, dayColumn || null)
  }

  const canSubmit = !!dipFile && (!validateDip || !!teamAllocationFile) && !submitting
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
        Upload the compiled DIP. Turn on validation to also require the ward Team Allocation file — see the design
        note below before relying on that toggle for anything.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FileDropzone label="DIP / Settlements file (.csv / .xlsx)" accept=".csv,.xlsx,.xls" file={dipFile} onChange={handleFileChange} fillWidth />
        {validateDip && (
          <FileDropzone
            label="Team Allocation file (.xlsx / .csv)"
            accept=".csv,.xlsx,.xls"
            file={teamAllocationFile}
            onChange={setTeamAllocationFile}
            fillWidth
          />
        )}
        <div style={fieldStyle}>
          <label style={labelStyle}>Team column</label>
          {useFreeText ? (
            <input
              type="text"
              value={teamColumn}
              onChange={(e) => setTeamColumn(e.target.value)}
              placeholder="e.g. Team Code"
              style={{ ...selectStyle, minWidth: 160 }}
            />
          ) : (
            <select value={teamColumn} onChange={(e) => setTeamColumn(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
              <option value={NONE_OPTION}>Not set</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Day-of-activity column</label>
          {useFreeText ? (
            <input
              type="text"
              value={dayColumn}
              onChange={(e) => setDayColumn(e.target.value)}
              placeholder="e.g. Day"
              style={{ ...selectStyle, minWidth: 160 }}
            />
          ) : (
            <select value={dayColumn} onChange={(e) => setDayColumn(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
              <option value={NONE_OPTION}>Not set</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>LGAs per batch</label>
          <select value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} style={{ ...selectStyle, minWidth: 130 }}>
            <option value={1}>1</option>
            <option value={3}>3 (default)</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={9999}>All (single request)</option>
          </select>
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
          }}
        >
          {submitting ? 'Generating…' : 'Generate DIPs ▸'}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 3px' }}>
        <input
          type="checkbox"
          id="validateDipToggle"
          checked={validateDip}
          onChange={(e) => setValidateDip(e.target.checked)}
          style={{ width: 15, height: 15, cursor: 'pointer' }}
        />
        <label htmlFor="validateDipToggle" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer' }}>
          Validate against Team Allocation before generating (validate_dip)
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
        Off by default. Switching this on requires the Team Allocation upload above — see the design note for why it
        doesn't otherwise change what you get back.
      </div>
      {headerReadError && <div style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 11.5 }}>{headerReadError}</div>}
      {dipFile && !headerReadError && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
          Team/Day-of-activity columns are auto-filled from the file above (override if the guess looks wrong) — they
          only sharpen the ingest note and per-team "Days" column below, not what actually gets generated.
        </div>
      )}
      {formError && <div style={{ marginTop: 10, color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
