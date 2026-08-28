import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GroupVisitationEntry } from '../../utils/reachAggregate'
import { REACH_VISITATION_COLORS } from '../../utils/colors'
import type { ReachVisitationStatus } from '../../types/reach'
import { REACH_VISITATION_STATUSES } from '../../types/reach'

interface LgaVisitationChartProps {
  data: GroupVisitationEntry[]
  title: string
  groupLabel: string
  emptyMessage: string
  // Present at every drill level except the deepest (ward) — clicking a bar
  // drills the whole page's shared state -> LGA -> ward selection one level
  // further in. See ReachAnalysisPage.tsx's drillLevel/handleDrillSelect.
  onSelect?: (group: string) => void
}

const ROW_HEIGHT = 24

// Visited/Not Visited breakdown, one row per group at the page's current
// drill level (state, then LGA within the selected state, then ward within
// the selected LGA) — see utils/reachAggregate.ts::computeVisitationByGroup.
export default function LgaVisitationChart({ data, title, groupLabel, emptyMessage, onSelect }: LgaVisitationChartProps) {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14 }}>{title}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(REACH_VISITATION_STATUSES as readonly ReachVisitationStatus[]).map((status) => (
            <span key={status} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: REACH_VISITATION_COLORS[status], display: 'inline-block' }} />
              {status}
            </span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} {groupLabel}
        {onSelect && data.length > 0 ? ' · click a bar to drill down' : ''}
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
              <YAxis type="category" dataKey="group" width={170} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip />
              {(REACH_VISITATION_STATUSES as readonly ReachVisitationStatus[]).map((status) => (
                <Bar
                  key={status}
                  dataKey={status}
                  stackId="visitation"
                  fill={REACH_VISITATION_COLORS[status]}
                  barSize={14}
                  cursor={onSelect ? 'pointer' : undefined}
                  onClick={onSelect ? (entry: GroupVisitationEntry) => onSelect(entry.group) : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
