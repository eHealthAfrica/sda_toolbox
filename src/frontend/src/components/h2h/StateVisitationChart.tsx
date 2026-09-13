import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StateVisitationEntry } from '../../utils/aggregate'
import { VISITATION_COLORS } from '../../utils/colors'
import type { VisitationStatus } from '../../types/h2h'

interface StateVisitationChartProps {
  data: StateVisitationEntry[]
  // Kept in the props contract (H2HTrackingPage still passes it) even though
  // the subtitle line that used to display it was removed — see the caveat
  // where the JSX destructure below intentionally doesn't bind it.
  cumColumnLabel: string
  // The two statuses relevant to this run (Visited + one of the other two —
  // see getVisitationOrderFor). Only these get a bar segment / legend entry;
  // the third field on each StateVisitationEntry is always 0 for this run
  // and would just be a flat, misleading "always zero" legend item otherwise.
  activeOrder: VisitationStatus[]
  activeState?: string | null
  activeStatus?: VisitationStatus | null
  // Clicking a bar segment — a specific {state, status} combination.
  onSelect?: (state: string, status: VisitationStatus) => void
  // Clicking a legend swatch — same effect as clicking the matching
  // VisitationCards card (H2HTrackingPage's toggleVisitation), independent of
  // whichever state/LGA/ward is currently on the axis.
  onLegendSelect?: (status: VisitationStatus) => void
  // Clicking a row's axis label (the state/LGA/ward name itself, not a
  // colored segment) — drills into that group, same as picking it in the
  // settlement list table's State/LGA/Ward select. Omitted at whichever
  // level has nowhere further to drill (see H2HTrackingPage.tsx).
  onAxisSelect?: (group: string) => void
  // "Back up one level" link next to the title — see StateCoverageChart's
  // matching prop.
  onDrillUp?: () => void
  drillUpLabel?: string
  // Overridable so H2HTrackingPage can drill this same chart from a
  // by-state breakdown down to by-LGA (once a state is selected in the
  // settlement list table) and then by-ward (once an LGA is also
  // selected) — see StateCoverageChart's matching props.
  title?: string
  emptyMessage?: string
}

const ROW_HEIGHT = 26

// Same clickable-axis-label tick as StateCoverageChart — see that file's
// comment. Kept as a local copy rather than a shared import since each
// chart's data shape (and thus its onAxisSelect group value) is otherwise
// unrelated; duplicating ~20 lines here isn't worth a shared module for it.
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

export default function StateVisitationChart({
  data,
  activeOrder,
  activeState,
  activeStatus,
  onSelect,
  onLegendSelect,
  onAxisSelect,
  onDrillUp,
  drillUpLabel,
  title = 'Settlement visitation by state',
  emptyMessage = 'No state column detected in the result.',
}: StateVisitationChartProps) {
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
          {activeOrder.map((status) => {
            const active = activeStatus === status
            return (
              <span
                key={status}
                onClick={onLegendSelect ? () => onLegendSelect(status) : undefined}
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
                    background: VISITATION_COLORS[status],
                    display: 'inline-block',
                  }}
                />
                {status}
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
              {activeOrder.map((status) => (
                <Bar
                  key={status}
                  dataKey={status}
                  stackId="visitation"
                  fill={VISITATION_COLORS[status]}
                  barSize={14}
                  cursor={onSelect ? 'pointer' : undefined}
                  onClick={(barData: { payload?: StateVisitationEntry; state?: string }) =>
                    onSelect?.(barData?.payload?.state ?? barData?.state ?? '', status)
                  }
                >
                  {data.map((entry) => {
                    const dimmed =
                      (!!activeState && activeState !== entry.state) || (!!activeStatus && activeStatus !== status)
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
