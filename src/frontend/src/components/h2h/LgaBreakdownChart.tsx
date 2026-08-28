import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { LgaBreakdownEntry } from '../../utils/aggregate'
import { PLANNED_COLOR } from '../../utils/colors'

interface LgaBreakdownChartProps {
  data: LgaBreakdownEntry[]
}

const ROW_HEIGHT = 22

// Horizontal bars, one row per LGA, scrollable rather than squeezed — a
// campaign can span dozens of LGAs and a vertical/rotated-label chart
// degrades badly past ~15 categories.
export default function LgaBreakdownChart({ data }: LgaBreakdownChartProps) {
  const chartHeight = Math.max(240, data.length * ROW_HEIGHT)

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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Planned settlements by LGA</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} LGAs
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No LGA column detected in the result.
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="lga"
                width={130}
                tick={{ fontSize: 11 }}
                interval={0}
              />
              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Planned settlements']} />
              <Bar dataKey="count" fill={PLANNED_COLOR} barSize={12} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
