import type { ReachCountEntry } from '../../utils/reachAggregate'
import { getReachCountColor } from '../../utils/colors'
import StatCard from '../common/StatCard'

interface ReachCountCardsProps {
  counts: ReachCountEntry[]
}

function reachLabel(reach: number): string {
  return `${reach} source${reach === 1 ? '' : 's'}`
}

// Surfaces toolbox/triangulate/triangulate.py's `reach` column directly —
// how many independent data sources corroborated each settlement (0-3
// today: eTally/MST/GTS — see utils/reachAggregate.ts::computeReachCounts).
// `status` (ReachVisitationCards above this) is fully derived from `reach`
// (reach===0 -> 'Not Visited', else 'Visited'), so this is a more granular
// view of the same underlying signal, not a separate metric — it answers
// "how well corroborated," not just "visited or not."
export default function ReachCountCards({ counts }: ReachCountCardsProps) {
  const total = counts.reduce((sum, c) => sum + c.count, 0)

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Reach count — sources corroborating each settlement</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {counts.map(({ reach, count }) => (
          <StatCard
            key={reach}
            label={reachLabel(reach)}
            value={count.toLocaleString()}
            accentColor={getReachCountColor(reach)}
            hint={total > 0 ? `${((count / total) * 100).toFixed(1)}% of settlements` : undefined}
          />
        ))}
      </div>
    </section>
  )
}
