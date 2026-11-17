import StatCard from '../common/StatCard'

interface TargetAreaBufferSummaryCardsProps {
  totalStates: number
  totalLgas: number
  totalWards: number
  totalSettlements: number
  foundInVoronoiAndGridded: number
  missingVoronoi: number
}

// Trimmed version of TargetAreaSummaryCards for the buffer-strategy TA —
// there's only one input file here (the planned settlement list doubles as
// the geometry source), so the whole second row of "planned list" cards on
// the original component doesn't apply and would just read as "no planned
// list uploaded" noise on every single run. "Missing a voronoi TA" is
// always measured against the uploaded file itself (parsed client-side —
// see TargetAreaBufferPage.tsx's plannedListRef), since that's the only
// reference there is to diff against.
export default function TargetAreaBufferSummaryCards({
  totalStates,
  totalLgas,
  totalWards,
  totalSettlements,
  foundInVoronoiAndGridded,
  missingVoronoi,
}: TargetAreaBufferSummaryCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="States" value={totalStates.toLocaleString()} accentColor="#2c5f9e" hint="where TA was generated" />
        <StatCard label="LGAs" value={totalLgas.toLocaleString()} accentColor="#2c5f9e" hint="unique state + LGA" />
        <StatCard label="Wards" value={totalWards.toLocaleString()} accentColor="#2c5f9e" hint="unique state + LGA + ward" />
        <StatCard
          label="Settlements"
          value={totalSettlements.toLocaleString()}
          accentColor="#2c5f9e"
          hint="unique state + LGA + ward + settlement, from the voronoi output"
        />
        <StatCard
          label="Found in voronoi + gridded"
          value={foundInVoronoiAndGridded.toLocaleString()}
          accentColor="#0ca30c"
          hint="unique settlements present in BOTH the voronoi and gridded TA outputs"
        />
        <StatCard
          label="Missing a voronoi TA"
          value={missingVoronoi.toLocaleString()}
          accentColor={missingVoronoi > 0 ? '#d03b3b' : '#9aa5b1'}
          hint="in the uploaded planned settlement list but absent from the voronoi output"
        />
      </div>
    </section>
  )
}
