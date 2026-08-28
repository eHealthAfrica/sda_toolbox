import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SheetSummary } from '../../types/compilerDisaggregate'

interface DisaggregateChartProps {
  sheets: SheetSummary[]
}

const BAR_COLOR = '#2c5f9e'
const ROW_HEIGHT = 20

// Same horizontal-bar-per-group pattern as DipGeneratorLgaChart.tsx /
// DipMergerLgaChart.tsx. Sorted descending here (the response workbook's own
// sheet order is groupby order, not size order) and capped to a scrollable
// container since Ward-level can produce well over 100 sheets.
export default function DisaggregateChart({ sheets }: DisaggregateChartProps) {
  const data = [...sheets].sort((a, b) => b.recordCount - a.recordCount)
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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Records per sheet</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Every sheet this run produced, largest first.
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No sheets came back.
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Records']} />
              <Bar dataKey="recordCount" fill={BAR_COLOR} barSize={11} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
