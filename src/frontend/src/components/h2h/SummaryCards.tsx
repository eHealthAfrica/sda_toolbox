import { formatMinutesSpent } from '../../utils/aggregate'
import StatCard from '../common/StatCard'

interface SummaryCardsProps {
  totalSettlements: number
  totalStates: number
  totalLgas: number
  totalWards: number
  // Sum of the backend's 'time_spent_mins' column (toolbox/campaign/
  // visitation_analysis.py) across whatever's currently in view — like every
  // other card here, this reads as "for the current State/LGA/Ward drill +
  // coverage/visitation filter", not always the full run's total. See
  // utils/aggregate.ts::computeTotalTimeSpent/formatMinutesSpent.
  totalTimeSpentMins: number
}

export default function SummaryCards({
  totalSettlements,
  totalStates,
  totalLgas,
  totalWards,
  totalTimeSpentMins,
}: SummaryCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total states" value={totalStates.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total LGAs" value={totalLgas.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total wards" value={totalWards.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total planned settlements" value={totalSettlements.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard
          label="Total time spent"
          value={formatMinutesSpent(totalTimeSpentMins)}
          accentColor="#2c5f9e"
          hint="Sum of GPS-tracked minutes across these settlements"
        />
      </div>
    </section>
  )
}
