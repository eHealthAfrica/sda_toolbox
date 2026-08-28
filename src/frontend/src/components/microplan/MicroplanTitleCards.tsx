import StatCard from '../common/StatCard'
import type { CombineAnalysis } from '../../types/microplan'

interface MicroplanTitleCardsProps {
  analysis: CombineAnalysis
}

// Row 1: composition counts (LGAs → Wards → Settlements → Special Places,
// narrowing top to bottom). Row 2: Teams and Target Population (Under-5)
// share their own line — both need more room to breathe than a plain count,
// and Target Population intentionally shows nothing but the final number
// (see utils/microplanCombine.ts for the de-duplication + 20% under-5 method
// behind it).
export default function MicroplanTitleCards({ analysis }: MicroplanTitleCardsProps) {
  const largestLga = analysis.teamsByLga.length
    ? analysis.settlements.reduce<Record<string, number>>((counts, s) => {
        counts[s.lga] = (counts[s.lga] ?? 0) + 1
        return counts
      }, {})
    : {}
  const largestLgaEntry = Object.entries(largestLga).sort((a, b) => b[1] - a[1])[0]
  const avgSettlementsPerWard = analysis.wardCount ? Math.round(analysis.settlementCount / analysis.wardCount) : 0
  const avgTeamsPerWard = analysis.wardCount ? Math.round((analysis.teamCount / analysis.wardCount) * 10) / 10 : 0
  const specialPlaceHint = analysis.specialPlaceTypeBreakdown
    .map((b) => `${b.count} ${b.label}${b.count === 1 ? '' : 's'}`)
    .join(' · ')

  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <StatCard label="LGAs" value={analysis.lgaCount.toLocaleString()} accentColor="#2c5f9e" hint="see team breakdown by LGA → ward below" />
        <StatCard
          label="Wards"
          value={analysis.wardCount.toLocaleString()}
          accentColor="#2c5f9e"
          hint={`avg ${avgSettlementsPerWard} settlements / ward${largestLgaEntry ? ` · ${largestLgaEntry[0]} largest (${largestLgaEntry[1].toLocaleString()})` : ''}`}
        />
        <StatCard
          label="Settlements"
          value={analysis.settlementCount.toLocaleString()}
          accentColor="#2c5f9e"
          hint={`across ${analysis.wardCount.toLocaleString()} wards · ${analysis.rawPopulation.toLocaleString()} total population`}
        />
        <StatCard label="Special Places" value={analysis.specialPlaceCount.toLocaleString()} accentColor="#2c5f9e" hint={specialPlaceHint} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard label="Teams" value={analysis.teamCount.toLocaleString()} accentColor="#2c5f9e" hint={`avg ${avgTeamsPerWard} teams / ward — drill-down below`} />
        <StatCard label="Target Population (Under-5)" value={analysis.targetPopulationUnder5.toLocaleString()} accentColor="#2c5f9e" />
      </div>
    </>
  )
}
