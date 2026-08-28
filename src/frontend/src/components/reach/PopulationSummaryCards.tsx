import type { PopulationSummary } from '../../utils/reachAggregate'
import StatCard from '../common/StatCard'

interface PopulationSummaryCardsProps {
  summary: PopulationSummary
  totalSettlements: number
}

// "Potentially missed children" is the population figure summed across
// 'Not Visited' settlements — not a backend-computed field (REACH's own
// pipeline never touches population), so this whole section only renders
// when a population column was actually detected — see
// utils/reachAggregate.ts::computePopulationSummary and the caveat on
// utils/columns.ts::DetectedColumns.population.
export default function PopulationSummaryCards({ summary, totalSettlements }: PopulationSummaryCardsProps) {
  const missedPct = summary.totalPopulation > 0 ? ((summary.missedPopulation / summary.totalPopulation) * 100).toFixed(1) : null

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Population coverage</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard
          label="Target Population"
          value={summary.totalPopulation.toLocaleString()}
          accentColor="#2c5f9e"
          hint={`across ${summary.settlementsWithPopulation.toLocaleString()} of ${totalSettlements.toLocaleString()} settlements with a population figure`}
        />
        <StatCard
          label="Potentially reached children"
          value={summary.visitedPopulation.toLocaleString()}
          accentColor="#0ca30c"
          hint={missedPct ? `${(100 - Number(missedPct)).toFixed(1)}% of Target Population, in Visited settlements` : undefined}
        />
        <StatCard
          label="Potentially missed children"
          value={summary.missedPopulation.toLocaleString()}
          accentColor="#d03b3b"
          hint={missedPct ? `${missedPct}% of Target Population, in Not Visited settlements` : undefined}
        />
      </div>
    </section>
  )
}
