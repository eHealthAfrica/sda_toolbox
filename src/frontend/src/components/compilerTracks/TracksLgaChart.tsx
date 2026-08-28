import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { LgaBreakdownEntry } from '../../utils/aggregate'

interface TracksLgaChartProps {
  data: LgaBreakdownEntry[]
}

const BAR_COLOR = '#2c5f9e'
const ROW_HEIGHT = 22

// Same horizontal-bars-per-LGA pattern as h2h/LgaBreakdownChart.tsx (and
// reach/LgaVisitationChart.tsx, mlos/LgaFlagBreakdownChart.tsx) — this
// codebase's established way of charting an LGA breakdown: fuzzy-detect an
// LGA column on whatever raw attribute columns the source file happened to
// carry (utils/columns.ts::detectColumns), group with
// utils/aggregate.ts::computeLgaBreakdown, and degrade to an explicit empty
// state when no LGA column was found — rather than attempting a true
// geographic point-in-polygon assignment, which nothing in this frontend
// (or the compiled track points themselves) currently supports. A raw GPS
// tracks file most often won't carry an LGA attribute at all, so this empty
// state is the common case, not an edge case — the chart only lights up
// when a track file's own columns happen to include one.
export default function TracksLgaChart({ data }: TracksLgaChartProps) {
  const chartHeight = Math.max(240, data.length * ROW_HEIGHT)

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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Tracks by LGA</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        {data.length > 0
          ? `${data.length.toLocaleString()} LGAs, grouped from an LGA column detected on the compiled track points.`
          : 'Grouped from an LGA column detected on the compiled track points, when the source file carries one.'}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No LGA column detected in this tracks file.
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="lga" width={130} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Tracks']} />
              <Bar dataKey="count" fill={BAR_COLOR} barSize={12} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
