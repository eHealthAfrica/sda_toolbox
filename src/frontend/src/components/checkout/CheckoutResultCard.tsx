import type { CheckoutSummary } from '../../types/checkout'
import { formatBytes } from '../../utils/checkout'
import CheckoutIndicators from './CheckoutIndicators'

interface CheckoutResultCardProps {
  fileName: string
  sizeBytes: number
  downloadUrl: string
  summary: CheckoutSummary | null
  warning: string | null
}

export default function CheckoutResultCard({ fileName, sizeBytes, downloadUrl, summary, warning }: CheckoutResultCardProps) {
  const nothingChanged = summary !== null && summary.updated + summary.added + summary.removed === 0

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Updated checkout is ready</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
            📄 {fileName} — {formatBytes(sizeBytes)}
          </div>
        </div>
        <a
          href={downloadUrl}
          download={fileName}
          style={{
            background: 'var(--color-primary)',
            color: '#fff',
            borderRadius: 'var(--radius-md)',
            padding: '9px 20px',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Download updated checkout
        </a>
      </div>

      {summary && <CheckoutIndicators summary={summary} />}

      {nothingChanged && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
          The MLoS matches the checkout — nothing was updated, added or removed.
        </div>
      )}

      {warning && (
        <div
          role="status"
          style={{
            borderLeft: '4px solid var(--color-warning)',
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-md)',
            padding: '9px 12px',
            fontSize: 12.5,
          }}
        >
          {warning}
        </div>
      )}
    </div>
  )
}
