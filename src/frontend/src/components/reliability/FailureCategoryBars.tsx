import type { CategoryStats } from '../../types/reliability'
import { CATEGORY_HINTS, categoryLabel } from '../../utils/reliability'
import { EmptyNote } from './reliabilityShared'

interface FailureCategoryBarsProps {
  categories: CategoryStats[]
}

const COUNTED_COLOR = '#d03b3b'
const EXCLUDED_COLOR = '#b4b2ac'

// Failures in the window by cause. Counted categories (they lower the 95%
// success rate) are red and listed first; the excluded ones are grey, so the
// chart answers "what should we fix" before "what did users get wrong".
export default function FailureCategoryBars({ categories }: FailureCategoryBarsProps) {
  const rows = [...categories].filter((c) => c.count > 0).sort((a, b) => Number(b.counted) - Number(a.counted) || b.count - a.count)

  if (rows.length === 0) return <EmptyNote>No failures in this window.</EmptyNote>

  const max = Math.max(...rows.map((r) => r.count))

  return (
    <div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((row) => (
          <li key={row.category} title={CATEGORY_HINTS[row.category]}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 3 }}>
              <span>
                {categoryLabel(row.category)}
                {!row.counted && <span style={{ color: 'var(--color-text-muted)' }}> · not counted</span>}
              </span>
              <span className="tabular" style={{ fontWeight: 600 }}>
                {row.count}
              </span>
            </div>
            <div style={{ height: 8, background: '#EEF2F6', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(2, (row.count / max) * 100)}%`,
                  height: '100%',
                  borderRadius: 4,
                  background: row.counted ? COUNTED_COLOR : EXCLUDED_COLOR,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: COUNTED_COLOR }} /> counts against the success rate
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: EXCLUDED_COLOR }} /> reported, not counted
        </span>
      </div>
    </div>
  )
}
