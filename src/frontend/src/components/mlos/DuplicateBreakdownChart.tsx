import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DuplicateGroupBreakdownEntry } from '../../utils/duplicateCheckerAggregate'
import type { ReviewOutcome } from '../../types/duplicateChecker'

interface DuplicateBreakdownChartProps {
  data: DuplicateGroupBreakdownEntry[]
  title: string
  subtitle: string
  emptyMessage: string
  // Present at the 'state' and 'lga' levels — clicking a bar drills one
  // level down (state -> LGA -> ward). Omitted at the 'ward' level, the
  // bottom of the hierarchy: a ward click there toggles the pairs table's
  // ward filter instead (owned by the page, not this chart).
  onSelect?: (group: string) => void
  onDrillUp?: () => void
  drillUpLabel?: string
  activeOutcome: ReviewOutcome | null
  onToggleOutcome: (outcome: ReviewOutcome) => void
}

const ROW_HEIGHT = 24
const OUTCOME_COLORS: Record<ReviewOutcome, string> = {
  'Duplicate Remove': 'var(--color-critical)',
  'Duplicate Review': 'var(--color-warning)',
  'Unlikely Potential Duplicate Review': 'var(--color-good)',
}
const LEGEND_ITEMS: { outcome: ReviewOutcome; label: string }[] = [
  { outcome: 'Duplicate Remove', label: 'Duplicate Remove' },
  { outcome: 'Duplicate Review', label: 'Duplicate Review' },
  { outcome: 'Unlikely Potential Duplicate Review', label: 'Unlikely Potential Duplicate' },
]
const OUTCOME_BY_DATA_KEY: Record<string, ReviewOutcome> = {
  remove: 'Duplicate Remove',
  review: 'Duplicate Review',
  unlikely: 'Unlikely Potential Duplicate Review',
}

// State -> LGA -> Ward drill-down breakdown, stacked by review outcome — the
// duplicate-checker analogue of MLoS QC's FlagBreakdownChart. Unlike that
// chart (a single flagged/total bar per group), every row here is already a
// flagged pair, so the useful split is the three review outcomes stacked
// within each group's bar, with a legend that doubles as the same
// click-to-filter control the stat cards above offer.
export default function DuplicateBreakdownChart({
  data,
  title,
  subtitle,
  emptyMessage,
  onSelect,
  onDrillUp,
  drillUpLabel,
  activeOutcome,
  onToggleOutcome,
}: DuplicateBreakdownChartProps) {
  const chartHeight = Math.max(180, data.length * ROW_HEIGHT)

  function handleBarClick(entry: DuplicateGroupBreakdownEntry) {
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
                dataKey="remove"
                stackId="review"
                fill={OUTCOME_COLORS['Duplicate Remove']}
                onClick={onSelect ? handleBarClick : undefined}
                cursor={onSelect ? 'pointer' : 'default'}
              />
              <Bar
                dataKey="review"
                stackId="review"
                fill={OUTCOME_COLORS['Duplicate Review']}
                onClick={onSelect ? handleBarClick : undefined}
                cursor={onSelect ? 'pointer' : 'default'}
              />
              <Bar
                dataKey="unlikely"
                stackId="review"
                fill={OUTCOME_COLORS['Unlikely Potential Duplicate Review']}
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
