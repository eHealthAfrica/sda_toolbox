import type { CountEntry } from '../../utils/reachAggregate'
import { REACH_VISITATION_COLORS } from '../../utils/colors'
import type { ReachVisitationStatus } from '../../types/reach'
import StatCard from '../common/StatCard'

interface ReachVisitationCardsProps {
  counts: CountEntry<ReachVisitationStatus>[]
}

export default function ReachVisitationCards({ counts }: ReachVisitationCardsProps) {
  const total = counts.reduce((sum, c) => sum + c.count, 0)

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Reach status</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {counts.map(({ category, count }) => (
          <StatCard
            key={category}
            label={category}
            value={count.toLocaleString()}
            accentColor={REACH_VISITATION_COLORS[category]}
            hint={total > 0 ? `${((count / total) * 100).toFixed(1)}% of settlements` : undefined}
          />
        ))}
      </div>
    </section>
  )
}
