import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GroupPopulationEntry } from '../../utils/reachAggregate'

interface MissedPopulationChartProps {
  data: GroupPopulationEntry[]
  title: string
  groupLabel: string
  emptyMessage: string
  // Present at every drill level except the deepest (ward) — see
  // LgaVisitationChart.tsx's identical prop for the shared drill contract.
  onSelect?: (group: string) => void
}

const BAR_COLOR = '#d03b3b'
const ROW_HEIGHT = 24

// Single by-group missed-population breakdown at the page's current drill
// level (state, then LGA, then ward) — same shape as
// utils/reachAggregate.ts::computeMissedPopulationByGroup.
export default function MissedPopulationChart({ data, title, groupLabel, emptyMessage, onSelect }: MissedPopulationChartProps) {
  const chartHeight = Math.max(160, data.length * ROW_HEIGHT)

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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>{title}</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} {groupLabel}
        {onSelect && data.length > 0 ? ' · click a bar to drill down' : ''}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="group" width={160} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip
                formatter={(value: number, _name: string, props: any) => {
                  const total = props?.payload?.total ?? 0
                  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
                  return [`${value.toLocaleString()} of ${total.toLocaleString()} (${pct}%)`, 'Potentially missed']
                }}
              />
              <Bar
                dataKey="missed"
                fill={BAR_COLOR}
                barSize={12}
                radius={[0, 2, 2, 0]}
                cursor={onSelect ? 'pointer' : undefined}
                onClick={onSelect ? (entry: GroupPopulationEntry) => onSelect(entry.group) : undefined}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
