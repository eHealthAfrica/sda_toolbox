import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DipMapMergerAnalysis } from '../../types/dipMapMerger'

interface DipMergerLgaChartProps {
  analysis: DipMapMergerAnalysis
}

const BAR_COLOR = '#2c5f9e'
const ROW_HEIGHT = 22

// Same horizontal-bar-per-LGA pattern as h2h/LgaBreakdownChart.tsx — a
// state can span dozens of LGAs, and a vertical/rotated-label chart
// degrades badly past ~15 categories. `analysis.books` already comes
// sorted by team count, descending.
export default function DipMergerLgaChart({ analysis }: DipMergerLgaChartProps) {
  const data = analysis.books.map((b) => ({ lga: b.lga, teams: b.teams }))
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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Field teams by LGA</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Team count per LGA, from each output PDF's real page count — verified against the real interleaving logic in
        <code> merge_pdfs</code>.
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No map books came back in the response.
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="lga" width={130} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Field teams']} />
              <Bar dataKey="teams" fill={BAR_COLOR} barSize={12} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
