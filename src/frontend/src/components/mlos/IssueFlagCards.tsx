import type { IssueFlagCount } from '../../utils/mlosAggregate'
import StatCard from '../common/StatCard'

interface IssueFlagCardsProps {
  counts: IssueFlagCount[]
  activeKey?: string | null
  onSelect?: (key: string) => void
}

// One card per QC check column — toolbox/apps/mlos/qc_mlos.py::flag_settlements
// unions all of these (plus a few not surfaced individually here) into
// is_flagged. Each count is rows where that specific check column is
// non-empty, i.e. that specific issue was found on the row.
export default function IssueFlagCards({ counts, activeKey, onSelect }: IssueFlagCardsProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>QC issue breakdown</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {counts.map(({ key, label, hint, count }) => (
          <StatCard
            key={key}
            label={label}
            value={count.toLocaleString()}
            accentColor="#fab219"
            hint={hint}
            active={activeKey === key}
            onClick={onSelect ? () => onSelect(key) : undefined}
          />
        ))}
      </div>
    </section>
  )
}
