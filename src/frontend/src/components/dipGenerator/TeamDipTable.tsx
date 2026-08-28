import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DipGeneratorAnalysis } from '../../types/dipGenerator'
import Pager from '../common/Pager'

interface TeamDipTableProps {
  analysis: DipGeneratorAnalysis
  onPreview: (filename: string) => void
  onDownload: () => void
  selectedFilename?: string | null
  // LGA filtering is lifted to DipGeneratorPage so DipGeneratorLgaChart's
  // bars can drive this table too — the select here still works standalone.
  lgaFilter: string
  onLgaFilterChange: (lga: string) => void
}

const PAGE_SIZE = 20

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--color-text-muted)',
  fontWeight: 600,
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}
const tdStyle: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 12,
  whiteSpace: 'nowrap',
}
const selectStyle: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 10px',
  fontSize: 12.5,
  background: '#fbfbfc',
  minWidth: 140,
}

// A full run can produce thousands of team PDFs (3,000+ in the illustrative
// Kebbi-scale scenario used during design), so — unlike DipMergerTable,
// where one row per LGA never needs pagination — this table paginates the
// same way ValidateRecordsTable does.
export default function TeamDipTable({
  analysis,
  onPreview,
  onDownload,
  selectedFilename,
  lgaFilter,
  onLgaFilterChange,
}: TeamDipTableProps) {
  const [page, setPage] = useState(0)

  const lgaOptions = useMemo(() => Array.from(new Set(analysis.teamDips.map((t) => t.lga))).sort(), [analysis.teamDips])

  const filtered = useMemo(
    () => analysis.teamDips.filter((t) => !lgaFilter || t.lga === lgaFilter),
    [analysis.teamDips, lgaFilter]
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px 18px',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Team DIPs ({analysis.totalTeams.toLocaleString()})</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <select
          style={selectStyle}
          value={lgaFilter}
          onChange={(e) => {
            onLgaFilterChange(e.target.value)
            setPage(0)
          }}
        >
          <option value="">LGA: All</option>
          {lgaOptions.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDownload}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-primary)',
            color: 'var(--color-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ⬇ Download all (DIP Output.zip)
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>LGA</th>
              <th style={thStyle}>Ward</th>
              <th style={thStyle}>Team</th>
              <th style={thStyle}>Output file</th>
              <th style={thStyle}>Pages</th>
              <th style={thStyle}>Day(s)</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((t) => {
              const active = selectedFilename === t.filename
              return (
                <tr
                  key={t.filename}
                  onClick={() => onPreview(t.filename)}
                  style={{ background: active ? '#eaf1fb' : undefined, cursor: 'pointer' }}
                >
                  <td style={tdStyle}>{t.lga}</td>
                  <td style={tdStyle}>{t.ward}</td>
                  <td style={tdStyle}>{t.teamCode}</td>
                  <td style={tdStyle}>{t.filename}</td>
                  <td style={tdStyle}>{t.pages.toLocaleString()}{t.pages > 1 && <span style={{ color: '#92680a' }}> ⚠</span>}</td>
                  <td style={tdStyle}>{t.days?.join(', ') ?? '—'}</td>
                  <td style={tdStyle}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onPreview(t.filename)
                      }}
                      style={{
                        display: 'inline-block',
                        padding: '1px 8px',
                        borderRadius: 20,
                        fontSize: 10.5,
                        fontWeight: 600,
                        background: active ? 'var(--color-good)' : '#e9f8e9',
                        color: active ? '#fff' : '#0ca30c',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {active ? '● Previewing' : 'Preview'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pager
        page={clampedPage}
        totalPages={totalPages}
        totalCount={filtered.length}
        pageCount={pageRows.length}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
      />
    </div>
  )
}
