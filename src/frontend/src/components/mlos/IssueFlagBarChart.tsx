import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { IssueFlagCount } from '../../utils/mlosAggregate'
import { CATEGORICAL_PALETTE } from '../../utils/colors'

interface IssueFlagBarChartProps {
  counts: IssueFlagCount[]
  activeKey?: string | null
  onSelect?: (key: string) => void
}

// Same five issue-flag counts as the cards above, compared side by side —
// easier to spot which single check is driving most of is_flagged than
// scanning five separate stat tiles. Bars share the same click-to-filter
// wiring as the cards above (MlosQcPage keeps one selected-issue state that
// both drive), so either can be used to filter the settlement table below.
export default function IssueFlagBarChart({ counts, activeKey, onSelect }: IssueFlagBarChartProps) {
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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>QC issues compared</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Settlements flagged by each individual check{onSelect ? ' — click a bar to filter the table below' : ''}
      </div>
      <ResponsiveContainer width="100%" height={Math.max(180, counts.length * 40)}>
        <BarChart data={counts} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} interval={0} />
          <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Settlements flagged']} />
          <Bar
            dataKey="count"
            barSize={16}
            radius={[0, 2, 2, 0]}
            onClick={(entry: IssueFlagCount) => onSelect?.(entry.key)}
            cursor={onSelect ? 'pointer' : undefined}
          >
            {counts.map((entry, i) => (
              <Cell
                key={entry.key}
                fill={CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]}
                fillOpacity={!activeKey || activeKey === entry.key ? 1 : 0.35}
                stroke={activeKey === entry.key ? CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] : undefined}
                strokeWidth={activeKey === entry.key ? 1.5 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
