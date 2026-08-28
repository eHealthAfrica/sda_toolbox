import StatCard from '../common/StatCard'

interface PostImplementationSummaryCardsProps {
  totalImages: number
  totalStates: number
  totalLgas: number
  totalSummaryCharts: number
  totalBreakdownCharts: number
}

export default function PostImplementationSummaryCards({
  totalImages,
  totalStates,
  totalLgas,
  totalSummaryCharts,
  totalBreakdownCharts,
}: PostImplementationSummaryCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Charts generated" value={totalImages.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="States covered" value={totalStates.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="LGAs covered" value={totalLgas.toLocaleString()} accentColor="#2c5f9e" hint="unique state + LGA" />
        <StatCard
          label="LGA Summary Charts"
          value={totalSummaryCharts.toLocaleString()}
          accentColor="#4a86e8"
          hint="one per LGA"
        />
        <StatCard
          label="Ward Breakdown Charts"
          value={totalBreakdownCharts.toLocaleString()}
          accentColor="#16a596"
          hint="ward-level, one per LGA"
        />
      </div>
    </section>
  )
}
