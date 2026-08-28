import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SourceCount } from '../../utils/reachAggregate'
import { CATEGORICAL_PALETTE } from '../../utils/colors'

interface SourceBreakdownChartProps {
  data: SourceCount[]
  totalSettlements: number
}

const ROW_HEIGHT = 26

// How many settlements each individual data source (zip entry / Excel sheet
// name in the uploaded data_sources file, or "tracks") independently
// confirmed as reached — toolbox/triangulate/ttools.py::populate_sources. A
// settlement can count toward more than one source, so these bars don't sum
// to totalSettlements.
export default function SourceBreakdownChart({ data, totalSettlements }: SourceBreakdownChartProps) {
  const chartHeight = Math.max(140, data.length * ROW_HEIGHT)

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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Validated by</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Settlements each data source independently confirmed as visited — a settlement can be confirmed by more than one source
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No "sources" column detected in the result.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="source" width={110} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip
              formatter={(value: number) => [
                `${value.toLocaleString()} (${totalSettlements > 0 ? ((value / totalSettlements) * 100).toFixed(1) : '0.0'}% of settlements)`,
                'Confirmed by this source',
              ]}
            />
            <Bar dataKey="count" barSize={14} radius={[0, 2, 2, 0]}>
              {data.map((entry, i) => (
                <Cell key={entry.source} fill={CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
