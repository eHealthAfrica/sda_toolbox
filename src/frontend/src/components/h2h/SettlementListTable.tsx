import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SettlementCoverageCategory, SettlementRecord, VisitationStatus } from '../../types/h2h'
import { SETTLEMENT_COVERAGE_CATEGORIES, VISITATION_STATUSES } from '../../types/h2h'
import type { DetectedColumns } from '../../utils/columns'
import { uniqueColumnValues } from '../../utils/aggregate'
import { COVERAGE_COLORS, UNKNOWN_COLOR, VISITATION_COLORS } from '../../utils/colors'
import Pager from '../common/Pager'

interface SettlementListTableProps {
  records: SettlementRecord[]
  columns: DetectedColumns
  cumColumn: string
  coverageColumn?: string
  timeSpentColumn?: string
  // State/LGA are owned by H2HTrackingPage, not this table — picking either
  // one here also drives the drill-down on the two breakdown charts and the
  // summary/coverage/visitation cards above (see H2HTrackingPage.tsx), so
  // they have to live where those do. stateOptions/lgaOptions come from the
  // page too, built from the full (undrilled) result so every state stays
  // selectable no matter what's currently picked, with lgaOptions narrowed
  // to whichever state (if any) is selected.
  filterState: string | null
  filterLga: string | null
  onFilterStateChange: (state: string | null) => void
  onFilterLgaChange: (lga: string | null) => void
  stateOptions: string[]
  lgaOptions: string[]
  // When set, records has already been filtered by a chart/card selection
  // above (H2HTrackingPage owns the filter state) — show what's active and
  // let the user clear it from here too, not just by re-clicking the source.
  filterDescription?: string | null
  onClearFilter?: () => void
  // When true, skip this component's own outer card (background/border/
  // shadow/padding) — used when a parent (TabbedPanel) already supplies one
  // shared frame for this and a sibling view (see H2HTrackingPage.tsx).
  bare?: boolean
}

const PAGE_SIZE = 20

function cellValue(record: SettlementRecord, column: string | null): string {
  if (!column) return '—'
  const raw = record[column]
  if (raw === null || raw === undefined || raw === '') return '—'
  return String(raw)
}

function Dot({ color, outline }: { color: string; outline?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        border: outline ? '1px solid #d9a7a7' : 'none',
        marginRight: 6,
      }}
    />
  )
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
  whiteSpace: 'nowrap',
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

// Row-level companion to the map/cards above — same columns the user asked
// for: state, LGA, ward, settlement name, visitation (the day_{N}_cumm
// column, same one the map/cards use), Settlement Coverage, and Time Spent
// (both backend-computed exact-named columns —
// toolbox/campaign/campaign_tools.py::classify_results — not fuzzy-detected
// like state/LGA/ward/settlement, which come from whatever the uploaded DIP
// file called them).
//
// This table also has a State/LGA/Ward/Visitation/Coverage filter row. State
// and LGA are controlled from H2HTrackingPage (see the props above) since
// picking either one drives the page's drill-down; Ward/Visitation/Coverage
// stay local to the table, cascading on top of whatever `records` the page
// has already scoped to (mirroring PostImplementationChartTable's State/LGA
// filter pattern for the controlled half).
export default function SettlementListTable({
  records,
  columns,
  cumColumn,
  coverageColumn = 'Settlement Coverage',
  timeSpentColumn = 'Time Spent',
  filterState,
  filterLga,
  onFilterStateChange,
  onFilterLgaChange,
  stateOptions,
  lgaOptions,
  filterDescription,
  onClearFilter,
  bare,
}: SettlementListTableProps) {
  const [page, setPage] = useState(0)
  const [filterWard, setFilterWard] = useState<string | null>(null)
  const [filterVisitation, setFilterVisitation] = useState<VisitationStatus | null>(null)
  const [filterCoverage, setFilterCoverage] = useState<SettlementCoverageCategory | null>(null)

  // `records` already reflects the page's State/LGA drill scope, so only
  // Ward/Visitation/Coverage need to cascade locally from here.
  const wardOptions = useMemo(() => uniqueColumnValues(records, columns.ward), [records, columns.ward])

  const afterWard = useMemo(
    () => (filterWard && columns.ward ? records.filter((r) => cellValue(r, columns.ward) === filterWard) : records),
    [records, filterWard, columns.ward],
  )
  const visitationOptions = useMemo(() => {
    const present = new Set(uniqueColumnValues(afterWard, cumColumn))
    return VISITATION_STATUSES.filter((status) => present.has(status))
  }, [afterWard, cumColumn])

  const afterVisitation = useMemo(
    () => (filterVisitation ? afterWard.filter((r) => cellValue(r, cumColumn) === filterVisitation) : afterWard),
    [afterWard, filterVisitation, cumColumn],
  )
  const coverageOptions = useMemo(() => {
    const present = new Set(uniqueColumnValues(afterVisitation, coverageColumn))
    return SETTLEMENT_COVERAGE_CATEGORIES.filter((category) => present.has(category))
  }, [afterVisitation, coverageColumn])

  const filteredRecords = useMemo(
    () => (filterCoverage ? afterVisitation.filter((r) => cellValue(r, coverageColumn) === filterCoverage) : afterVisitation),
    [afterVisitation, filterCoverage, coverageColumn],
  )

  const hasActiveFilter = filterState || filterLga || filterWard || filterVisitation || filterCoverage

  function handleStateChange(state: string | null) {
    onFilterStateChange(state)
    setFilterWard(null)
  }
  function handleLgaChange(lga: string | null) {
    onFilterLgaChange(lga)
    setFilterWard(null)
  }
  function clearAllFilters() {
    onFilterStateChange(null)
    onFilterLgaChange(null)
    setFilterWard(null)
    setFilterVisitation(null)
    setFilterCoverage(null)
  }

  // A new filter selection (from the page above, or from this table's own
  // filter row) should land on page 1 of the filtered set, not wherever the
  // user happened to be scrolled to before selecting it.
  useEffect(() => {
    setPage(0)
  }, [filterDescription, filterState, filterLga, filterWard, filterVisitation, filterCoverage])

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageRecords = useMemo(
    () => filteredRecords.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [filteredRecords, clampedPage],
  )

  return (
    <div
      style={
        bare
          ? undefined
          : {
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-sm)',
              padding: 16,
              marginBottom: 24,
            }
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14 }}>Settlement list</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {filteredRecords.length.toLocaleString()} of {records.length.toLocaleString()} settlements
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
            onChange={(e) => setFilterWard(e.target.value || null)}
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
        <div>
          <label style={filterLabelStyle}>Visitation</label>
          <select
            style={selectStyle}
            value={filterVisitation ?? ''}
            onChange={(e) => setFilterVisitation((e.target.value || null) as VisitationStatus | null)}
            disabled={visitationOptions.length === 0}
          >
            <option value="">All statuses</option>
            {visitationOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>Coverage</label>
          <select
            style={selectStyle}
            value={filterCoverage ?? ''}
            onChange={(e) => setFilterCoverage((e.target.value || null) as SettlementCoverageCategory | null)}
            disabled={coverageOptions.length === 0}
          >
            <option value="">All coverage</option>
            {coverageOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={clearAllFilters}
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

      {filteredRecords.length === 0 ? (
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
                  <th style={thStyle}>Visitation</th>
                  <th style={thStyle}>Settlement Coverage</th>
                  <th style={thStyle}>Time Spent</th>
                </tr>
              </thead>
              <tbody>
                {pageRecords.map((record, i) => {
                  const visitation = cellValue(record, cumColumn)
                  const coverage = cellValue(record, coverageColumn)
                  const visitationColor = VISITATION_COLORS[visitation as VisitationStatus]
                  const coverageColor = COVERAGE_COLORS[coverage as SettlementCoverageCategory]
                  return (
                    <tr key={clampedPage * PAGE_SIZE + i}>
                      <td style={tdStyle}>{cellValue(record, columns.state)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.lga)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.ward)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.settlement)}</td>
                      <td style={tdStyle}>
                        {visitation !== '—' && (
                          <Dot color={visitationColor ?? UNKNOWN_COLOR} outline={visitation === 'Not Yet Visited'} />
                        )}
                        {visitation}
                      </td>
                      <td style={tdStyle}>
                        {coverage !== '—' && <Dot color={coverageColor ?? UNKNOWN_COLOR} />}
                        {coverage}
                      </td>
                      <td style={tdStyle}>{cellValue(record, timeSpentColumn)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager
            page={clampedPage}
            totalPages={totalPages}
            totalCount={filteredRecords.length}
            pageCount={pageRecords.length}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />
        </>
      )}
    </div>
  )
}
