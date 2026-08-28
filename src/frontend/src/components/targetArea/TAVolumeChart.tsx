import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface TAVolumeChartProps {
  voronoiCount: number
  griddedCount: number
}

const DATA_COLORS = ['#4a86e8', '#8e44ad']

// Voronoi rows and grid-cell rows are not directly comparable counts — a
// voronoi row is ~one settlement's extent polygon (toolbox/target_area/voronoi.py
// dissolves to one row per settlement, though an extent-boundary overlay can
// occasionally split one settlement into more than one row), while a grid
// row is one fixed-size cell (50m inside Built-up Areas, 100m elsewhere —
// toolbox/target_area/gridded.py) tiling that settlement's extent, so grid
// count scales with area, not settlement count. This chart is a volume
// comparison, not a per-settlement breakdown.
export default function TAVolumeChart({ voronoiCount, griddedCount }: TAVolumeChartProps) {
  const data = [
    { label: 'Voronoi records', value: voronoiCount },
    { label: 'Gridded TA cells', value: griddedCount },
  ]

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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Voronoi records vs. gridded TA cells</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Grid cells tile each settlement's voronoi extent at a fixed size (50m in Built-up Areas, 100m elsewhere), so this
        count scales with area, not settlement count
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} interval={0} />
          <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Records']} />
          <Bar dataKey="value" barSize={24} radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={entry.label} fill={DATA_COLORS[i % DATA_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
