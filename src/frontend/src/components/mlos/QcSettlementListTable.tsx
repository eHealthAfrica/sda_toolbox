import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MlosRecord, ValidationStatus } from '../../types/mlos'
import { QC_ISSUE_FLAGS } from '../../types/mlos'
import { UNKNOWN_COLOR, VALIDATION_STATUS_COLORS } from '../../utils/colors'
import type { DetectedColumns } from '../../utils/columns'
import Pager from '../common/Pager'

interface QcSettlementListTableProps {
  records: MlosRecord[]
  columns: DetectedColumns
  // Full count before the current issue/status/proximity chart filter is
  // applied (records is already scoped by State/LGA/Ward at that point) —
  // shown as "N of M settlements" the same way H2H's SettlementListTable
  // does. Defaults to records.length so an older caller that doesn't pass
  // it still renders sensibly.
  totalCount?: number
  // State/LGA/Ward are all owned by MlosQcPage, not this table — picking
  // any one of them also drives FlagBreakdownChart's drill level and the
  // title cards above (see MlosQcPage.tsx), so they have to live where
  // those do. stateOptions/lgaOptions/wardOptions come from the page too,
  // cascading: lgaOptions narrowed to whichever state (if any) is picked,
  // wardOptions narrowed to whichever state+LGA are picked.
  filterState: string | null
  filterLga: string | null
  filterWard: string | null
  onFilterStateChange: (state: string | null) => void
  onFilterLgaChange: (lga: string | null) => void
  onFilterWardChange: (ward: string | null) => void
  stateOptions: string[]
  lgaOptions: string[]
  wardOptions: string[]
  // When set, records has already been further filtered by an issue/status/
  // proximity chart selection above (MlosQcPage owns that filter state) —
  // show what's active and let the user clear it from here too, not just by
  // re-clicking the source.
  filterDescription?: string | null
  onClearFilter?: () => void
}

const PAGE_SIZE = 50

function cellValue(record: MlosRecord, column: string | null): string {
  if (!column) return '—'
  const raw = record[column]
  if (raw === null || raw === undefined || raw === '') return '—'
  return String(raw)
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
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

// Row-level companion to the cards/charts above, for actually working the
// flagged-record queue rather than just reading aggregate counts. The
// State/LGA/Ward selects below double as the page's drill controls — see
// the filterState/filterLga/filterWard prop comments above.
export default function QcSettlementListTable({
  records,
  columns,
  totalCount,
  filterState,
  filterLga,
  filterWard,
  onFilterStateChange,
  onFilterLgaChange,
  onFilterWardChange,
  stateOptions,
  lgaOptions,
  wardOptions,
  filterDescription,
  onClearFilter,
}: QcSettlementListTableProps) {
  const [page, setPage] = useState(0)
  const shownTotal = totalCount ?? records.length
  const hasDrillFilter = Boolean(filterState || filterLga || filterWard)

  function handleStateChange(state: string | null) {
    onFilterStateChange(state)
  }
  function handleLgaChange(lga: string | null) {
    onFilterLgaChange(lga)
  }
  function clearDrillFilters() {
    onFilterStateChange(null)
    onFilterLgaChange(null)
    onFilterWardChange(null)
  }

  // A new filter selection — the chart-driven chip below, or the State/LGA/
  // Ward selects here — should land on page 1 of the filtered set, not
  // wherever the user happened to be scrolled to before selecting it.
  useEffect(() => {
    setPage(0)
  }, [filterDescription, filterState, filterLga, filterWard])

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageRecords = useMemo(
    () => records.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [records, clampedPage],
  )

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
        <h3 style={{ fontSize: 14 }}>Settlement list</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {records.length.toLocaleString()} of {shownTotal.toLocaleString()} settlements
        </div>
      </div>

      {filterDescription && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#eaf1fb',
            border: '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
            fontSize: 11.5,
            color: 'var(--color-primary)',
            marginBottom: 12,
          }}
        >
          <span>
            Filtered to <b>{filterDescription}</b>
          </span>
          {onClearFilter && (
            <button
              type="button"
              onClick={onClearFilter}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: 'var(--color-primary)',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <label style={filterLabelStyle}>State</label>
          <select
            style={selectStyle}
            value={filterState ?? ''}
            onChange={(e) => handleStateChange(e.target.value || null)}
            disabled={stateOptions.length === 0}
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
          <select
            style={selectStyle}
            value={filterLga ?? ''}
            onChange={(e) => handleLgaChange(e.target.value || null)}
            disabled={lgaOptions.length === 0}
          >
            <option value="">All LGAs</option>
            {lgaOptions.map((lga) => (
              <option key={lga} value={lga}>
                {lga}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>Ward</label>
          <select
            style={selectStyle}
            value={filterWard ?? ''}
            onChange={(e) => onFilterWardChange(e.target.value || null)}
            disabled={wardOptions.length === 0}
          >
            <option value="">All wards</option>
            {wardOptions.map((ward) => (
              <option key={ward} value={ward}>
                {ward}
              </option>
            ))}
          </select>
        </div>
        {hasDrillFilter && (
          <button
            type="button"
            onClick={clearDrillFilters}
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

      {records.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No settlements match the current filters.
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
                  <th style={thStyle}>Validation Status</th>
                  <th style={thStyle}>Flagged</th>
                  <th style={thStyle}>Issues</th>
                </tr>
              </thead>
              <tbody>
                {pageRecords.map((record, i) => {
                  const status = cellValue(record, 'validation_status')
                  const statusColor = VALIDATION_STATUS_COLORS[status as ValidationStatus]
                  const flagged = isPresent(record.is_flagged)
                  const issues = QC_ISSUE_FLAGS.filter((flag) => isPresent(record[flag.key])).map((flag) => flag.label)
                  return (
                    <tr key={clampedPage * PAGE_SIZE + i}>
                      <td style={tdStyle}>{cellValue(record, columns.state)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.lga)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.ward)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.settlement)}</td>
                      <td style={tdStyle}>
                        {status !== '—' && (
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: statusColor ?? UNKNOWN_COLOR,
                              marginRight: 6,
                            }}
                          />
                        )}
                        {status}
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            color: flagged ? 'var(--color-critical)' : 'var(--color-text-muted)',
                            fontWeight: flagged ? 600 : 400,
                          }}
                        >
                          {flagged ? 'Flagged' : '—'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                        {issues.length ? issues.join(', ') : '—'}
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
            totalCount={records.length}
            pageCount={pageRecords.length}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />
        </>
      )}
    </div>
  )
}
