import type { CountEntry } from '../../utils/aggregate'
import { VISITATION_COLORS } from '../../utils/colors'
import { extractDayNumber } from '../../utils/columns'
import type { VisitationStatus } from '../../types/h2h'
import StatCard from '../common/StatCard'

interface VisitationCardsProps {
  counts: CountEntry<VisitationStatus>[]
  cumColumnLabel: string
  activeStatus?: VisitationStatus | null
  onSelect?: (status: VisitationStatus) => void
}

// Counts for the same day_{N}_cumm status the map is colored by — a
// quick-scan companion to the map's per-point popups. Doubles as a filter
// toggle for the map/table below, same convention as CoverageCards.
export default function VisitationCards({ counts, cumColumnLabel, activeStatus, onSelect }: VisitationCardsProps) {
  const total = counts.reduce((sum, c) => sum + c.count, 0)
  // cumColumnLabel is the raw column name (e.g. "day_6_cumm") — show the
  // human day number instead of the raw column when we can pull one out.
  const dayNumber = extractDayNumber(cumColumnLabel)
  const title = dayNumber !== null ? `Visitation status (Day ${dayNumber})` : `Visitation status (${cumColumnLabel})`

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>{title}</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {counts.map(({ category, count }) => (
          <StatCard
            key={category}
            label={category}
            value={count.toLocaleString()}
            accentColor={VISITATION_COLORS[category]}
            hint={total > 0 ? `${((count / total) * 100).toFixed(1)}% of settlements` : undefined}
            active={activeStatus === category}
            onClick={onSelect ? () => onSelect(category) : undefined}
          />
        ))}
      </div>
    </section>
  )
}
