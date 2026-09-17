import StatCard from '../common/StatCard'
import type { AgreementStatus } from '../../types/coordinateReview'
import type { AgreementSummary, GeographyCoverage } from '../../utils/coordinateReviewAggregate'

interface CoordinateReviewSummaryCardsProps {
  coverage: GeographyCoverage
  summary: AgreementSummary
  activeStatus: AgreementStatus | null
  onSelect: (status: AgreementStatus) => void
}

// Plain geography tiles (states/LGAs/wards/settlements, same read-only
// convention as DuplicateCoverageCards) on their own row, followed by the
// three agreement outcomes on a second row — those double as filter toggles
// for the results table below, same click-to-filter convention as Duplicate
// Checker's DuplicateStatCards / MLoS QC's IssueFlagCards. Kept on separate
// rows since the two groups answer different questions (how much geography
// this run covers vs. what it found), not one continuous strip of tiles.
export default function CoordinateReviewSummaryCards({ coverage, summary, activeStatus, onSelect }: CoordinateReviewSummaryCardsProps) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <StatCard label="States covered" value={coverage.states.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="LGAs covered" value={coverage.lgas.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Wards analyzed" value={coverage.wards.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Settlements shown" value={summary.total.toLocaleString()} accentColor="#2c5f9e" />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard
          label="Needs review"
          value={summary.review.toLocaleString()}
          accentColor="var(--color-critical)"
          onClick={() => onSelect('review')}
          active={activeStatus === 'review'}
        />
        <StatCard
          label="Consistent with original"
          value={summary.consistent.toLocaleString()}
          accentColor="var(--color-good)"
          onClick={() => onSelect('consistent')}
          active={activeStatus === 'consistent'}
        />
        <StatCard
          label="No consensus"
          value={summary.none.toLocaleString()}
          accentColor="var(--color-text-muted)"
          onClick={() => onSelect('none')}
          active={activeStatus === 'none'}
        />
      </div>
    </section>
  )
}
