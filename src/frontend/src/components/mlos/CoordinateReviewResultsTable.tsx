import { Fragment, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AgreementStatus, CoordinateDecision, IndexedCoordinateRecord } from '../../types/coordinateReview'
import { DECISION_CENTROID, DECISION_KEEP, DECISION_MANUAL } from '../../types/coordinateReview'
import type { DetectedColumns } from '../../utils/columns'
import { toNumber } from '../../utils/columns'
import { analyzeRow, formatMeters, getSourceEvidence } from '../../utils/coordinateReviewAggregate'
import { sourceColor } from './CoordinateReviewSourcePanel'
import AgreementDiagram from './AgreementDiagram'
import Pager from '../common/Pager'

interface CoordinateReviewResultsTableProps {
  records: IndexedCoordinateRecord[]
  totalCount: number
  baselineColumns: string[]
  detected: DetectedColumns
  sourceNames: string[]
  activeSources: Set<string>
  decisions: Record<number, CoordinateDecision>
  onDecide: (idx: number, decision: CoordinateDecision) => void
  filterState: string | null
  filterLga: string | null
  filterWard: string | null
  onFilterStateChange: (v: string | null) => void
  onFilterLgaChange: (v: string | null) => void
  onFilterWardChange: (v: string | null) => void
  stateOptions: string[]
  lgaOptions: string[]
  wardOptions: string[]
  // Recommendation filter — separate from the geography drill above. Kept in
  // sync with the summary cards' click-to-filter behavior (both read/write
  // the same page-level filterStatus state), so picking a value here also
  // highlights the matching summary card and vice versa.
  filterStatus: AgreementStatus | null
  onFilterStatusChange: (v: AgreementStatus | null) => void
}

const RECOMMENDATION_OPTIONS: { value: AgreementStatus; label: string }[] = [
  { value: 'review', label: 'Needs review' },
  { value: 'consistent', label: 'Consistent with original' },
  { value: 'none', label: 'No consensus' },
]

const PAGE_SIZE = 50

// Bounds the table in its own scrollable panel (rather than letting the page
// itself scroll past a 50-row table) so the sticky header below actually has
// something to stick within — see the table wrapper div's overflowY.
const TABLE_MAX_HEIGHT = 600

// Fixed so the two-row header's exact pixel height is known up front — the
// second header row's sticky `top` offset (HEADER_ROW_HEIGHT below) depends
// on it, and every header cell already forces whiteSpace: 'nowrap' so this
// height never grows from wrapped text.
const HEADER_ROW_HEIGHT = 31

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
  height: HEADER_ROW_HEIGHT,
  boxSizing: 'border-box',
  // Sticky on every header cell (rather than just the <thead>, which older
  // Safari versions don't reliably stick) so the column headers stay in view
  // while scrolling through a long results list — see the wrapper div's
  // bounded height + overflowY below, which is what actually gives sticky
  // something to stick against. `background` is required here too: without
  // an opaque background, table body rows would show through the sticky
  // header as they scroll underneath it.
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--color-surface)',
}
// The second header row (per-source Sim%/Lat/Lon/... sub-columns) sticks
// just below the first row rather than at top: 0, so it doesn't overlap the
// first row's sticky cells (baseline columns, Agreement/Recommendation/
// Decision, and the per-source group headers — all of which occupy row 1,
// several of them via rowSpan={2} reaching down into row 2's space).
const thStyleRow2: CSSProperties = { ...thStyle, top: HEADER_ROW_HEIGHT }
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

function prettifyColumn(column: string): string {
  return column.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function cellValue(record: IndexedCoordinateRecord, column: string): string {
  const raw = record[column]
  if (raw === null || raw === undefined || raw === '') return '—'
  return String(raw)
}

function agreementBadge(status: 'consistent' | 'review' | 'none', cluster: string[], distance: number | null) {
  if (status === 'review') {
    return {
      label: `Review — ${cluster.join(' + ')} agree${distance !== null ? `, ~${formatMeters(distance)} away` : ''}`,
      bg: '#fbe9e7',
      color: 'var(--color-critical)',
    }
  }
  if (status === 'consistent') {
    return { label: 'Consistent', bg: '#e7f7ee', color: 'var(--color-good)' }
  }
  return { label: 'No consensus', bg: 'var(--color-bg)', color: 'var(--color-text-muted)' }
}

// Row-level companion to the summary cards and source panel above — one row
// per settlement, with the Agreement/Recommendation/Decision columns as the
// headline (see analyzeRow), and each active source's own evidence trailing
// after as a 6-column group (toggled via CoordinateReviewSourcePanel, not
// this table). State/LGA/Ward selects double as the page's drill controls,
// same convention as every other MLoS table in this app.
export default function CoordinateReviewResultsTable({
  records,
  totalCount,
  baselineColumns,
  detected,
  sourceNames,
  activeSources,
  decisions,
  onDecide,
  filterState,
  filterLga,
  filterWard,
  onFilterStateChange,
  onFilterLgaChange,
  onFilterWardChange,
  stateOptions,
  lgaOptions,
  wardOptions,
  filterStatus,
  onFilterStatusChange,
}: CoordinateReviewResultsTableProps) {
  const [page, setPage] = useState(0)
  const hasDrillFilter = Boolean(filterState || filterLga || filterWard || filterStatus)
  const activeSourceList = sourceNames.filter((s) => activeSources.has(s))

  function clearDrillFilters() {
    onFilterStateChange(null)
    onFilterLgaChange(null)
    onFilterWardChange(null)
    onFilterStatusChange(null)
  }

  useEffect(() => {
    setPage(0)
  }, [filterState, filterLga, filterWard, filterStatus])

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
        <h3 style={{ fontSize: 14 }}>Results — one row per settlement</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {records.length.toLocaleString()} of {totalCount.toLocaleString()} settlements
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <label style={filterLabelStyle}>State</label>
          <select style={selectStyle} value={filterState ?? ''} onChange={(e) => onFilterStateChange(e.target.value || null)} disabled={stateOptions.length === 0}>
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
          <select style={selectStyle} value={filterLga ?? ''} onChange={(e) => onFilterLgaChange(e.target.value || null)} disabled={lgaOptions.length === 0}>
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
          <select style={selectStyle} value={filterWard ?? ''} onChange={(e) => onFilterWardChange(e.target.value || null)} disabled={wardOptions.length === 0}>
            <option value="">All wards</option>
            {wardOptions.map((ward) => (
              <option key={ward} value={ward}>
                {ward}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>Recommendation</label>
          <select
            style={selectStyle}
            value={filterStatus ?? ''}
            onChange={(e) => onFilterStatusChange((e.target.value || null) as AgreementStatus | null)}
          >
            <option value="">All recommendations</option>
            {RECOMMENDATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {hasDrillFilter && (
          <button
            type="button"
            onClick={clearDrillFilters}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: '6px 0' }}
          >
            Clear all filters
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No settlements match the current filters.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: TABLE_MAX_HEIGHT }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {baselineColumns.map((col) => (
                    <th key={col} style={{ ...thStyle, verticalAlign: 'bottom' }} rowSpan={2}>
                      {prettifyColumn(col)}
                    </th>
                  ))}
                  <th style={{ ...thStyle, verticalAlign: 'bottom' }} rowSpan={2}>
                    Agreement
                  </th>
                  <th style={{ ...thStyle, verticalAlign: 'bottom' }} rowSpan={2}>
                    Recommendation
                  </th>
                  <th style={{ ...thStyle, verticalAlign: 'bottom' }} rowSpan={2}>
                    Decision
                  </th>
                  {activeSourceList.map((source) => (
                    <th
                      key={source}
                      colSpan={6}
                      style={{ ...thStyle, textAlign: 'center', background: `${sourceColor(sourceNames, source)}1a`, color: sourceColor(sourceNames, source) }}
                    >
                      {source} (evidence)
                    </th>
                  ))}
                </tr>
                <tr>
                  {activeSourceList.map((source) => (
                    <Fragment key={source}>
                      <th style={thStyleRow2}>Sim%</th>
                      <th style={thStyleRow2}>Lat</th>
                      <th style={thStyleRow2}>Lon</th>
                      <th style={thStyleRow2}>Dist(m)</th>
                      <th style={thStyleRow2}>GRID3</th>
                      <th style={thStyleRow2}>Tracks</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRecords.map((record) => {
                  const baseLat = detected.latitude ? toNumber(record[detected.latitude] as string | number | null) : null
                  const baseLon = detected.longitude ? toNumber(record[detected.longitude] as string | number | null) : null
                  const analysis = analyzeRow(record, sourceNames, detected.latitude, detected.longitude)
                  const badge = agreementBadge(analysis.status, analysis.cluster, analysis.distanceFromBaseline)
                  const evidenceBySource = Object.fromEntries(sourceNames.map((s) => [s, getSourceEvidence(record, s)]))
                  const decision = decisions[record.__idx] ?? DECISION_KEEP

                  return (
                    <tr key={record.__idx}>
                      {baselineColumns.map((col) => (
                        <td key={col} style={tdStyle}>
                          {cellValue(record, col)}
                        </td>
                      ))}
                      <td style={tdStyle}>
                        <AgreementDiagram
                          baseline={baseLat !== null && baseLon !== null ? { latitude: baseLat, longitude: baseLon } : null}
                          evidenceBySource={evidenceBySource}
                          sourceNames={sourceNames}
                          analysis={analysis}
                        />
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 220 }}>
                        <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <select
                          style={{ ...selectStyle, maxWidth: 210, ...(decision !== DECISION_KEEP ? { borderColor: 'var(--color-primary)', background: '#eaf1fb', fontWeight: 600 } : {}) }}
                          value={decision}
                          onChange={(e) => onDecide(record.__idx, e.target.value)}
                        >
                          <option value={DECISION_KEEP}>Keep original coordinate</option>
                          {analysis.cluster.map((source) => {
                            const ev = evidenceBySource[source]
                            return (
                              <option key={source} value={source}>
                                Adopt {source}
                                {ev ? ` (${ev.latitude.toFixed(5)}, ${ev.longitude.toFixed(5)})` : ''}
                              </option>
                            )
                          })}
                          {analysis.cluster.length > 0 && <option value={DECISION_CENTROID}>Adopt cluster centroid</option>}
                          <option value={DECISION_MANUAL}>Flag for manual review</option>
                        </select>
                      </td>
                      {activeSourceList.map((source) => {
                        const ev = evidenceBySource[source]
                        const inCluster = analysis.cluster.includes(source)
                        const cellStyle: CSSProperties = inCluster ? { ...tdStyle, background: '#fbfbe0', fontWeight: 600 } : tdStyle
                        if (!ev) {
                          return (
                            <Fragment key={source}>
                              <td style={cellStyle}>—</td>
                              <td style={cellStyle}>—</td>
                              <td style={cellStyle}>—</td>
                              <td style={cellStyle}>—</td>
                              <td style={cellStyle}>—</td>
                              <td style={cellStyle}>—</td>
                            </Fragment>
                          )
                        }
                        return (
                          <Fragment key={source}>
                            <td style={cellStyle}>{ev.similarity}%</td>
                            <td style={cellStyle}>{ev.latitude}</td>
                            <td style={cellStyle}>{ev.longitude}</td>
                            <td style={cellStyle}>{formatMeters(ev.distance)}</td>
                            <td style={cellStyle}>{ev.grid3 ? 'Yes' : 'No'}</td>
                            <td style={cellStyle}>{ev.near_tracks ? 'Yes' : 'No'}</td>
                          </Fragment>
                        )
                      })}
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
