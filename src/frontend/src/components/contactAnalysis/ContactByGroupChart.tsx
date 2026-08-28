import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GroupContactEntry } from '../../utils/contactAggregate'
import { getContactCountColor } from '../../utils/colors'

interface ContactByGroupChartProps {
  data: GroupContactEntry[]
  title: string
  groupLabel: string
  emptyMessage: string
  maxContact: number
  // Present at every drill level except the deepest (ward) — clicking a bar
  // drills the whole page's shared state -> LGA -> ward selection one level
  // further in. See ContactAnalysisPage.tsx's drillLevel/handleDrillSelect.
  onSelect?: (group: string) => void
}

const ROW_HEIGHT = 24

// Average `contact` (rounds visited) per group at the page's current drill
// level, one bar per group graded on the same continuous good/critical ramp
// as the map and count cards (utils/colors.ts::getContactCountColor) rather
// than a single flat bar color — so a low-contact group reads red at a
// glance without needing to check the axis.
export default function ContactByGroupChart({ data, title, groupLabel, emptyMessage, maxContact, onSelect }: ContactByGroupChartProps) {
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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>{title}</h3>
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
              <XAxis type="number" domain={[0, maxContact]} allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="group" width={170} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip formatter={(value: number) => [value.toFixed(2), 'Average contact']} />
              <Bar
                dataKey="avgContact"
                barSize={12}
                radius={[0, 2, 2, 0]}
                cursor={onSelect ? 'pointer' : undefined}
                onClick={onSelect ? (entry: GroupContactEntry) => onSelect(entry.group) : undefined}
              >
                {data.map((entry) => (
                  <Cell key={entry.group} fill={getContactCountColor(entry.avgContact, maxContact)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
