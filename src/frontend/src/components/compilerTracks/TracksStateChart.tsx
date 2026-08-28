import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StateBreakdownEntry } from '../../utils/aggregate'

interface TracksStateChartProps {
  data: StateBreakdownEntry[]
}

const BAR_COLOR = '#2c5f9e'
const ROW_HEIGHT = 22

// Same horizontal-bars pattern as h2h/LgaBreakdownChart.tsx, one level up the
// admin hierarchy: fuzzy-detect a state column on whatever raw attribute
// columns this track file's own records carry (utils/columns.ts::
// detectColumns), group with utils/aggregate.ts::computeStateBreakdown, and
// degrade to an explicit empty state when no state column was found.
export default function TracksStateChart({ data }: TracksStateChartProps) {
  const chartHeight = Math.max(180, data.length * ROW_HEIGHT)

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Tracks by State</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        {data.length > 0
          ? `${data.length.toLocaleString()} states, grouped from a state column detected on the compiled track points.`
          : 'Grouped from a state column detected on the compiled track points, when the source file carries one.'}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No state column detected in this tracks file.
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="state" width={130} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Tracks']} />
              <Bar dataKey="count" fill={BAR_COLOR} barSize={12} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
