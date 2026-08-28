import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ProximityBreakdownEntry } from '../../utils/mlosAggregate'
import { CATEGORICAL_PALETTE } from '../../utils/colors'

interface ProximityBreakdownChartProps {
  data: ProximityBreakdownEntry[]
  activeBucket?: string | null
  onSelect?: (bucket: string) => void
}

// Breaks the Proximity Issues flag down by how close the nearest other
// settlement actually is (see spatial_checks.py::classify_distance — "Within
// 10m" / "Within 20m" / "Within 30m"). A true column chart (category on the
// X axis) by design, unlike IssueFlagBarChart/LgaFlagBreakdownChart's
// horizontal-bar layout="vertical" convention — the three buckets read
// naturally left-to-right as "closer to farther" rather than top-to-bottom.
export default function ProximityBreakdownChart({ data, activeBucket, onSelect }: ProximityBreakdownChartProps) {
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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Proximity issues by distance</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        How close the nearest other settlement is, for settlements flagged with a proximity issue
        {onSelect ? ' — click a column to filter the table below' : ''}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ left: 8, right: 24, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval={0} />
          <YAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
          <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Settlements']} />
          <Bar
            dataKey="count"
            barSize={48}
            radius={[4, 4, 0, 0]}
            onClick={(entry: ProximityBreakdownEntry) => onSelect?.(entry.bucket)}
            cursor={onSelect ? 'pointer' : undefined}
          >
            {data.map((entry, i) => (
              <Cell
                key={entry.bucket}
                fill={CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]}
                fillOpacity={!activeBucket || activeBucket === entry.bucket ? 1 : 0.35}
                stroke={activeBucket === entry.bucket ? CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] : undefined}
                strokeWidth={activeBucket === entry.bucket ? 1.5 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
