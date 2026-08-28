import StatCard from '../common/StatCard'

interface ReachSummaryCardsProps {
  totalSettlements: number
  totalStates: number
  totalLgas: number
  totalWards: number
}

// LGA/ward counts here are already deduplicated against their parent admin
// level(s) — see utils/reachAggregate.ts::lgaKey/wardKey — so a repeated LGA
// or ward name in a different state/LGA is correctly counted as distinct.
export default function ReachSummaryCards({ totalSettlements, totalStates, totalLgas, totalWards }: ReachSummaryCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total settlements analysed" value={totalSettlements.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="States analysed" value={totalStates.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard
          label="LGAs analysed"
          value={totalLgas.toLocaleString()}
          accentColor="#2c5f9e"
          hint="unique state + LGA"
        />
        <StatCard
          label="Wards analysed"
          value={totalWards.toLocaleString()}
          accentColor="#2c5f9e"
          hint="unique state + LGA + ward"
        />
      </div>
    </section>
  )
}
