import { useMemo, useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { PostReport } from '../../types/postImplementation'
import { downloadReportImage } from '../../utils/plotlyExport'
import Pager from '../common/Pager'

interface PostImplementationChartTableProps {
  // Already narrowed to one level (lga summary or ward breakdown) by the
  // page — this table only ever renders one level at a time, one instance
  // per TabbedPanel tab.
  reports: PostReport[]
  levelLabel: string
  // State/LGA filter options are built from the FULL (both-level) report set
  // by the page, not just this table's own `reports` — so switching tabs
  // never changes what's selectable, and the two tables + the gallery below
  // always agree on what's in scope.
  stateOptions: string[]
  lgaOptions: string[]
  filterState: string | null
  filterLga: string | null
  onFilterStateChange: (state: string | null) => void
  onFilterLgaChange: (lga: string | null) => void
  // Clicking a row sets both filters to that row's state+LGA in one step —
  // an additional, quicker path to the same selection the dropdowns drive.
  onRowSelect: (state: string, lga: string) => void
  bare?: boolean
}

const PAGE_SIZE = 20

const selectStyle: CSSProperties = {
  padding: '5px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
}
const filterLabelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
  marginBottom: 3,
  display: 'block',
}
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
  fontSize: 12.5,
}

function reportKey(report: PostReport): string {
  return `${report.state}__${report.lga}__${report.level}`
}

/**
 * One table of generated reports (State / LGA / Save name / download), with
 * its own State + LGA filter row — reused for both the "Summary charts" and
 * "Breakdown charts" TabbedPanel tabs on PostImplementationPage.
 * The State/LGA filters here are NOT independent per-table narrowing (unlike
 * e.g. ContactSettlementListTable's own self-contained filters) — they're
 * the page's single shared State/LGA selection, which also drives the
 * gallery below, per the user's spec that "selecting an lga on the table
 * should display all corresponding charts relating to the lga" (same for a
 * state). Both tabs' filter rows always show the same selection for that
 * reason.
 */
export default function PostImplementationChartTable({
  reports,
  levelLabel,
  stateOptions,
  lgaOptions,
  filterState,
  filterLga,
  onFilterStateChange,
  onFilterLgaChange,
  onRowSelect,
  bare,
}: PostImplementationChartTableProps) {
  const [page, setPage] = useState(0)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)

  async function handleDownload(report: PostReport) {
    const key = reportKey(report)
    setDownloadingKey(key)
    try {
      await downloadReportImage(report)
    } finally {
      setDownloadingKey((current) => (current === key ? null : current))
    }
  }

  const filteredReports = useMemo(
    () =>
      reports.filter(
        (report) => (!filterState || report.state === filterState) && (!filterLga || report.lga === filterLga),
      ),
    [reports, filterState, filterLga],
  )

  // Reset to page 0 whenever the filter scope or active tab's report set
  // changes, so a narrower filter never leaves the pager stranded past the
  // new last page.
  useEffect(() => {
    setPage(0)
  }, [filterState, filterLga, reports])

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageReports = useMemo(
    () => filteredReports.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [filteredReports, clampedPage],
  )

  const hasActiveFilter = filterState || filterLga

  return (
    <div style={bare ? undefined : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 16, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14 }}>{levelLabel} charts</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {filteredReports.length.toLocaleString()} of {reports.length.toLocaleString()}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <label style={filterLabelStyle}>State</label>
          <select
            style={selectStyle}
            value={filterState ?? ''}
            onChange={(e) => onFilterStateChange(e.target.value || null)}
          >
            <option value="">All states</option>
            {stateOptions.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>LGA</label>
          <select style={selectStyle} value={filterLga ?? ''} onChange={(e) => onFilterLgaChange(e.target.value || null)}>
            <option value="">All LGAs</option>
            {lgaOptions.map((lga) => (
              <option key={lga} value={lga}>
                {lga}
              </option>
            ))}
          </select>
        </div>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => {
              onFilterStateChange(null)
              onFilterLgaChange(null)
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '6px 0',
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {filteredReports.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No {levelLabel.toLowerCase()} charts match the current filters.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>State</th>
                  <th style={thStyle}>LGA</th>
                  <th style={thStyle}>Save name</th>
                  <th style={thStyle}>Download</th>
                </tr>
              </thead>
              <tbody>
                {pageReports.map((report) => (
                  <tr key={reportKey(report)} onClick={() => onRowSelect(report.state, report.lga)} style={{ cursor: 'pointer' }}>
                    <td style={tdStyle}>{report.state}</td>
                    <td style={tdStyle}>{report.lga}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{report.save_name}</td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        disabled={downloadingKey === reportKey(report)}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDownload(report)
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-primary)',
                          fontWeight: 600,
                          fontSize: 12.5,
                          cursor: downloadingKey === reportKey(report) ? 'default' : 'pointer',
                          opacity: downloadingKey === reportKey(report) ? 0.6 : 1,
                          padding: 0,
                        }}
                      >
                        {downloadingKey === reportKey(report) ? 'Generating…' : '⬇ Download PNG'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={clampedPage}
            totalPages={totalPages}
            totalCount={filteredReports.length}
            pageCount={pageReports.length}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />
        </>
      )}
    </div>
  )
}
