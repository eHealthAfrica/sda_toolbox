import type { TopCause } from '../../types/reliability'
import { relativeTime, truncate } from '../../utils/reliability'
import { CategoryPill, EmptyNote, monoStyle, thStyle, tdStyle } from './reliabilityShared'

interface TopCausesTableProps {
  causes: TopCause[]
  toolLabels: Record<string, string>
}

// The same crash grouped by its traceback hash, so ten failures from one bug
// read as one row with a count of ten. This is the list to fix from, top down.
export default function TopCausesTable({ causes, toolLabels }: TopCausesTableProps) {
  if (causes.length === 0) return <EmptyNote>No recurring crash causes in this window.</EmptyNote>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr>
            <th style={thStyle}>Count</th>
            <th style={thStyle}>Cause</th>
            <th style={thStyle}>Tool</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {causes.map((c, i) => (
            <tr key={`${c.traceback_hash ?? 'none'}-${c.tool}-${i}`}>
              <td style={{ ...tdStyle, fontWeight: 700 }} className="tabular">
                {c.count}
              </td>
              <td style={{ ...tdStyle, maxWidth: 280 }}>
                <div style={{ fontWeight: 600 }}>{c.error_type ?? 'Unknown error'}</div>
                {c.sample && (
                  <div style={{ ...monoStyle, color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }} title={c.sample}>
                    {truncate(c.sample, 90)}
                  </div>
                )}
                {c.traceback_hash && <div style={{ ...monoStyle, color: 'var(--color-text-muted)' }}>#{c.traceback_hash.slice(0, 8)}</div>}
              </td>
              <td style={tdStyle}>{toolLabels[c.tool] ?? c.tool}</td>
              <td style={tdStyle}>
                <CategoryPill category={c.category} />
              </td>
              <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{relativeTime(c.last_seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
