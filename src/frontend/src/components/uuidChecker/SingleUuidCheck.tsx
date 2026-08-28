import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, checkUuid } from '../../api/client'
import type { UuidCheckResult } from '../../types/uuidChecker'
import { isUuidShaped } from '../../utils/uuidFile'
import { UUID_EXISTS_COLORS } from '../../utils/colors'
import { useJobTracker } from '../../state/jobTracker'
import UuidResultTable from './UuidResultTable'

const inputStyle = {
  padding: '9px 11px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  flex: '1 1 360px',
}

const EXAMPLE_UUID = '123e4567-e89b-12d3-a456-426614174000'
const HISTORY_LIMIT = 200

// GET /uuid_check — a single settlement's eha_guid, checked one at a time
// against the settlements table. Keeps a running (session-only) history so
// repeated lookups during a review session don't disappear the moment the
// next one runs.
export default function SingleUuidCheck() {
  const [uuidInput, setUuidInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latest, setLatest] = useState<UuidCheckResult | null>(null)
  const [history, setHistory] = useState<UuidCheckResult[]>([])
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = uuidInput.trim()
    if (!trimmed) {
      setError('Enter a UUID to check.')
      return
    }
    if (!isUuidShaped(trimmed)) {
      setError(`Not a valid UUID format — expected 8-4-4-4-12 hex, e.g. ${EXAMPLE_UUID}`)
      return
    }
    setError(null)
    setChecking(true)
    const jobId = startJob('uuid-checker', `Single check · ${trimmed.slice(0, 8)}…`)
    try {
      const result = await checkUuid(trimmed.toLowerCase())
      setLatest(result)
      setHistory((prev) => [result, ...prev.filter((r) => r.uuid !== result.uuid)].slice(0, HISTORY_LIMIT))
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while checking this UUID.')
      }
      setLatest(null)
      failJob(jobId)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div>
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-sm)',
          padding: 20,
          marginBottom: 24,
        }}
      >
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }} htmlFor="single_uuid">
          Settlement UUID (eha_guid)
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            id="single_uuid"
            type="text"
            placeholder={EXAMPLE_UUID}
            style={inputStyle}
            value={uuidInput}
            onChange={(e) => setUuidInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={checking}
            style={{
              background: checking ? 'var(--color-text-muted)' : 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '9px 22px',
              fontSize: 13,
              fontWeight: 600,
              cursor: checking ? 'default' : 'pointer',
            }}
          >
            {checking ? 'Checking…' : 'Check UUID'}
          </button>
        </div>
        {error && <div style={{ color: 'var(--color-critical)', fontSize: 12, marginTop: 10 }}>{error}</div>}
      </form>

      {latest && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: `1px solid ${UUID_EXISTS_COLORS[latest.exists]}`,
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            padding: '18px 20px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: UUID_EXISTS_COLORS[latest.exists],
              color: '#fff',
              fontSize: 18,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {latest.exists === 'EXISTS' ? '✓' : '✕'}
          </span>
          <div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 14, fontWeight: 600 }}>
              {latest.uuid}
            </div>
            <div style={{ fontSize: 13, color: UUID_EXISTS_COLORS[latest.exists], fontWeight: 600, marginTop: 2 }}>
              {latest.exists === 'EXISTS' ? 'Found in settlements table' : 'Not found in settlements table'}
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && <UuidResultTable results={history} title="Check history (this session)" />}

      {!latest && history.length === 0 && !checking && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Enter a settlement UUID above to check whether it exists in the settlements table.
        </div>
      )}
    </div>
  )
}
