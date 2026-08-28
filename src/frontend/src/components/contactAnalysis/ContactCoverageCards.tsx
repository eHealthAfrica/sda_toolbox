import type { CoverageCountEntry } from '../../utils/contactAggregate'
import { COVERAGE_COLORS } from '../../utils/colors'
import StatCard from '../common/StatCard'

interface ContactCoverageCardsProps {
  counts: CoverageCountEntry[]
}

// One card per 'Settlement Coverage' category (harmonize_coverage — the
// single best coverage value across every compared round) — same categories
// and colors as H2H's CoverageCards, since toolbox/campaign/contact_analysis.py
// reuses the exact same coverage vocabulary.
export default function ContactCoverageCards({ counts }: ContactCoverageCardsProps) {
  const total = counts.reduce((sum, c) => sum + c.count, 0)

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Coverage</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {counts.map(({ category, count }) => (
          <StatCard
            key={category}
            label={category}
            value={count.toLocaleString()}
            accentColor={COVERAGE_COLORS[category]}
            hint={total > 0 ? `${((count / total) * 100).toFixed(1)}% of settlements` : undefined}
          />
        ))}
      </div>
    </section>
  )
}
