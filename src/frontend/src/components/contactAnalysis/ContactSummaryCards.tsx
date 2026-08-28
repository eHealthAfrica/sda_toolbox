import StatCard from '../common/StatCard'

interface ContactSummaryCardsProps {
  totalSettlements: number
  totalStates: number
  totalLgas: number
  totalWards: number
  totalRounds: number
}

// LGA/ward counts here are already deduplicated against their parent admin
// level(s) — see utils/contactAggregate.ts::lgaKey/wardKey — so a repeated
// LGA or ward name in a different state/LGA is correctly counted as
// distinct. `totalRounds` is the number of previous-campaign round columns
// this particular upload's response actually had (see
// utils/contactAggregate.ts::detectRoundColumns) — not a fixed constant,
// since it comes from however many sheets the uploaded workbook had.
export default function ContactSummaryCards({
  totalSettlements,
  totalStates,
  totalLgas,
  totalWards,
  totalRounds,
}: ContactSummaryCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total settlements analysed" value={totalSettlements.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="States analysed" value={totalStates.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="LGAs analysed" value={totalLgas.toLocaleString()} accentColor="#2c5f9e" hint="unique state + LGA" />
        <StatCard
          label="Wards analysed"
          value={totalWards.toLocaleString()}
          accentColor="#2c5f9e"
          hint="unique state + LGA + ward"
        />
        <StatCard
          label="Campaign rounds compared"
          value={totalRounds.toLocaleString()}
          accentColor="#2c5f9e"
          hint="From Previous Rounds"
        />
      </div>
    </section>
  )
}
