import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SettlementCoverageCategory, SettlementRecord, VisitationStatus } from '../../types/h2h'
import type { DetectedColumns } from '../../utils/columns'
import { COVERAGE_COLORS, UNKNOWN_COLOR, VISITATION_COLORS } from '../../utils/colors'
import Pager from '../common/Pager'

interface SettlementListTableProps {
  // Already fully scoped/filtered by H2HTrackingPage — State/LGA/Ward drill
  // AND any active coverage/visitation filter, from whichever source set it
  // (a card, a chart legend/segment/axis click, or the selects below). This
  // table does no filtering of its own any more — see the comment above the
  // component for why that changed.
  records: SettlementRecord[]
  columns: DetectedColumns
  cumColumn: string
  coverageColumn?: string
  timeSpentColumn?: string
  // State/LGA/Ward/Visitation/Coverage are ALL owned by H2HTrackingPage now,
  // not this table — picking any one of them also drives the two breakdown
  // charts and every title card above (see H2HTrackingPage.tsx), so they
  // have to live where those do. The *Options arrays come from the page too:
  // stateOptions from the full result; lgaOptions narrowed to whichever
  // state (if any) is picked; wardOptions narrowed to whichever state+LGA
  // are picked; visitationOptions/coverageOptions narrowed to the current
  // State/LGA/Ward scope (only statuses/categories that actually occur
  // there are offered).
  filterState: string | null
  filterLga: string | null
  filterWard: string | null
  filterVisitation: VisitationStatus | null
  filterCoverage: SettlementCoverageCategory | null
  onFilterStateChange: (state: string | null) => void
  onFilterLgaChange: (lga: string | null) => void
  onFilterWardChange: (ward: string | null) => void
  onFilterVisitationChange: (status: VisitationStatus | null) => void
  onFilterCoverageChange: (category: SettlementCoverageCategory | null) => void
  stateOptions: string[]
  lgaOptions: string[]
  wardOptions: string[]
  visitationOptions: VisitationStatus[]
  coverageOptions: SettlementCoverageCategory[]
  // totalCount is the State/LGA/Ward-scoped count before Visitation/Coverage
  // narrow it further (records is already both) — shown as "N of M
  // settlements", same convention as MlosQcPage's table.
  totalCount?: number
  // When set, a card or chart segment click (rather than one of the selects
  // above) is what's currently narrowing `records` further — show what's
  // active and let the user clear it from here too, not just by re-clicking
  // the source.
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
// This table's State/LGA/Ward/Visitation/Coverage filter row used to be a
// mix: State/LGA were controlled by H2HTrackingPage (since picking either
// drove the page's drill-down) while Ward/Visitation/Coverage stayed local
// to this component, cascading on top of whatever `records` the page had
// already scoped to. That meant a Ward/Visitation/Coverage pick only ever
// narrowed what THIS table showed — it never reached the title cards or the
// two breakdown charts above, which is exactly the gap the page's full
// cross-filtering (every element interactive with every other) needed
// closed. All five are page-controlled props now, the same convention as
// MlosQcPage's settlement table.
export default function SettlementListTable({
  records,
  columns,
  cumColumn,
  coverageColumn = 'Settlement Coverage',
  timeSpentColumn = 'Time Spent',
  filterState,
  filterLga,
  filterWard,
  filterVisitation,
  filterCoverage,
  onFilterStateChange,
  onFilterLgaChange,
  onFilterWardChange,
  onFilterVisitationChange,
  onFilterCoverageChange,
  stateOptions,
  lgaOptions,
  wardOptions,
  visitationOptions,
  coverageOptions,
  totalCount,
  filterDescription,
  onClearFilter,
  bare,
}: SettlementListTableProps) {
  const [page, setPage] = useState(0)
  const shownTotal = totalCount ?? records.length
  const hasActiveFilter = Boolean(filterState || filterLga || filterWard || filterVisitation || filterCoverage)

  function clearAllFilters() {
    onFilterStateChange(null)
    onFilterLgaChange(null)
    onFilterWardChange(null)
    onFilterVisitationChange(null)
    onFilterCoverageChange(null)
    onClearFilter?.()
  }

  // A new filter selection (from the page above, or from this table's own
  // selects) should land on page 1 of the filtered set, not wherever the
  // user happened to be scrolled to before selecting it.
  useEffect(() => {
    setPage(0)
  }, [filterDescription, filterState, filterLga, filterWard, filterVisitation, filterCoverage])

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageRecords = useMemo(
    () => records.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [records, clampedPage],
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
            onChange={(e) => onFilterStateChange(e.target.value || null)}
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
            onChange={(e) => onFilterLgaChange(e.target.value || null)}
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
        <div>
          <label style={filterLabelStyle}>Visitation</label>
          <select
            style={selectStyle}
            value={filterVisitation ?? ''}
            onChange={(e) => onFilterVisitationChange((e.target.value || null) as VisitationStatus | null)}
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
            onChange={(e) => onFilterCoverageChange((e.target.value || null) as SettlementCoverageCategory | null)}
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
