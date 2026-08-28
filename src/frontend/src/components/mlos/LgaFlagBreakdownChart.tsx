import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GroupFlagBreakdownEntry } from '../../utils/mlosAggregate'

interface LgaFlagBreakdownChartProps {
  data: GroupFlagBreakdownEntry[]
  activeGroup?: string | null
  onSelect?: (group: string) => void
}

const BAR_COLOR = '#d03b3b'
const ROW_HEIGHT = 22

// Which LGAs need the most QC follow-up — flagged settlement count per LGA,
// sorted descending. A per-state breakdown isn't useful here since
// /qc/validation runs one state at a time (see computeGroupFlagBreakdown) —
// LGA is the granularity that actually varies within a single result.
export default function LgaFlagBreakdownChart({ data, activeGroup, onSelect }: LgaFlagBreakdownChartProps) {
  const chartHeight = Math.max(180, data.length * ROW_HEIGHT)

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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Flagged settlements by LGA</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} LGAs{onSelect ? ' — click a bar to filter the table below' : ''}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No LGA column detected in the result.
        </div>
      ) : (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="group" width={130} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip
                formatter={(value: number, _name: string, props: any) => {
                  const total = props?.payload?.total ?? 0
                  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
                  return [`${value.toLocaleString()} of ${total.toLocaleString()} (${pct}%)`, 'Flagged']
                }}
              />
              <Bar
                dataKey="flagged"
                barSize={12}
                radius={[0, 2, 2, 0]}
                onClick={(entry: GroupFlagBreakdownEntry) => onSelect?.(entry.group)}
                cursor={onSelect ? 'pointer' : undefined}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.group}
                    fill={BAR_COLOR}
                    fillOpacity={!activeGroup || activeGroup === entry.group ? 1 : 0.35}
                    stroke={activeGroup === entry.group ? BAR_COLOR : undefined}
                    strokeWidth={activeGroup === entry.group ? 1.5 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
