import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GroupAccessibilityEntry } from '../../utils/reachAggregate'
import { ACCESSIBILITY_COLORS } from '../../utils/colors'
import type { AccessibilityStatus } from '../../types/reach'
import { ACCESSIBILITY_STATUSES } from '../../types/reach'

interface AccessibilityByStateChartProps {
  data: GroupAccessibilityEntry[]
  title: string
  groupLabel: string
  emptyMessage: string
  // Present at every drill level except the deepest (ward) — see
  // LgaVisitationChart.tsx's identical prop for the shared drill contract.
  onSelect?: (group: string) => void
}

const ROW_HEIGHT = 26

// Settlement-level "Accessibility status" (Fully/Partially/Inaccessible)
// broken down per group at the page's current drill level — same stacked-bar
// shape as LgaVisitationChart above it, with three stacked categories
// instead of two. Raw values carry inconsistent casing ("Inaccessible" vs
// "inaccessible") — see utils/reachAggregate.ts::normalizeAccessibility,
// which folds those together before this chart ever sees them.
export default function AccessibilityByStateChart({ data, title, groupLabel, emptyMessage, onSelect }: AccessibilityByStateChartProps) {
  const chartHeight = Math.max(180, data.length * ROW_HEIGHT)

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
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(ACCESSIBILITY_STATUSES as readonly AccessibilityStatus[]).map((status) => (
            <span key={status} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: ACCESSIBILITY_COLORS[status], display: 'inline-block' }} />
              {status}
            </span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} {groupLabel}
        {onSelect && data.length > 0 ? ' · click a bar to drill down' : ''}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="group" width={110} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip />
              {(ACCESSIBILITY_STATUSES as readonly AccessibilityStatus[]).map((status) => (
                <Bar
                  key={status}
                  dataKey={status}
                  stackId="accessibility"
                  fill={ACCESSIBILITY_COLORS[status]}
                  barSize={14}
                  cursor={onSelect ? 'pointer' : undefined}
                  onClick={onSelect ? (entry: GroupAccessibilityEntry) => onSelect(entry.group) : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
