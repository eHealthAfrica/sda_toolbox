import StatCard from '../common/StatCard'
import type { GeographyCoverage } from '../../utils/duplicateCheckerAggregate'

interface DuplicateCoverageCardsProps {
  coverage: GeographyCoverage
}

// Plain, read-only geography tiles — no click-to-filter here (drilling
// happens via the breakdown chart or the pairs table's own State/LGA/Ward
// selects instead), same convention as MLoS QC's QcSummaryCards. Reflects
// whatever the current State/LGA/Ward drill has scoped the page down to, not
// always the full run's totals.
//
// Labels say "with flagged pairs" / "in flagged pairs" on purpose: these
// counts come from the flagged-pair rows only (see
// utils/duplicateCheckerAggregate.ts::computeGeographyCoverage), NOT from
// everything the backend scanned — the result CSV carries no scan totals —
// so "reviewed" overstated what the numbers mean.
export default function DuplicateCoverageCards({ coverage }: DuplicateCoverageCardsProps) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="States with flagged pairs" value={coverage.states.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="LGAs with flagged pairs" value={coverage.lgas.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Wards with flagged pairs" value={coverage.wards.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Settlements in flagged pairs" value={coverage.settlements.toLocaleString()} accentColor="#2c5f9e" />
      </div>
    </section>
  )
}
