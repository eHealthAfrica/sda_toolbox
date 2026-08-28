import StatCard from '../common/StatCard'

interface TargetAreaSummaryCardsProps {
  totalStates: number
  totalLgas: number
  totalWards: number
  totalSettlements: number
  foundInVoronoiAndGridded: number
  missingVoronoi: number
  missingVoronoiReference: 'mlos' | 'gridded'
  plannedListSettlements: number
  hasPlannedList: boolean
  plannedListSource: 'file' | 'voronoi-proxy' | 'unreadable'
  plannedFoundInVoronoiAndGridded: number
  plannedMissingVoronoi: number
}

// Line 1: the four "analysed" counts (de-duplicated against every parent
// admin level — see utils/targetAreaAggregate.ts, same rationale as REACH)
// plus two voronoi-vs-gridded coverage checks computed the same way, all
// against the FULL run. Line 2 is the same shape again but scoped to the
// planned list, so the two rows read as parallel comparisons rather than
// unrelated stats.
export default function TargetAreaSummaryCards({
  totalStates,
  totalLgas,
  totalWards,
  totalSettlements,
  foundInVoronoiAndGridded,
  missingVoronoi,
  missingVoronoiReference,
  plannedListSettlements,
  hasPlannedList,
  plannedListSource,
  plannedFoundInVoronoiAndGridded,
  plannedMissingVoronoi,
}: TargetAreaSummaryCardsProps) {
  const plannedListHint = !hasPlannedList
    ? 'no planned list file was uploaded'
    : plannedListSource === 'unreadable'
      ? "planned list file couldn't be read — showing settlements found in its voronoi output instead"
      : plannedListSource === 'voronoi-proxy'
        ? 'from the voronoi output restricted to the planned list (the uploaded file itself could not be re-read)'
        : plannedListSettlements === 0
          ? 'planned list uploaded but contained no valid settlements'
          : 'from the uploaded planned list file'

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
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
          hint={
            missingVoronoiReference === 'mlos'
              ? 'in the uploaded MLoS file but absent from the voronoi output'
              : "in the gridded TA output but absent from voronoi (the MLoS file itself couldn't be re-read for a fuller check)"
          }
        />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard
          label="Settlements in planned list"
          value={plannedListSettlements.toLocaleString()}
          accentColor={hasPlannedList ? '#2c5f9e' : '#9aa5b1'}
          hint={plannedListHint}
        />
        <StatCard
          label="Planned list: found in voronoi + gridded"
          value={plannedFoundInVoronoiAndGridded.toLocaleString()}
          accentColor={hasPlannedList ? '#0ca30c' : '#9aa5b1'}
          hint={hasPlannedList ? 'unique planned-list settlements present in BOTH subset outputs' : 'no planned list file was uploaded'}
        />
        <StatCard
          label="Planned list: missing a voronoi TA"
          value={plannedMissingVoronoi.toLocaleString()}
          accentColor={hasPlannedList && plannedMissingVoronoi > 0 ? '#d03b3b' : '#9aa5b1'}
          hint={hasPlannedList ? 'in the planned list but absent from its voronoi subset output' : 'no planned list file was uploaded'}
        />
      </div>
    </section>
  )
}
