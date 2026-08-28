import type { CountEntry } from '../../utils/aggregate'
import { COVERAGE_COLORS } from '../../utils/colors'
import type { SettlementCoverageCategory } from '../../types/h2h'
import StatCard from '../common/StatCard'

interface CoverageCardsProps {
  counts: CountEntry<SettlementCoverageCategory>[]
  activeCategory?: SettlementCoverageCategory | null
  onSelect?: (category: SettlementCoverageCategory) => void
}

// One card per 'Settlement Coverage' category
// (toolbox/campaign/campaign_tools.py::classify_coverage): Fully Covered,
// Partially Covered, Poorly Covered, No Coverage. Doubles as a filter toggle
// for the map/table below, same "click to filter, click again to clear"
// convention as MlosQcPage's IssueFlagCards.
export default function CoverageCards({ counts, activeCategory, onSelect }: CoverageCardsProps) {
  const total = counts.reduce((sum, c) => sum + c.count, 0)

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Settlement coverage</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {counts.map(({ category, count }) => (
          <StatCard
            key={category}
            label={category}
            value={count.toLocaleString()}
            accentColor={COVERAGE_COLORS[category]}
            hint={total > 0 ? `${((count / total) * 100).toFixed(1)}% of settlements` : undefined}
            active={activeCategory === category}
            onClick={onSelect ? () => onSelect(category) : undefined}
          />
        ))}
      </div>
    </section>
  )
}
