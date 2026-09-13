import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { IndexedDuplicateRecord, ReviewDecision, ReviewOutcome } from '../../types/duplicateChecker'
import { DECISION_COLORS, DECISION_LABELS, REVIEW_OUTCOME_ORDER } from '../../types/duplicateChecker'
import { formatDistance, reviewBadge } from '../../utils/duplicateCheckerAggregate'
import Pager from '../common/Pager'

interface DuplicatePairsTableProps {
  records: IndexedDuplicateRecord[]
  totalCount: number
  decisions: Record<number, ReviewDecision>
  onDecide: (idx: number, decision: ReviewDecision) => void
  onUndo: (idx: number) => void
  filterState: string | null
  filterLga: string | null
  filterWard: string | null
  filterReview: ReviewOutcome | null
  onFilterStateChange: (state: string | null) => void
  onFilterLgaChange: (lga: string | null) => void
  onFilterWardChange: (ward: string | null) => void
  onFilterReviewChange: (review: ReviewOutcome | null) => void
  stateOptions: string[]
  lgaOptions: string[]
  wardOptions: string[]
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
const decisionBtnStyle = (bg: string, color: string, border: string): CSSProperties => ({
  fontSize: 10.5,
  fontWeight: 600,
  padding: '4px 8px',
  borderRadius: 6,
  border: `1px solid ${border}`,
  background: bg,
  color,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
})

// Row-level companion to the coverage/stat cards and breakdown chart above —
// the State/LGA/Ward selects here double as the page's drill controls (same
// convention as MLoS QC's QcSettlementListTable), plus a Review outcome
// select mirroring the stat cards' own click-to-filter. The Decision column
// is this tool's own addition: a client-side-only proposed workflow (see
// types/duplicateChecker.ts) — three buttons per undecided row, replaced by
// the recorded decision + an Undo link once one is picked.
export default function DuplicatePairsTable({
  records,
  totalCount,
  decisions,
  onDecide,
  onUndo,
  filterState,
  filterLga,
  filterWard,
  filterReview,
  onFilterStateChange,
  onFilterLgaChange,
  onFilterWardChange,
  onFilterReviewChange,
  stateOptions,
  lgaOptions,
  wardOptions,
}: DuplicatePairsTableProps) {
  const [page, setPage] = useState(0)
  const hasDrillFilter = Boolean(filterState || filterLga || filterWard)

  function clearDrillFilters() {
    onFilterStateChange(null)
    onFilterLgaChange(null)
    onFilterWardChange(null)
  }

  useEffect(() => {
    setPage(0)
  }, [filterState, filterLga, filterWard, filterReview])

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
        <h3 style={{ fontSize: 14 }}>Flagged pairs</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {records.length.toLocaleString()} of {totalCount.toLocaleString()} pairs
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
          <label style={filterLabelStyle}>Review outcome</label>
          <select
            style={selectStyle}
            value={filterReview ?? ''}
            onChange={(e) => onFilterReviewChange((e.target.value as ReviewOutcome) || null)}
          >
            <option value="">All outcomes</option>
            {REVIEW_OUTCOME_ORDER.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
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
            Clear geography filters
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No flagged pairs match the current filters.
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
                  <th style={thStyle}>Settlement 1</th>
                  <th style={thStyle}>Settlement 2</th>
                  <th style={thStyle}>Score</th>
                  <th style={thStyle}>Distance</th>
                  <th style={thStyle}>Review</th>
                  <th style={thStyle}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {pageRecords.map((record) => {
                  const badge = reviewBadge(record.review)
                  const decision = decisions[record.__idx]
                  return (
                    <tr key={record.__idx}>
                      <td style={tdStyle}>{record.state}</td>
                      <td style={tdStyle}>{record.lga}</td>
                      <td style={tdStyle}>{record.ward}</td>
                      <td style={tdStyle}>{record['settlement 1']}</td>
                      <td style={tdStyle}>{record['settlement 2']}</td>
                      <td style={tdStyle}>{record.score}</td>
                      <td style={tdStyle}>{formatDistance(record.distance)}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 10.5,
                            fontWeight: 600,
                            background: badge.bg,
                            color: badge.color,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {decision ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: DECISION_COLORS[decision] }}>
                              ✓ {DECISION_LABELS[decision]}
                            </span>
                            <button
                              type="button"
                              onClick={() => onUndo(record.__idx)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--color-primary)',
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                padding: 0,
                              }}
                            >
                              Undo
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => onDecide(record.__idx, 'keep')}
                              style={decisionBtnStyle('var(--color-surface-2)', 'var(--color-text-secondary)', 'var(--color-border)')}
                            >
                              Keep both
                            </button>
                            <button
                              type="button"
                              onClick={() => onDecide(record.__idx, 'remove')}
                              style={decisionBtnStyle('#fdeceb', 'var(--color-critical)', '#f0c4c0')}
                            >
                              Remove match
                            </button>
                            <button
                              type="button"
                              onClick={() => onDecide(record.__idx, 'field_check')}
                              style={decisionBtnStyle('#fff6e0', '#8a5a00', '#f0d999')}
                            >
                              Field check
                            </button>
                          </div>
                        )}
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
