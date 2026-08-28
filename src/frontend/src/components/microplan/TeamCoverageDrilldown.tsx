import { useState } from 'react'
import type { LgaTeamCount } from '../../types/microplan'

interface TeamCoverageDrilldownProps {
  teamsByLga: LgaTeamCount[]
}

// Click an LGA to see its ward-level team counts — full width, single
// column, so ward names and bars stay readable (this used to be squeezed
// into a card next to the Target Population card; moved to its own
// full-width section directly above the records table). Mirrors the intent
// of the sample workbook's "Teams Check" sheet (an LGA picker + ward
// breakdown), rebuilt as a click-through instead of a dropdown-driven Excel
// sheet — this is a straight count from the Team column, not the
// expected-vs-allocated reconciliation that sheet did against a "Ramadan
// round" reference.
export default function TeamCoverageDrilldown({ teamsByLga }: TeamCoverageDrilldownProps) {
  const [selectedLga, setSelectedLga] = useState<string | null>(teamsByLga[0]?.lga ?? null)
  const selected = teamsByLga.find((l) => l.lga === selectedLga) ?? teamsByLga[0]
  const maxTeams = Math.max(1, ...(selected?.wards.map((w) => w.teams) ?? [1]))

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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Team coverage by LGA → ward</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Click an LGA to see its ward-level team counts.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '10px 0 14px' }}>
        {teamsByLga.map((l) => (
          <button
            key={l.lga}
            type="button"
            onClick={() => setSelectedLga(l.lga)}
            style={{
              fontSize: 10.5,
              padding: '3px 9px',
              borderRadius: 20,
              border: 'none',
              cursor: 'pointer',
              background: l.lga === selected?.lga ? 'var(--color-primary)' : '#eef1f4',
              color: l.lga === selected?.lga ? '#fff' : 'var(--color-text-muted)',
              fontWeight: l.lga === selected?.lga ? 600 : 400,
            }}
          >
            {l.lga} {l.teams.toLocaleString()}
          </button>
        ))}
      </div>
      {selected && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 10 }}>
            {selected.lga.toUpperCase()} — TEAMS BY WARD ({selected.wards.length} wards, {selected.teams.toLocaleString()} teams)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', rowGap: 8 }}>
            {selected.wards.map((w) => (
              <div key={w.ward} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                <div style={{ width: 150, flexShrink: 0, color: 'var(--color-text)' }}>{w.ward}</div>
                <div style={{ flex: 1, height: 9, background: '#eef0f2', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 5, background: 'var(--color-primary)', width: `${(w.teams / maxTeams) * 100}%` }} />
                </div>
                <div style={{ width: 28, textAlign: 'right', color: 'var(--color-text-muted)', flexShrink: 0, fontWeight: 600 }}>{w.teams}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
