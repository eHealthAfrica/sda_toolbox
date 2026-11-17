import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ReachRecord, ReachVisitationStatus } from '../../types/reach'
import { REACH_VISITATION_STATUSES } from '../../types/reach'
import type { DetectedColumns } from '../../utils/columns'
import { REACH_VISITATION_COLORS, getReachCountColor } from '../../utils/colors'
import { cellText } from '../../utils/reachAggregate'
import Pager from '../common/Pager'

interface ReachSettlementListTableProps {
  // Already scoped by ReachAnalysisPage's State -> LGA drill (the same drill
  // the breadcrumb and every chart use). Ward / Visitation / Validated by are
  // narrowed here, locally, on top of that.
  records: ReachRecord[]
  columns: DetectedColumns
  // State and LGA are page-owned: picking either one here moves the page's
  // drill-down too, so the cards and charts above follow the table (and the
  // table follows a chart click) — same convention as H2H's
  // SettlementListTable. stateOptions come from the whole result; lgaOptions
  // from the picked state only (an LGA name alone isn't unique across states,
  // so the LGA select stays disabled until a state is chosen).
  filterState: string | null
  filterLga: string | null
  onFilterStateChange: (state: string | null) => void
  onFilterLgaChange: (lga: string | null) => void
  stateOptions: string[]
  lgaOptions: string[]
  sourcesColumn?: string
  visitationColumn?: string
  reachColumn?: string
  // When true, skip this component's own outer card (background/border/
  // shadow/padding) — used when a parent (TabbedPanel) already supplies one
  // shared frame for this and a sibling view (see ReachAnalysisPage.tsx).
  bare?: boolean
}

const PAGE_SIZE = 20

// Sentinel for the "Validated by" select: settlements no data source
// confirmed. toolbox/triangulate/ttools.py::populate_sources writes the
// literal '0' into `sources` for those rows (the same rows where `reach` is
// 0), so the real column value can't double as an option value.
const NO_SOURCE = '__none__'

// populate_sources joins source names with " | " — see
// utils/reachAggregate.ts::computeSourceCounts, which splits the same way.
function recordSources(record: ReachRecord, sourcesColumn: string): string[] {
  const raw = cellText(record, sourcesColumn)
  if (!raw || raw === '0') return []
  return raw
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean)
}

function cellValue(record: ReachRecord, column: string | null): string {
  if (!column) return '—'
  const raw = record[column]
  if (raw === null || raw === undefined || raw === '') return '—'
  return String(raw)
}

// `reach` (unlike the other columns here) is always numeric — PapaParse's
// dynamicTyping already converts "0"/"1"/"2"/"3" to real numbers — so this
// keeps the number around for getReachCountColor rather than round-tripping
// through cellValue's string coercion.
function reachValue(record: ReachRecord, column: string): number | null {
  const raw = record[column]
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

function Dot({ color }: { color: string }) {
  return (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6 }} />
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
}
const selectStyle: CSSProperties = {
  padding: '5px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  maxWidth: 190,
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

export default function ReachSettlementListTable({
  records,
  columns,
  filterState,
  filterLga,
  onFilterStateChange,
  onFilterLgaChange,
  stateOptions,
  lgaOptions,
  sourcesColumn = 'sources',
  visitationColumn = 'status',
  reachColumn = 'reach',
  bare,
}: ReachSettlementListTableProps) {
  const [page, setPage] = useState(0)
  const [filterWard, setFilterWard] = useState<string | null>(null)
  const [filterVisitation, setFilterVisitation] = useState<ReachVisitationStatus | null>(null)
  const [filterSource, setFilterSource] = useState<string | null>(null)

  // Options reflect the current State/LGA scope: only wards, statuses and
  // sources that actually occur in `records` are offered, so a pick can never
  // land on an empty list by itself.
  const wardOptions = useMemo(() => {
    if (!columns.ward) return []
    const seen = new Set<string>()
    for (const record of records) {
      const ward = cellText(record, columns.ward)
      if (ward) seen.add(ward)
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [records, columns.ward])

  const visitationOptions = useMemo(() => {
    const present = new Set<string>()
    for (const record of records) {
      const status = cellText(record, visitationColumn)
      if (status) present.add(status)
    }
    return REACH_VISITATION_STATUSES.filter((s) => present.has(s))
  }, [records, visitationColumn])

  const { sourceOptions, hasUnvalidated } = useMemo(() => {
    const seen = new Set<string>()
    let unvalidated = false
    for (const record of records) {
      const sources = recordSources(record, sourcesColumn)
      if (sources.length === 0) unvalidated = true
      for (const source of sources) seen.add(source)
    }
    return { sourceOptions: Array.from(seen).sort((a, b) => a.localeCompare(b)), hasUnvalidated: unvalidated }
  }, [records, sourcesColumn])

  // A drill change (state/LGA, from here or from a chart click) can leave a
  // previously-picked ward/status/source that no longer exists in the new
  // scope — drop it rather than showing an empty list behind a select that
  // can't display the stale value.
  useEffect(() => {
    if (filterWard && !wardOptions.includes(filterWard)) setFilterWard(null)
  }, [wardOptions, filterWard])
  useEffect(() => {
    if (filterVisitation && !visitationOptions.includes(filterVisitation)) setFilterVisitation(null)
  }, [visitationOptions, filterVisitation])
  useEffect(() => {
    if (!filterSource) return
    const stillThere = filterSource === NO_SOURCE ? hasUnvalidated : sourceOptions.includes(filterSource)
    if (!stillThere) setFilterSource(null)
  }, [sourceOptions, hasUnvalidated, filterSource])

  const filtered = useMemo(
    () =>
      records.filter((record) => {
        if (filterWard && cellText(record, columns.ward) !== filterWard) return false
        if (filterVisitation && cellText(record, visitationColumn) !== filterVisitation) return false
        if (filterSource) {
          const sources = recordSources(record, sourcesColumn)
          if (filterSource === NO_SOURCE) {
            if (sources.length > 0) return false
          } else if (!sources.includes(filterSource)) {
            return false
          }
        }
        return true
      }),
    [records, filterWard, filterVisitation, filterSource, columns.ward, visitationColumn, sourcesColumn],
  )

  const hasActiveFilter = Boolean(filterState || filterLga || filterWard || filterVisitation || filterSource)

  function clearAllFilters() {
    onFilterStateChange(null)
    onFilterLgaChange(null)
    setFilterWard(null)
    setFilterVisitation(null)
    setFilterSource(null)
  }

  // A new filter selection should land on page 1 of the filtered set, not
  // wherever the user happened to be scrolled to before selecting it.
  useEffect(() => {
    setPage(0)
  }, [filterState, filterLga, filterWard, filterVisitation, filterSource])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageRecords = useMemo(
    () => filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [filtered, clampedPage],
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14 }}>Settlement list</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {filtered.length.toLocaleString()} of {records.length.toLocaleString()} settlements
        </div>
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
            disabled={!filterState || lgaOptions.length === 0}
            title={!filterState ? 'Pick a state first' : undefined}
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
            onChange={(e) => setFilterVisitation((e.target.value || null) as ReachVisitationStatus | null)}
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
          <label style={filterLabelStyle}>Validated by</label>
          <select
            style={selectStyle}
            value={filterSource ?? ''}
            onChange={(e) => setFilterSource(e.target.value || null)}
            disabled={sourceOptions.length === 0 && !hasUnvalidated}
          >
            <option value="">All sources</option>
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
            {hasUnvalidated && <option value={NO_SOURCE}>No source (not validated)</option>}
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

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {records.length === 0 ? 'No settlements to list.' : 'No settlements match the current filters.'}
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
                  <th style={thStyle}>Visitation</th>
                  <th style={thStyle}>Reach</th>
                  <th style={thStyle}>Validated by</th>
                  {columns.population && <th style={thStyle}>Population</th>}
                </tr>
              </thead>
              <tbody>
                {pageRecords.map((record, i) => {
                  const visitation = cellValue(record, visitationColumn)
                  const visitationColor = REACH_VISITATION_COLORS[visitation as 'Visited' | 'Not Visited']
                  const sources = cellValue(record, sourcesColumn)
                  const reach = reachValue(record, reachColumn)
                  return (
                    <tr key={clampedPage * PAGE_SIZE + i}>
                      <td style={tdStyle}>{cellValue(record, columns.state)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.lga)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.ward)}</td>
                      <td style={tdStyle}>
                        {visitation !== '—' && <Dot color={visitationColor ?? '#9aa5b1'} />}
                        {visitation}
                      </td>
                      <td style={tdStyle}>
                        {reach !== null && <Dot color={getReachCountColor(reach)} />}
                        {reach !== null ? reach : '—'}
                      </td>
                      <td style={tdStyle}>{sources}</td>
                      {columns.population && <td style={tdStyle}>{cellValue(record, columns.population)}</td>}
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
            pageCount={pageRecords.length}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />
        </>
      )}
    </div>
  )
}
