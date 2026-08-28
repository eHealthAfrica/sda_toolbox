import StatCard from '../common/StatCard'

interface QcSummaryCardsProps {
  totalSettlements: number
  totalFlagged: number
  totalLgas: number
  flaggedOnlyActive?: boolean
  onToggleFlaggedOnly?: () => void
}

export default function QcSummaryCards({
  totalSettlements,
  totalFlagged,
  totalLgas,
  flaggedOnlyActive,
  onToggleFlaggedOnly,
}: QcSummaryCardsProps) {
  const flaggedPct = totalSettlements > 0 ? ((totalFlagged / totalSettlements) * 100).toFixed(1) : null

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total settlements QC'ed" value={totalSettlements.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard
          label="Flagged settlements"
          value={totalFlagged.toLocaleString()}
          accentColor="#d03b3b"
          hint={flaggedPct ? `${flaggedPct}% of settlements` : undefined}
          active={flaggedOnlyActive}
          onClick={onToggleFlaggedOnly}
        />
        <StatCard label="Total LGAs" value={totalLgas.toLocaleString()} accentColor="#2c5f9e" />
      </div>
    </section>
  )
}
