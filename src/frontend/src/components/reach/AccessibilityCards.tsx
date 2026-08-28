import type { AccessibilityCountEntry } from '../../utils/reachAggregate'
import { ACCESSIBILITY_COLORS } from '../../utils/colors'
import StatCard from '../common/StatCard'

interface AccessibilityCardsProps {
  counts: AccessibilityCountEntry[]
}

// Overall totals for the uploaded file's own "Accessibility status" column
// — quick-scan companion to AccessibilityByStateChart below it, same
// pairing as ReachVisitationCards + LgaVisitationChart for status.
export default function AccessibilityCards({ counts }: AccessibilityCardsProps) {
  const total = counts.reduce((sum, c) => sum + c.count, 0)

  if (total === 0) return null

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Accessibility status</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {counts.map(({ category, count }) => (
          <StatCard
            key={category}
            label={category}
            value={count.toLocaleString()}
            accentColor={ACCESSIBILITY_COLORS[category]}
            hint={total > 0 ? `${((count / total) * 100).toFixed(1)}% of settlements` : undefined}
          />
        ))}
      </div>
    </section>
  )
}
