import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GroupFlagBreakdownEntry } from '../../utils/mlosAggregate'

interface FlagBreakdownChartProps {
  data: GroupFlagBreakdownEntry[]
  title: string
  emptyMessage: string
  // Present at the 'state' and 'lga' levels — clicking a bar drills one
  // level down the admin hierarchy (state -> LGA -> ward). Omitted at the
  // 'ward' level, the bottom of the hierarchy: there's nowhere further to
  // drill, so ward bars are display/tooltip-only.
  onSelect?: (group: string) => void
  // Present at the 'lga' and 'ward' levels — a small "back up one level"
  // link next to the title. Needed because a click on THIS chart is what
  // drills down in the first place (unlike H2HTrackingPage's equivalent
  // breakdown charts, which only ever drill via the settlement table's
  // State/LGA selects and so never needed an in-chart way back).
  onDrillUp?: () => void
  drillUpLabel?: string
}

const BAR_COLOR = '#d03b3b'
const ROW_HEIGHT = 22

// Generalizes what used to be two nearly-identical, single-purpose charts —
// StateFlagBreakdownChart.tsx (never actually wired up) and the original
// LgaFlagBreakdownChart.tsx (LGA-only, no drill) — into one drill-aware
// chart shared across all three admin levels. That split only made sense
// while /qc/validation took one `state` at a time (a per-state breakdown of
// a single-state result is always a single bar); now that the backend reads
// state per-row and accepts a multi-state upload (see api/client.ts::
// submitMlosQC), starting at the state level and drilling into LGA and then
// ward is the useful default. MlosQcPage owns the drill state and passes
// down whichever level's data/title/handlers apply; both superseded files
// are stubbed out rather than deleted (see their own comments).
export default function FlagBreakdownChart({
  data,
  title,
  emptyMessage,
  onSelect,
  onDrillUp,
  drillUpLabel,
}: FlagBreakdownChartProps) {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>{title}</h3>
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
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} {data.length === 1 ? 'row' : 'rows'}
        {onSelect ? ' — click a bar to drill down' : ''}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {emptyMessage}
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
                onClick={onSelect ? (entry: GroupFlagBreakdownEntry) => onSelect(entry.group) : undefined}
                cursor={onSelect ? 'pointer' : 'default'}
              >
                {data.map((entry) => (
                  <Cell key={entry.group} fill={BAR_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
