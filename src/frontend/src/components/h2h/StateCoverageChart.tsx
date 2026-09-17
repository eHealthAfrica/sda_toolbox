import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StateCoverageEntry } from '../../utils/aggregate'
import { COVERAGE_COLORS, COVERAGE_ORDER } from '../../utils/colors'
import type { SettlementCoverageCategory } from '../../types/h2h'

interface StateCoverageChartProps {
  data: StateCoverageEntry[]
  activeState?: string | null
  activeCategory?: SettlementCoverageCategory | null
  // Clicking a bar segment — a specific {state, category} combination.
  onSelect?: (state: string, category: SettlementCoverageCategory) => void
  // Clicking a legend swatch — same effect as clicking the matching
  // CoverageCards card (H2HTrackingPage's toggleCoverage), independent of
  // whichever state/LGA/ward is currently on the axis.
  onLegendSelect?: (category: SettlementCoverageCategory) => void
  // Clicking a row's axis label (the state/LGA/ward name itself, not a
  // colored segment) — drills into that group, same as picking it in the
  // settlement list table's State/LGA/Ward select. Omitted at whichever
  // level has nowhere further to drill (see H2HTrackingPage.tsx).
  onAxisSelect?: (group: string) => void
  // "Back up one level" link next to the title, shown once onAxisSelect (or
  // the table's own selects) has drilled below the top state-level view —
  // same convention as MlosQcPage's FlagBreakdownChart.
  onDrillUp?: () => void
  drillUpLabel?: string
  // Overridable so H2HTrackingPage can drill this same chart from a
  // by-state breakdown down to by-LGA (once a state is selected in the
  // settlement list table) and then by-ward (once an LGA is also
  // selected), rather than always reading "by state" once the entries
  // it's fed are no longer states.
  title?: string
  emptyMessage?: string
}

const ROW_HEIGHT = 26

// Renders each Y-axis row label as a clickable "drill into this group" link
// when onAxisSelect is provided, otherwise falls back to recharts' plain
// tick text — keeps the default position/size (dy=4, textAnchor="end") so
// enabling this doesn't shift the axis layout.
function AxisTick({
  x,
  y,
  payload,
  onAxisSelect,
}: {
  x?: number
  y?: number
  payload?: { value: string }
  onAxisSelect?: (group: string) => void
}) {
  const value = payload?.value ?? ''
  const clickable = !!onAxisSelect
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={11}
      fill={clickable ? 'var(--color-primary)' : 'var(--color-text-muted)'}
      style={{ cursor: clickable ? 'pointer' : 'default', textDecoration: clickable ? 'underline' : undefined }}
      onClick={clickable ? () => onAxisSelect!(value) : undefined}
    >
      {value}
    </text>
  )
}

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
  onLegendSelect,
  onAxisSelect,
  onDrillUp,
  drillUpLabel,
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h3 style={{ fontSize: 14 }}>{title}</h3>
          {onDrillUp && (
            <button
              type="button"
              onClick={onDrillUp}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-primary)',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              {drillUpLabel ?? '← Back'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {COVERAGE_ORDER.map((category) => {
            const active = activeCategory === category
            return (
              <span
                key={category}
                onClick={onLegendSelect ? () => onLegendSelect(category) : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontWeight: active ? 700 : 400,
                  cursor: onLegendSelect ? 'pointer' : undefined,
                }}
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
            )
          })}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {onAxisSelect ? 'Click a segment to filter, or a name to drill down' : onSelect ? 'Click a segment to filter' : ''}
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
              <YAxis
                type="category"
                dataKey="state"
                width={100}
                tick={(props: any) => <AxisTick {...props} onAxisSelect={onAxisSelect} />}
                interval={0}
              />
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
