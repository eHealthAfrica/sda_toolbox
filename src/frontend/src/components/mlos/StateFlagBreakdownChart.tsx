import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StateFlagBreakdownEntry } from '../../utils/mlosAggregate'

interface StateFlagBreakdownChartProps {
  data: StateFlagBreakdownEntry[]
}

const BAR_COLOR = '#d03b3b'
const ROW_HEIGHT = 22

// Which states need the most QC follow-up — flagged settlement count per
// state, sorted descending.
export default function StateFlagBreakdownChart({ data }: StateFlagBreakdownChartProps) {
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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Flagged settlements by state</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} states
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No state column detected in the result.
        </div>
      ) : (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="state" width={100} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip
                formatter={(value: number, _name: string, props: any) => {
                  const total = props?.payload?.total ?? 0
                  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
                  return [`${value.toLocaleString()} of ${total.toLocaleString()} (${pct}%)`, 'Flagged']
                }}
              />
              <Bar dataKey="flagged" fill={BAR_COLOR} barSize={12} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
