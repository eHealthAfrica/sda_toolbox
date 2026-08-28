import type { MlosOperationMode } from '../../types/mlosOps'

interface OperationModeSwitcherProps {
  mode: MlosOperationMode
  onChange: (mode: MlosOperationMode) => void
}

const MODES: { key: MlosOperationMode; label: string; hint: string }[] = [
  { key: 'standardize', label: 'Standardize', hint: 'POST /qc/standardize' },
  { key: 'fixer', label: 'Fixer', hint: 'PATCH /qc/fixer' },
  { key: 'update', label: 'Update MLoS', hint: 'PATCH /mlos/validation' },
]

// All three endpoints take a settlement list and hand back a modified
// version of it, so they share one page and one before/after diff view
// below — this switcher just swaps which form (and which API call) is
// active, the same way the mockup's nav groups them as "Standardize / Fixer
// / Update".
export default function OperationModeSwitcher({ mode, onChange }: OperationModeSwitcherProps) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      {MODES.map((m) => {
        const active = m.key === mode
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: active ? 'var(--color-primary)' : 'var(--color-surface)',
              color: active ? '#fff' : 'var(--color-text)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
            }}
          >
            {m.label}
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>{m.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
