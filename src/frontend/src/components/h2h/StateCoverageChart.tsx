import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StateCoverageEntry } from '../../utils/aggregate'
import { COVERAGE_COLORS, COVERAGE_ORDER } from '../../utils/colors'
import type { SettlementCoverageCategory } from '../../types/h2h'

interface StateCoverageChartProps {
  data: StateCoverageEntry[]
  activeState?: string | null
  activeCategory?: SettlementCoverageCategory | null
  onSelect?: (state: string, category: SettlementCoverageCategory) => void
  // Overridable so H2HTrackingPage can drill this same chart from a
  // by-state breakdown down to by-LGA (once a state is selected in the
  // settlement list table) and then by-ward (once an LGA is also
  // selected), rather than always reading "by state" once the entries
  // it's fed are no longer states.
  title?: string
  emptyMessage?: string
}

const ROW_HEIGHT = 26

// Replaces the old "planned settlements by LGA" chart — a state-by-state
// stacked breakdown of the 'Settlement Coverage' column (classify_coverage),
// mirroring StateVisitationChart's layout so the two read as a matched pair.
// Each segment is clickable — same combined { state, category } selection
// SettlementListTable/VisitationMap filter on below. "state" in the data
// shape/field names is literal only at the top drill level — see the title
// prop above.
export default function StateCoverageChart({
  data,
  activeState,
  activeCategory,
  onSelect,
  title = 'Settlement coverage by state',
  emptyMessage = 'No state column detected in the result.',
}: StateCoverageChartProps) {
  const chartHeight = Math.max(200, data.length * ROW_HEIGHT)

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14 }}>{title}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {COVERAGE_ORDER.map((category) => (
            <span
              key={category}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: COVERAGE_COLORS[category],
                  display: 'inline-block',
                }}
              />
              {category}
            </span>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="state" width={100} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip />
              {COVERAGE_ORDER.map((category) => (
                <Bar
                  key={category}
                  dataKey={category}
                  stackId="coverage"
                  fill={COVERAGE_COLORS[category]}
                  barSize={14}
                  cursor={onSelect ? 'pointer' : undefined}
                  onClick={(barData: { payload?: StateCoverageEntry; state?: string }) =>
                    onSelect?.(barData?.payload?.state ?? barData?.state ?? '', category)
                  }
                >
                  {data.map((entry) => {
                    const dimmed =
                      (!!activeState && activeState !== entry.state) ||
                      (!!activeCategory && activeCategory !== category)
                    return <Cell key={entry.state} fillOpacity={dimmed ? 0.35 : 1} />
                  })}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
