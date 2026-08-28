import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StateChartCount } from '../../utils/postImplementationAggregate'

interface ChartCountByStateChartProps {
  data: StateChartCount[]
  title: string
  color: string
  emptyMessage: string
  onSelectState?: (state: string) => void
}

const ROW_HEIGHT = 24

// Reusable "count of generated charts, by state" bar — rendered twice on
// PostImplementationPage (once for summary/pie counts, once for
// breakdown/bar counts), one component rather than two near-identical files
// since the only difference between the two instances is the data, title
// and bar color. Clicking a bar sets the page's shared State filter (and
// clears LGA) — the same selection mechanism the two chart tables' own State
// dropdown drives, so a bar click and a dropdown pick land on identical
// state.
export default function ChartCountByStateChart({ data, title, color, emptyMessage, onSelectState }: ChartCountByStateChartProps) {
  const chartHeight = Math.max(160, data.length * ROW_HEIGHT)

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
      }}
    >
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>{title}</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} state{data.length === 1 ? '' : 's'}
        {onSelectState && data.length > 0 ? ' · click a bar to view that state below' : ''}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>{emptyMessage}</div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="state" width={130} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Charts generated']} />
              <Bar
                dataKey="count"
                fill={color}
                barSize={12}
                radius={[0, 2, 2, 0]}
                cursor={onSelectState ? 'pointer' : undefined}
                onClick={onSelectState ? (entry: StateChartCount) => onSelectState(entry.state) : undefined}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
