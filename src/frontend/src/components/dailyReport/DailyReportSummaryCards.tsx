import StatCard from '../common/StatCard'

interface DailyReportSummaryCardsProps {
  totalImages: number
  totalStates: number
  daySummaryCount: number
  cumulativeSummaryCount: number
  dayBreakdownCount: number
  cumulativeBreakdownCount: number
}

// Six stat cards rather than Post Implementation's five — DailyReport's
// Summary and Breakdown counts each split further into Day and Cumulative
// (see types/dailyReport.ts), so a single "LGA Summary Charts" figure would
// silently sum two very different things together.
export default function DailyReportSummaryCards({
  totalImages,
  totalStates,
  daySummaryCount,
  cumulativeSummaryCount,
  dayBreakdownCount,
  cumulativeBreakdownCount,
}: DailyReportSummaryCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Charts generated" value={totalImages.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="States covered" value={totalStates.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Day Summary Charts" value={daySummaryCount.toLocaleString()} accentColor="#4a86e8" hint="one per state" />
        <StatCard
          label="Cumulative Summary Charts"
          value={cumulativeSummaryCount.toLocaleString()}
          accentColor="#4a86e8"
          hint="one per state"
        />
        <StatCard
          label="Day Breakdown Charts"
          value={dayBreakdownCount.toLocaleString()}
          accentColor="#16a596"
          hint="LGA-level, one per state"
        />
        <StatCard
          label="Cumulative Breakdown Charts"
          value={cumulativeBreakdownCount.toLocaleString()}
          accentColor="#16a596"
          hint="LGA-level, one per state"
        />
      </div>
    </section>
  )
}
