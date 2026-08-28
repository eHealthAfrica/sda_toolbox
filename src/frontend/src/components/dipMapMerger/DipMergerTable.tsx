import type { CSSProperties } from 'react'
import type { DipMapMergerAnalysis } from '../../types/dipMapMerger'

interface DipMergerTableProps {
  analysis: DipMapMergerAnalysis
  selectedLga: string | null
  onSelect: (lga: string) => void
  onDownload: () => void
}

const th: CSSProperties = {
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
const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

// One row per LGA map book — small enough in practice (a handful to a few
// dozen LGAs per state) that this doesn't need pagination, unlike the
// settlement/team-row tables on the other Microplan pages. "Unmatched pages
// excluded" comes from the client-side preflight (PreflightNoteCard), not
// the response itself — joined here by LGA name.
export default function DipMergerTable({ analysis, selectedLga, onSelect, onDownload }: DipMergerTableProps) {
  const unmatchedByLga = new Map(analysis.preflight.byLga.map((s) => [s.lga, s.unmatchedPages]))

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>LGA Map Books ({analysis.lgaCount.toLocaleString()})</div>
        <button
          onClick={onDownload}
          style={{
            marginLeft: 'auto',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-primary)',
            color: 'var(--color-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ⬇ Download all (DIP LGA Mapbook.zip)
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>LGA</th>
              <th style={th}>Output file</th>
              <th style={th}>Pages</th>
              <th style={th}>Teams</th>
              <th style={th}>Unmatched pages excluded</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {analysis.books.map((book) => (
              <tr key={book.lga}>
                <td style={td}>{book.lga}</td>
                <td style={td}>{book.outputFilename}</td>
                <td style={td}>
                  {book.pages.toLocaleString()}
                  {book.oddPageCount && <span style={{ color: '#92680a' }}> ⚠</span>}
                </td>
                <td style={td}>{book.teams.toLocaleString()}</td>
                <td style={td}>{(unmatchedByLga.get(book.lga) ?? 0).toLocaleString()}</td>
                <td style={td}>
                  <button
                    onClick={() => onSelect(book.lga)}
                    style={{
                      display: 'inline-block',
                      padding: '1px 8px',
                      borderRadius: 20,
                      fontSize: 10.5,
                      fontWeight: 600,
                      background: book.lga === selectedLga ? '#e6f6e6' : '#eef1f4',
                      color: book.lga === selectedLga ? 'var(--color-good)' : 'var(--color-text-muted)',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {book.lga === selectedLga ? 'Previewing' : 'Preview'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
