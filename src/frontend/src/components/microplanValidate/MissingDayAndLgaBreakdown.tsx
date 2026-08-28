import type { CSSProperties } from 'react'
import type { ValidateDipAnalysis } from '../../types/microplanValidate'

interface MissingDayAndLgaBreakdownProps {
  analysis: ValidateDipAnalysis
}

const DAY_COLOR: Record<string, string> = {
  '1': '#7fb2e5',
  '2': '#5a9bd8',
  '3': '#e08a2c',
  '4': '#d03b3b',
}

const labelStyle: CSSProperties = { width: 140, flexShrink: 0, color: 'var(--color-text)' }
const trackStyle: CSSProperties = { flex: 1, height: 9, background: '#eef0f2', borderRadius: 5, overflow: 'hidden' }
const valueStyle: CSSProperties = { width: 78, textAlign: 'right', color: 'var(--color-text-muted)', flexShrink: 0 }

// Two panels: which campaign day most often goes unrecorded (a team missing
// more than one day is counted once per day, so bars don't sum to the
// fieldTeamCount), and which LGAs carry the "Unaccounted Teams" shortfall —
// grouped into a single "1 team each" row past the top 5 to keep the list
// readable, mirroring the mockup's compact grouping for long tails.
export default function MissingDayAndLgaBreakdown({ analysis }: MissingDayAndLgaBreakdownProps) {
  const maxDay = Math.max(1, ...analysis.missingByDay.map((d) => d.count))
  const maxLga = Math.max(1, ...analysis.unaccountedTeamsByLga.map((l) => l.teams))

  const topLgas = analysis.unaccountedTeamsByLga.filter((l) => l.teams > 1)
  const singleTeamLgas = analysis.unaccountedTeamsByLga.filter((l) => l.teams === 1)

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Missing-day distribution</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Computed from the Team review sheet — how often each specific campaign day goes unrecorded across all{' '}
        {analysis.fieldTeamCount.toLocaleString()} teams. A team missing more than one day is counted once per day.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)' }}>MISSING BY DAY</div>
          {analysis.missingByDay.map((d) => (
            <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 11.5 }}>
              <div style={labelStyle}>Day {d.day}</div>
              <div style={trackStyle}>
                <div style={{ height: '100%', borderRadius: 5, width: `${(d.count / maxDay) * 100}%`, background: DAY_COLOR[d.day] }} />
              </div>
              <div style={valueStyle}>{d.count.toLocaleString()} teams</div>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)' }}>UNACCOUNTED TEAMS BY LGA</div>
          {topLgas.map((l) => (
            <div key={l.lga} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 11.5 }}>
              <div style={labelStyle}>{l.lga}</div>
              <div style={trackStyle}>
                <div style={{ height: '100%', borderRadius: 5, width: `${(l.teams / maxLga) * 100}%`, background: '#2c5f9e' }} />
              </div>
              <div style={valueStyle}>{l.teams.toLocaleString()} teams</div>
            </div>
          ))}
          {singleTeamLgas.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 11.5 }}>
              <div style={labelStyle}>{singleTeamLgas.map((l) => l.lga).join(', ')}</div>
              <div style={trackStyle}>
                <div style={{ height: '100%', borderRadius: 5, width: `${(1 / maxLga) * 100}%`, background: '#2c5f9e' }} />
              </div>
              <div style={valueStyle}>1 team each</div>
            </div>
          )}
          {analysis.unaccountedTeamsByLga.length === 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>No wards were short on teams.</div>
          )}
        </div>
      </div>
    </div>
  )
}
