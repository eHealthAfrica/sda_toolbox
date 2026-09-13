import StatCard from '../common/StatCard'
import type { ReviewOutcome } from '../../types/duplicateChecker'
import type { ReviewOutcomeCounts } from '../../utils/duplicateCheckerAggregate'

interface DuplicateStatCardsProps {
  counts: ReviewOutcomeCounts
  decidedCount: number
  activeOutcome: ReviewOutcome | null
  onSelect: (outcome: ReviewOutcome) => void
}

// Total pairs / Decided are plain read-outs; the three review-outcome cards
// double as filter toggles for the pairs table below, same click-to-filter
// convention as MLoS QC's IssueFlagCards (StatCard's own onClick/active
// props already render the "click to filter" hint and highlight).
export default function DuplicateStatCards({ counts, decidedCount, activeOutcome, onSelect }: DuplicateStatCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total pairs flagged" value={counts.total.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard
          label="Duplicate Remove"
          value={counts.byOutcome['Duplicate Remove'].toLocaleString()}
          accentColor="var(--color-critical)"
          onClick={() => onSelect('Duplicate Remove')}
          active={activeOutcome === 'Duplicate Remove'}
        />
        <StatCard
          label="Duplicate Review"
          value={counts.byOutcome['Duplicate Review'].toLocaleString()}
          accentColor="var(--color-warning)"
          onClick={() => onSelect('Duplicate Review')}
          active={activeOutcome === 'Duplicate Review'}
        />
        <StatCard
          label="Unlikely Potential Duplicate"
          value={counts.byOutcome['Unlikely Potential Duplicate Review'].toLocaleString()}
          accentColor="var(--color-good)"
          onClick={() => onSelect('Unlikely Potential Duplicate Review')}
          active={activeOutcome === 'Unlikely Potential Duplicate Review'}
        />
        <StatCard
          label="Decided"
          value={`${decidedCount.toLocaleString()} / ${counts.total.toLocaleString()}`}
          accentColor="#2c5f9e"
          hint="Pairs with a review decision recorded"
        />
      </div>
    </section>
  )
}
