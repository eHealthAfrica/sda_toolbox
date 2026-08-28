import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ReachRecord } from '../../types/reach'
import type { DetectedColumns } from '../../utils/columns'
import { REACH_VISITATION_COLORS, getReachCountColor } from '../../utils/colors'
import Pager from '../common/Pager'

interface ReachSettlementListTableProps {
  records: ReachRecord[]
  columns: DetectedColumns
  sourcesColumn?: string
  visitationColumn?: string
  reachColumn?: string
  // When true, skip this component's own outer card (background/border/
  // shadow/padding) — used when a parent (TabbedPanel) already supplies one
  // shared frame for this and a sibling view (see ReachAnalysisPage.tsx).
  bare?: boolean
}

const PAGE_SIZE = 20

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

export default function ReachSettlementListTable({
  records,
  columns,
  sourcesColumn = 'sources',
  visitationColumn = 'status',
  reachColumn = 'reach',
  bare,
}: ReachSettlementListTableProps) {
  const [page, setPage] = useState(0)

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
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{records.length.toLocaleString()} settlements</div>
      </div>

      {records.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No settlements to list.
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
