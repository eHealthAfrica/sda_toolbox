import type { CSSProperties } from 'react'
import type { DipBatch } from '../../types/dipGenerator'

interface GenerationProgressCardProps {
  batches: DipBatch[]
  running: boolean
  onCancel: () => void
  onDownloadPartial: () => void
  canDownloadPartial: boolean
}

const chipStyle = (status: DipBatch['status']): CSSProperties => {
  const base: CSSProperties = {
    fontSize: 10,
    padding: '3px 8px',
    borderRadius: 20,
    fontWeight: 600,
    border: '1px solid transparent',
  }
  if (status === 'done') return { ...base, background: '#e6f6e6', color: 'var(--color-good)' }
  if (status === 'active') return { ...base, background: 'var(--color-primary)', color: '#fff' }
  if (status === 'error') return { ...base, background: '#fbe6e6', color: 'var(--color-critical)' }
  return { ...base, background: '#eef1f4', color: 'var(--color-text-muted)' }
}

// Real progress, not a spinner over one giant request — each chip is one
// actual POST /dip/generator call (see utils/dipGeneratorParse.ts::
// splitDipFileByLga). This is a client-side workaround for a backend route
// that has no batching or progress-reporting of its own; see the top-of-file
// comment in types/dipGenerator.ts.
export default function GenerationProgressCard({
  batches,
  running,
  onCancel,
  onDownloadPartial,
  canDownloadPartial,
}: GenerationProgressCardProps) {
  if (batches.length === 0) return null

  const done = batches.filter((b) => b.status === 'done').length
  const active = batches.filter((b) => b.status === 'active').length
  const errored = batches.filter((b) => b.status === 'error').length
  const pending = batches.length - done - active - errored
  const teamsSoFar = batches.reduce((sum, b) => sum + b.teamsGenerated, 0)
  const pct = batches.length > 0 ? Math.round(((done + errored) / batches.length) * 100) : 0
  const activeIndex = batches.findIndex((b) => b.status === 'active')
  const activeBatch = activeIndex >= 0 ? batches[activeIndex] : null
  const displayBatchNumber = activeIndex >= 0 ? activeIndex + 1 : Math.min(done + errored + 1, batches.length)

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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Generation progress</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Each batch is its own <code>POST /dip/generator</code> call for that batch's LGAs only.
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, fontSize: 12.5 }}>
        <div>
          Batch {displayBatchNumber} of {batches.length}
          {activeBatch ? (
            <>
              {' '}
              · currently generating <b>{activeBatch.lgas.join(', ') || 'ungrouped rows'}</b>
            </>
          ) : null}
        </div>
        <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{pct}%</div>
      </div>
      <div style={{ height: 14, background: '#eef0f2', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #2c5f9e, #4a83c9)',
            borderRadius: 8,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
        {teamsSoFar.toLocaleString()} team DIPs generated so far · {done} batch{done === 1 ? '' : 'es'} complete,{' '}
        {active} in flight, {pending} queued{errored > 0 ? `, ${errored} failed` : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
        {batches.map((b) => (
          <span key={b.id} style={chipStyle(b.status)}>
            {b.lgas.join(', ') || 'ungrouped'}
            {b.status === 'done' && ' ✓'}
            {b.status === 'active' && ' — generating…'}
            {b.status === 'error' && ' ✕'}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {running && (
          <button
            onClick={onCancel}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 12px',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ■ Cancel remaining batches
          </button>
        )}
        {canDownloadPartial && (
          <button
            onClick={onDownloadPartial}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 12px',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⬇ Download completed batches so far ({done} LGA-group{done === 1 ? '' : 's'})
          </button>
        )}
      </div>
    </div>
  )
}
