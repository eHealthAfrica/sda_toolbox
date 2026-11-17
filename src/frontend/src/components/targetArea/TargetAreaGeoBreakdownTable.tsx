import type { CSSProperties } from 'react'
import type { TargetAreaGeoBreakdownEntry } from '../../utils/targetAreaAggregate'

interface TargetAreaGeoBreakdownTableProps {
  data: TargetAreaGeoBreakdownEntry[]
  // Full row count before the current State/LGA/Ward drill is applied — shown
  // as "N of M rows", same convention as QcSettlementListTable's totalCount.
  totalCount: number
  hasPlannedList: boolean
  // State/LGA/Ward are owned by TargetAreaPage, not this table — the same
  // drill also scopes the summary cards and volume chart above the table
  // (see TargetAreaPage.tsx), so it has to live where those do. stateOptions/
  // lgaOptions/wardOptions come from the page too, cascading: lgaOptions
  // narrowed to whichever state (if any) is picked, wardOptions narrowed to
  // whichever state+LGA are picked. Exact same prop shape as
  // QcSettlementListTable's own filterState/filterLga/filterWard props.
  filterState: string | null
  filterLga: string | null
  filterWard: string | null
  onFilterStateChange: (state: string | null) => void
  onFilterLgaChange: (lga: string | null) => void
  onFilterWardChange: (ward: string | null) => void
  stateOptions: string[]
  lgaOptions: string[]
  wardOptions: string[]
  // A fourth, independent dimension alongside State/LGA/Ward — whether a row
  // has any settlement on the uploaded planned list (row.hasPlannedSettlements
  // in `data`, computed by computeTargetAreaGeoBreakdown). Owned by
  // TargetAreaPage for the same reason the geo drill is: it also scopes the
  // summary cards and volume chart. Disabled (and left at "All locations")
  // when hasPlannedList is false — there's no planned data to filter by.
  filterLocationType: 'planned' | 'not-planned' | null
  onFilterLocationTypeChange: (value: 'planned' | 'not-planned' | null) => void
}

const TABLE_MAX_HEIGHT = 520
const HEADER_ROW_HEIGHT = 32

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: 11.5,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border)',
  height: HEADER_ROW_HEIGHT,
  boxSizing: 'border-box',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--color-surface)',
  whiteSpace: 'nowrap',
}
const numericThStyle: CSSProperties = { ...thStyle, textAlign: 'right' }

const tdStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: 12.5,
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}
const numericTdStyle: CSSProperties = { ...tdStyle, textAlign: 'right' }

// Same select/label styling as QcSettlementListTable.tsx's State/LGA/Ward
// drill controls, for visual consistency across the app's list tables.
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

// Replaces the old per-state voronoi/gridded bar charts (TargetAreaStateChart
// — see the "unused now" comment on TargetAreaStateEntry in
// targetAreaAggregate.ts) with one table, State + LGA + Ward per row — a
// level of drill-down a state-only bar chart couldn't show.
//
// Fully controlled — same "page owns the drill, table is a controlled view"
// convention as QcSettlementListTable/MlosQcPage and
// CoordinateReviewPage: State/LGA/Ward selection and the cascading option
// lists live in TargetAreaPage (see the prop comments above), because that
// same drill also scopes the summary cards and volume chart elsewhere on the
// page, not just this table's own rows. This replaces the previous version's
// row-click-to-filter-by-state affordance (activeState/onSelectState) and
// its own local useState filters — now redundant, since the dropdowns below
// do the same scoping job, page-wide and down to the ward level.
export default function TargetAreaGeoBreakdownTable({
  data,
  totalCount,
  hasPlannedList,
  filterState,
  filterLga,
  filterWard,
  onFilterStateChange,
  onFilterLgaChange,
  onFilterWardChange,
  stateOptions,
  lgaOptions,
  wardOptions,
  filterLocationType,
  onFilterLocationTypeChange,
}: TargetAreaGeoBreakdownTableProps) {
  const hasFilter = Boolean(filterState || filterLga || filterWard || filterLocationType)

  function clearFilters() {
    onFilterStateChange(null)
    onFilterLgaChange(null)
    onFilterWardChange(null)
    onFilterLocationTypeChange(null)
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
        <h3 style={{ fontSize: 14 }}>Target area coverage by state, LGA and ward</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {data.length.toLocaleString()} of {totalCount.toLocaleString()} rows
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
        Settlements is the unique state + LGA + ward + settlement count from the uploaded master list. Voronoi count
        is the unique settlements that got a voronoi TA; Gridded TA count is the total number of grid cells produced
        (a settlement can span several grid cells), not a settlement count. Location type filters to wards with (or
        without) any settlement on the uploaded planned list. These filters also scope the summary cards and volume
        chart above.
      </div>

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
          <label style={filterLabelStyle}>Location type</label>
          <select
            style={selectStyle}
            value={filterLocationType ?? ''}
            onChange={(e) => onFilterLocationTypeChange((e.target.value || null) as 'planned' | 'not-planned' | null)}
            disabled={!hasPlannedList}
          >
            <option value="">All locations</option>
            <option value="planned">Planned</option>
            <option value="not-planned">Not Planned</option>
          </select>
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={clearFilters}
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

      {totalCount === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No state/LGA/ward columns detected in the response.
        </div>
      ) : data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No rows match the current filters.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: TABLE_MAX_HEIGHT }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>State</th>
                <th style={thStyle}>LGA</th>
                <th style={thStyle}>Ward</th>
                <th style={numericThStyle}>Settlements</th>
                <th style={numericThStyle}>Voronoi count</th>
                <th style={numericThStyle}>Gridded TA count</th>
                <th style={numericThStyle}>Planned settlement voronoi count</th>
                <th style={numericThStyle}>Planned settlement gridded TA count</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={`${row.state}|${row.lga}|${row.ward}`}>
                  <td style={tdStyle}>{row.state || '—'}</td>
                  <td style={tdStyle}>{row.lga || '—'}</td>
                  <td style={tdStyle}>{row.ward || '—'}</td>
                  <td style={numericTdStyle}>{row.settlementCount.toLocaleString()}</td>
                  <td style={numericTdStyle}>{row.voronoiCount.toLocaleString()}</td>
                  <td style={numericTdStyle}>{row.griddedCount.toLocaleString()}</td>
                  <td style={numericTdStyle}>{hasPlannedList ? row.plannedVoronoiCount.toLocaleString() : '—'}</td>
                  <td style={numericTdStyle}>{hasPlannedList ? row.plannedGriddedCount.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
