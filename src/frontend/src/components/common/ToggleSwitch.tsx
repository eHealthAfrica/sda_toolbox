interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  id?: string
}

// Small reusable pill-style toggle switch, styled off the same
// var(--color-primary)/var(--color-border) tokens as everything else in the
// app. A real checkbox drives it under the hood (kept visually hidden but
// still in the tab order / accessible via role="switch") rather than a
// click-only <div>, so it behaves like any other form control.
export default function ToggleSwitch({ checked, onChange, label, id }: ToggleSwitchProps) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--color-text-muted)',
      }}
    >
      <span
        role="switch"
        aria-checked={checked}
        style={{
          position: 'relative',
          width: 34,
          height: 19,
          flexShrink: 0,
          borderRadius: 999,
          background: checked ? 'var(--color-primary)' : 'var(--color-border)',
          transition: 'background .15s',
        }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'pointer' }}
        />
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 17 : 2,
            width: 15,
            height: 15,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            transition: 'left .15s',
            pointerEvents: 'none',
          }}
        />
      </span>
      {label}
    </label>
  )
}
