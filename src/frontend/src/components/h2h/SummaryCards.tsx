import StatCard from '../common/StatCard'

interface SummaryCardsProps {
  totalSettlements: number
  totalStates: number
  totalLgas: number
  totalWards: number
}

export default function SummaryCards({ totalSettlements, totalStates, totalLgas, totalWards }: SummaryCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total planned settlements" value={totalSettlements.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total states" value={totalStates.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total LGAs" value={totalLgas.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total wards" value={totalWards.toLocaleString()} accentColor="#2c5f9e" />
      </div>
    </section>
  )
}
