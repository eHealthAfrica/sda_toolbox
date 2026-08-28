import { useState } from 'react'
import SingleUuidCheck from './SingleUuidCheck'
import BatchUuidCheck from './BatchUuidCheck'

type CheckMode = 'single' | 'batch'

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 18px',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
        color: active ? '#fff' : 'var(--color-text-muted)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// GET /uuid_check + POST /uuid_batch_checker (toolbox/apps/db_access/uuid_checker.py)
// — both check settlement eha_guids against the settlements table; single
// checks one at a time, batch takes a file/paste of many and adds a CSV
// export of the results.
export default function UuidCheckerPage() {
  const [mode, setMode] = useState<CheckMode>('single')

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <ModeTab active={mode === 'single'} onClick={() => setMode('single')}>
          Single check
        </ModeTab>
        <ModeTab active={mode === 'batch'} onClick={() => setMode('batch')}>
          Batch check
        </ModeTab>
      </div>

      {mode === 'single' ? <SingleUuidCheck /> : <BatchUuidCheck />}
    </div>
  )
}
