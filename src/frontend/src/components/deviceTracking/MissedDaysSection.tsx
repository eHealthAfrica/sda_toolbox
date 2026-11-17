import { MISSED_BUCKETS } from '../../types/deviceTracking'
import { fmt } from '../../utils/deviceTrackingAggregate'
import type { DashboardModel } from '../../utils/deviceTrackingEngine'
import { AreaName, ChartCard, ClearFilterButton, LegendChip, Pair, StackedTrack, WindowSlider, fadeStyle, monoStyle, useRowWindow } from './deviceTrackingShared'
import type { AreaProps, CrossFilterProps } from './deviceTrackingShared'

interface MissedDaysSectionProps extends AreaProps, CrossFilterProps {
  missed: DashboardModel['missed']
  scopeName: string
  onCsvArea: () => void
  onCsvDistribution: () => void
}

// A "missed day" is a day in range on which a team sent no tracks from any of
// its devices. Left: each area's teams split by how many days they missed.
// Right: the same split for the whole area in view. Picking a bucket (legend
// chip, bar segment or column) filters the whole page to it; picking it again
// clears it.
export default function MissedDaysSection({ missed, scopeName, levelNoun, leaf, onDrill, resetKey, sel, onToggle, onCsvArea, onCsvDistribution }: MissedDaysSectionProps) {
  const win = useRowWindow(missed.rows.length, resetKey)
  const shown = missed.rows.slice(win.at, win.at + 5)
  const filtered = sel.missed !== undefined
  const maxBucket = Math.max(1, ...missed.totals)
  const pick = (i: number) => () => onToggle('missed', i)

  return (
    <Pair>
      <ChartCard
        title={`Teams by missed work days, by ${levelNoun}`}
        blurb={`Each ${levelNoun}'s teams by how many of the selected days they sent no tracks. Name: drill down. Bar or legend: filter the page.`}
        csvLabel="Download teams by missed work days as CSV"
        onCsv={onCsvArea}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {MISSED_BUCKETS.map((b, i) => (
            <LegendChip key={b.name} name={b.name} color={b.color} pressed={sel.missed === i} dim={filtered && sel.missed !== i} onClick={pick(i)} />
          ))}
          {filtered && <ClearFilterButton onClick={pick(sel.missed as number)} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map((r) => (
            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 170px) minmax(0, 1fr) 76px', gap: 12, alignItems: 'center', padding: '2px 4px' }}>
              <AreaName name={r.name} leaf={leaf} onDrill={onDrill} fontSize={13.5} />
              <StackedTrack
                parts={MISSED_BUCKETS.map((b, i) => ({
                  title: `${r.name} · ${b.name}: ${r.buckets[i]} ${r.buckets[i] === 1 ? 'team' : 'teams'}`,
                  color: b.color,
                  share: r.teams ? (r.buckets[i] / r.teams) * 100 : 0,
                  onClick: pick(i),
                  fade: fadeStyle(sel.missed, i),
                }))}
              />
              <span style={{ fontSize: 12, textAlign: 'right', ...monoStyle }}>
                {r.teams - r.buckets[0]} of {r.teams}
              </span>
            </div>
          ))}
          {missed.rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 4px' }}>Nothing matches the current filters.</div>}
        </div>
        <WindowSlider win={win} total={missed.rows.length} />
      </ChartCard>

      <ChartCard
        title="Teams by number of missed days"
        blurb={`All teams in ${scopeName} over the selected days. Select a bar to filter.`}
        csvLabel="Download missed days distribution as CSV"
        onCsv={onCsvDistribution}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${MISSED_BUCKETS.length}, minmax(0, 1fr))`,
            gap: 16,
            alignItems: 'end',
            height: 190,
            borderBottom: '1px solid #9AA5B1',
            padding: '0 8px',
          }}
        >
          {MISSED_BUCKETS.map((b, i) => (
            <button
              key={b.name}
              type="button"
              onClick={pick(i)}
              aria-pressed={sel.missed === i}
              title={`${b.name}: ${missed.totals[i]} teams (${Math.round((missed.totals[i] / Math.max(1, missed.totalTeams)) * 100)}%)`}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
            >
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', ...monoStyle }}>{fmt(missed.totals[i])}</span>
              <span
                style={{
                  display: 'block',
                  width: '70%',
                  maxWidth: 56,
                  borderRadius: '3px 3px 0 0',
                  background: b.color,
                  height: Math.max(2, Math.round((missed.totals[i] / maxBucket) * 150)),
                  ...fadeStyle(sel.missed, i),
                }}
              />
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${MISSED_BUCKETS.length}, minmax(0, 1fr))`, gap: 16, padding: '0 8px', fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          {MISSED_BUCKETS.map((b) => (
            <span key={b.name}>{b.name}</span>
          ))}
        </div>
      </ChartCard>
    </Pair>
  )
}
