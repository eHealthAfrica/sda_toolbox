import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { CsvButton, cardStyle, monoStyle } from './deviceTrackingShared'

export interface LineColumn<Row> {
  label: string
  align?: 'left' | 'right'
  mono?: boolean
  render: (row: Row) => ReactNode
}

interface DeviceLineListTableProps<Row> {
  title: string
  blurb: string
  summary: string
  columns: LineColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  // The CSV of just the rows on the page being looked at, and of every row.
  onCsvPage: (pageRows: Row[], page: number) => void
  onCsvAll: () => void
  csvLabel: string
}

export const LINE_LIST_PAGE_SIZE = 15

const thStyle: CSSProperties = {
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--color-text-muted)',
  background: 'var(--color-bg)',
  whiteSpace: 'nowrap',
}

const pageButton = (off: boolean): CSSProperties => ({
  minHeight: 32,
  padding: '0 12px',
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  border: '1px solid var(--color-border)',
  background: off ? 'var(--color-bg)' : 'var(--color-surface)',
  color: off ? 'var(--color-text-muted)' : 'var(--color-primary)',
  cursor: off ? 'default' : 'pointer',
})

// A paged line list (15 rows a page) under a short summary line — used for the
// invalid team codes and the code–device conflicts. Goes back to page 1
// whenever the row set changes (area, date range or filter moved). "This page"
// downloads the rows on screen; "Full table" downloads them all.
export default function DeviceLineListTable<Row>({ title, blurb, summary, columns, rows, rowKey, onCsvPage, onCsvAll, csvLabel }: DeviceLineListTableProps<Row>) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [rows])

  const totalPages = Math.max(1, Math.ceil(rows.length / LINE_LIST_PAGE_SIZE))
  const clamped = Math.min(page, totalPages - 1)
  const from = clamped * LINE_LIST_PAGE_SIZE
  const pageRows = useMemo(() => rows.slice(from, from + LINE_LIST_PAGE_SIZE), [rows, from])

  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{blurb}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <CsvButton label={`Download this page of ${csvLabel} as CSV`} text="This page (CSV)" onClick={() => onCsvPage(pageRows, clamped + 1)} />
          <button
            type="button"
            onClick={onCsvAll}
            aria-label={`Download all ${csvLabel} as CSV`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none', padding: '6px 12px', border: 0, background: 'var(--color-primary)', color: '#fff', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            ⬇ Full table · {rows.length.toLocaleString('en-US')} rows
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{summary}</div>
      {rows.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.label} scope="col" style={{ ...thStyle, textAlign: c.align ?? 'left' }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={rowKey(row, from + i)} style={{ borderTop: '1px solid var(--color-border)', verticalAlign: 'top' }}>
                    {columns.map((c) => (
                      <td key={c.label} style={{ padding: '9px 12px', textAlign: c.align ?? 'left', whiteSpace: 'pre-line', ...(c.mono ? monoStyle : {}) }}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > LINE_LIST_PAGE_SIZE && (
            <nav aria-label={`${title} pages`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 10, fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              <span>
                Rows {from + 1}–{Math.min(from + LINE_LIST_PAGE_SIZE, rows.length)} of {rows.length.toLocaleString('en-US')} · page {clamped + 1} of {totalPages}
              </span>
              <button type="button" onClick={() => setPage(Math.max(0, clamped - 1))} disabled={clamped === 0} style={pageButton(clamped === 0)}>
                Previous
              </button>
              <button type="button" onClick={() => setPage(Math.min(totalPages - 1, clamped + 1))} disabled={clamped >= totalPages - 1} style={pageButton(clamped >= totalPages - 1)}>
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  )
}
