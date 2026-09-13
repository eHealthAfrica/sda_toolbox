import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AgreementGroupBreakdownEntry } from '../../utils/coordinateReviewAggregate'
import type { AgreementStatus } from '../../types/coordinateReview'

interface CoordinateReviewBreakdownChartProps {
  data: AgreementGroupBreakdownEntry[]
  title: string
  subtitle: string
  emptyMessage: string
  // Present at the 'state' and 'lga' levels — clicking a bar drills one
  // level down (state -> LGA -> ward). Omitted at the 'ward' level, the
  // bottom of the hierarchy: a ward click there toggles the results table's
  // ward filter instead (owned by the page, not this chart).
  onSelect?: (group: string) => void
  onDrillUp?: () => void
  drillUpLabel?: string
  activeOutcome: AgreementStatus | null
  onToggleOutcome: (outcome: AgreementStatus) => void
}

const ROW_HEIGHT = 24
// Same colors as CoordinateReviewSummaryCards' three outcome cards, so the
// chart's legend reads as the same three buckets a user already recognizes
// from the stat cards above it.
const OUTCOME_COLORS: Record<AgreementStatus, string> = {
  review: 'var(--color-critical)',
  consistent: 'var(--color-good)',
  none: 'var(--color-text-muted)',
}
const LEGEND_ITEMS: { outcome: AgreementStatus; label: string }[] = [
  { outcome: 'review', label: 'Needs review' },
  { outcome: 'consistent', label: 'Consistent with original' },
  { outcome: 'none', label: 'No consensus' },
]
const OUTCOME_BY_DATA_KEY: Record<string, AgreementStatus> = {
  review: 'review',
  consistent: 'consistent',
  none: 'none',
}

// State -> LGA -> Ward drill-down breakdown, stacked by recommendation
// outcome — the Coordinate Review analogue of Duplicate Checker's
// DuplicateBreakdownChart. Every settlement in this result already has a
// recommendation (review/consistent/none, see analyzeRow), so the useful
// split is the three outcomes stacked within each group's bar, with a
// legend that doubles as the same click-to-filter control the summary cards
// above offer.
export default function CoordinateReviewBreakdownChart({
  data,
  title,
  subtitle,
  emptyMessage,
  onSelect,
  onDrillUp,
  drillUpLabel,
  activeOutcome,
  onToggleOutcome,
}: CoordinateReviewBreakdownChartProps) {
  const chartHeight = Math.max(180, data.length * ROW_HEIGHT)

  function handleBarClick(entry: AgreementGroupBreakdownEntry) {
    if (onSelect) onSelect(entry.group)
  }

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
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>{subtitle}</div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        {LEGEND_ITEMS.map((item) => {
          const active = activeOutcome === item.outcome
          const dimmed = activeOutcome !== null && !active
          return (
            <button
              key={item.outcome}
              type="button"
              onClick={() => onToggleOutcome(item.outcome)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11.5,
                fontWeight: active ? 700 : 500,
                opacity: dimmed ? 0.45 : 1,
                color: 'var(--color-text)',
              }}
            >
              <span
                style={{ width: 9, height: 9, borderRadius: 2, background: OUTCOME_COLORS[item.outcome], display: 'inline-block' }}
              />
              {item.label}
            </button>
          )
        })}
      </div>

      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="group" width={130} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip
                formatter={(value: number, dataKey: string) => [value.toLocaleString(), OUTCOME_BY_DATA_KEY[dataKey] ?? dataKey]}
              />
              <Bar
                dataKey="review"
                stackId="agreement"
                fill={OUTCOME_COLORS.review}
                onClick={onSelect ? handleBarClick : undefined}
                cursor={onSelect ? 'pointer' : 'default'}
              />
              <Bar
                dataKey="consistent"
                stackId="agreement"
                fill={OUTCOME_COLORS.consistent}
                onClick={onSelect ? handleBarClick : undefined}
                cursor={onSelect ? 'pointer' : 'default'}
              />
              <Bar
                dataKey="none"
                stackId="agreement"
                fill={OUTCOME_COLORS.none}
                radius={[0, 2, 2, 0]}
                onClick={onSelect ? handleBarClick : undefined}
                cursor={onSelect ? 'pointer' : 'default'}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
