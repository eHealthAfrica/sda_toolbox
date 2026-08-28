import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DatasetDiffResult } from '../../utils/datasetDiff'
import { downloadCsv } from '../../utils/csvExport'
import Pager from '../common/Pager'

interface MlosChangesTableProps {
  diff: DatasetDiffResult
}

const PAGE_SIZE = 50

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

function displayValue(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

// Tabular, field-level view of the diff computed in utils/datasetDiff.ts —
// one row per changed cell (not per changed record), since "what changed"
// is most directly answered at that granularity; the field filter narrows
// it back down to record-level browsing for a specific column.
export default function MlosChangesTable({ diff }: MlosChangesTableProps) {
  const [page, setPage] = useState(0)
  const [fieldFilter, setFieldFilter] = useState('')

  const fieldOptions = useMemo(
    () => Array.from(new Set(diff.fieldChanges.map((c) => c.field))).sort((a, b) => a.localeCompare(b)),
    [diff.fieldChanges],
  )

  const filtered = useMemo(
    () => (fieldFilter ? diff.fieldChanges.filter((c) => c.field === fieldFilter) : diff.fieldChanges),
    [diff.fieldChanges, fieldFilter],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageRows = useMemo(
    () => filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [filtered, clampedPage],
  )

  function handleDownload() {
    downloadCsv(
      'mlos_changes.csv',
      diff.fieldChanges.map((c) => ({
        state: c.state ?? '',
        lga: c.lga ?? '',
        ward: c.ward ?? '',
        settlement: c.settlement ?? '',
        field: c.field,
        old_value: c.oldValue ?? '',
        new_value: c.newValue ?? '',
      })),
    )
  }

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14 }}>Changes — input vs. output</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {diff.fieldChangeCount.toLocaleString()} changes across {diff.changedRowCount.toLocaleString()} records
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <select
          value={fieldFilter}
          onChange={(e) => {
            setFieldFilter(e.target.value)
            setPage(0)
          }}
          style={{ padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
        >
          <option value="">All fields ({diff.fieldChanges.length.toLocaleString()})</option>
          {fieldOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleDownload}
          style={{
            marginLeft: 'auto',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ⬇ Download changes CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {diff.fieldChanges.length === 0 ? 'No changes were detected between the input and output.' : 'No changes match this field filter.'}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>State</th>
                  <th style={thStyle}>LGA</th>
                  <th style={thStyle}>Ward</th>
                  <th style={thStyle}>Settlement</th>
                  <th style={thStyle}>Field</th>
                  <th style={thStyle}>Before</th>
                  <th style={thStyle}>After</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((change, i) => (
                  <tr key={clampedPage * PAGE_SIZE + i}>
                    <td style={tdStyle}>{displayValue(change.state)}</td>
                    <td style={tdStyle}>{displayValue(change.lga)}</td>
                    <td style={tdStyle}>{displayValue(change.ward)}</td>
                    <td style={tdStyle}>{displayValue(change.settlement)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{change.field}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-critical)' }}>{displayValue(change.oldValue)}</td>
                    <td style={{ ...tdStyle, color: '#0ca30c' }}>{displayValue(change.newValue)}</td>
                  </tr>
                ))}
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
        </>
      )}
    </div>
  )
}
