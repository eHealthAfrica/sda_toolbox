import StatCard from '../common/StatCard'

interface QcSummaryCardsProps {
  totalSettlements: number
  totalStates: number
  totalLgas: number
  totalWards: number
  totalFlagged: number
}

// Plain, read-only stat tiles — no click-to-filter here (that filter was
// removed; use the issue/status/proximity charts below, or the settlement
// table's own State/LGA/Ward selects, to narrow the view instead). Numbers
// always reflect whatever the current State/LGA/Ward drill + chart filter
// has scoped the page down to, so these read as "the current view", not
// always the full run's totals — see MlosQcPage.tsx.
//
// Total states/wards are new alongside the existing settlements/LGAs cards:
// /qc/validation dropped its single `state` param (api/client.ts::
// submitMlosQC), so a QC result can now genuinely span more than one state,
// and a wards count is as meaningful as the LGA one already was.
export default function QcSummaryCards({
  totalSettlements,
  totalStates,
  totalLgas,
  totalWards,
  totalFlagged,
}: QcSummaryCardsProps) {
  const flaggedPct = totalSettlements > 0 ? ((totalFlagged / totalSettlements) * 100).toFixed(1) : null

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total states" value={totalStates.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total LGAs" value={totalLgas.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total wards" value={totalWards.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard label="Total settlements QC'ed" value={totalSettlements.toLocaleString()} accentColor="#2c5f9e" />
        <StatCard
          label="Flagged settlements"
          value={totalFlagged.toLocaleString()}
          accentColor="#d03b3b"
          hint={flaggedPct ? `${flaggedPct}% of settlements` : undefined}
        />
      </div>
    </section>
  )
}
