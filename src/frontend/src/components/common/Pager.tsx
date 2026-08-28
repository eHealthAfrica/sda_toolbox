import type { CSSProperties } from 'react'

interface PagerProps {
  page: number
  totalPages: number
  totalCount: number
  pageCount: number
  onPrev: () => void
  onNext: () => void
}

function btnStyle(disabled: boolean): CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: disabled ? 'var(--color-bg)' : 'var(--color-surface)',
    color: disabled ? 'var(--color-text-muted)' : 'var(--color-text)',
    cursor: disabled ? 'default' : 'pointer',
  }
}

// Shared prev/next pager for the paginated settlement-list tables — H2H caps
// at 20 rows/page, MLoS QC at 50 (see SettlementListTable and
// QcSettlementListTable).
export default function Pager({ page, totalPages, totalCount, pageCount, onPrev, onNext }: PagerProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 12 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>
        Page {page + 1} of {totalPages} · showing {pageCount.toLocaleString()} of {totalCount.toLocaleString()}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onPrev} disabled={page === 0} style={btnStyle(page === 0)}>
          ← Prev
        </button>
        <button type="button" onClick={onNext} disabled={page >= totalPages - 1} style={btnStyle(page >= totalPages - 1)}>
          Next →
        </button>
      </div>
    </div>
  )
}
