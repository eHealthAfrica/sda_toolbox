import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { UuidCheckResult } from '../../types/uuidChecker'
import { UUID_EXISTS_COLORS } from '../../utils/colors'
import Pager from '../common/Pager'

interface UuidResultTableProps {
  results: UuidCheckResult[]
  title?: string
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
  whiteSpace: 'nowrap',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        marginRight: 6,
      }}
    />
  )
}

// Paginated (50/page) results table shared by the single-check history and
// the batch checker — same cap as the H2H/MLoS settlement lists.
export default function UuidResultTable({ results, title = 'Results' }: UuidResultTableProps) {
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageResults = useMemo(
    () => results.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [results, clampedPage],
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
        <h3 style={{ fontSize: 14 }}>{title}</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{results.length.toLocaleString()} UUIDs</div>
      </div>

      {results.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No results yet.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 48 }}>#</th>
                  <th style={thStyle}>UUID</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pageResults.map((result, i) => (
                  <tr key={`${result.uuid}-${clampedPage * PAGE_SIZE + i}`}>
                    <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{clampedPage * PAGE_SIZE + i + 1}</td>
                    <td style={tdStyle}>{result.uuid}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>
                      <Dot color={UUID_EXISTS_COLORS[result.exists]} />
                      {result.exists}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={clampedPage}
            totalPages={totalPages}
            totalCount={results.length}
            pageCount={pageResults.length}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />
        </>
      )}
    </div>
  )
}
