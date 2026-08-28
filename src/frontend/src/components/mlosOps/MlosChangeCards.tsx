import StatCard from '../common/StatCard'
import type { DatasetDiffResult } from '../../utils/datasetDiff'

interface MlosChangeCardsProps {
  diff: DatasetDiffResult
}

// Four cards — one per admin level, as requested. Each card's headline
// number is how many DISTINCT units of that level contain at least one
// changed record (narrowing as you go from State down to Settlement, since
// every changed settlement belongs to exactly one state/LGA/ward). The
// State/LGA/Ward cards' sub-indicator is the same total changed-record
// count each time — that's not a bug, it's the same underlying change log
// rolled up to progressively finer admin groupings, and the ratio of that
// total to each card's own count is itself informative (few states but many
// changed records = changes concentrated in a few states). The Settlements
// card is the finest level (one settlement = one row), so its sub-indicator
// is the finer field-level change count instead, since more than one field
// of the same settlement record can have changed.
export default function MlosChangeCards({ diff }: MlosChangeCardsProps) {
  const recordsHint = `${diff.changedRowCount.toLocaleString()} changed record${diff.changedRowCount === 1 ? '' : 's'} within them`

  return (
    <section style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="States" value={diff.changedStates.toLocaleString()} accentColor="#2c5f9e" hint={recordsHint} />
        <StatCard label="LGAs" value={diff.changedLgas.toLocaleString()} accentColor="#2c5f9e" hint={recordsHint} />
        <StatCard label="Wards" value={diff.changedWards.toLocaleString()} accentColor="#2c5f9e" hint={recordsHint} />
        <StatCard
          label="Settlements"
          value={diff.changedSettlements.toLocaleString()}
          accentColor="#2c5f9e"
          hint={`${diff.fieldChangeCount.toLocaleString()} field-level change${diff.fieldChangeCount === 1 ? '' : 's'} across them`}
        />
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
        Matched {diff.matchedRows.toLocaleString()} of {diff.totalInputRows.toLocaleString()} input records to the output
        {diff.matchStrategy === 'id-column' && diff.matchColumn ? ` by "${diff.matchColumn}"` : ' by state+LGA+ward+settlement'}
        {diff.addedRows > 0 && ` · ${diff.addedRows.toLocaleString()} record(s) in the output with no matching input row`}
        {diff.removedRows > 0 && ` · ${diff.removedRows.toLocaleString()} input record(s) missing from the output`}
      </div>
    </section>
  )
}
