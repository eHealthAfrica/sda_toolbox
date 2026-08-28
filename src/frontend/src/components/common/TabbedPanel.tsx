import type { ReactNode } from 'react'

export interface TabbedPanelTab {
  key: string
  label: string
  content: ReactNode
}

interface TabbedPanelProps {
  tabs: TabbedPanelTab[]
  activeKey: string
  onChange: (key: string) => void
}

// Shared "one frame, N tabs" card — puts a map and its matching settlement
// list (H2H, REACH) behind a single bordered card with a real tab bar,
// instead of each view owning its own separate card and switching via a
// button row above them. Callers pass each tab's content in "bare" mode
// (see e.g. VisitationMap/SettlementListTable's own `bare` prop) so it
// renders without its own outer card styling — this component owns that
// once for whichever tab is active.
export default function TabbedPanel({ tabs, activeKey, onChange }: TabbedPanelProps) {
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0]

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map((tab) => {
          const isActive = tab.key === active?.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 13,
                padding: '6px 4px 8px',
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {active?.content}
    </div>
  )
}
