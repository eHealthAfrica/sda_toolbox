import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, checkUuid } from '../../api/client'
import type { UuidCheckResult } from '../../types/uuidChecker'
import { isUuidShaped } from '../../utils/uuidFile'
import { UUID_AVAILABILITY_COLORS } from '../../utils/colors'
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

function availabilityHeadline(result: UuidCheckResult): string {
  if (result.is_available === 'Available') return 'Available — can be assigned to a new settlement'
  return result.reason === 'Reserved' ? 'Not available — reserved' : 'Not available — already in the MLoS'
}

function availabilityDetail(result: UuidCheckResult): string {
  if (result.is_available === 'Available') {
    return 'This UUID is now held for you. Checking it again will show it as reserved.'
  }
  return result.reason === 'Reserved'
    ? 'An earlier check handed this UUID out and it is not in the MLoS yet.'
    : 'A settlement in the MLoS already uses this UUID.'
}

// GET /uuid_check — checks whether a UUID can be assigned to a new settlement:
// a green tick when it can, a red cross (with the reason) when it can't.
// Keeps a running (session-only) history so repeated lookups during a review
// session don't disappear the moment the next one runs.
//
// Note the backend reserves a UUID the first time it is reported Available, so
// checking the same one again reports it as Reserved — the result card says so,
// and the history keeps the latest answer for each UUID.
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
            border: `1px solid ${UUID_AVAILABILITY_COLORS[latest.is_available]}`,
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
            role="img"
            aria-label={latest.is_available === 'Available' ? 'Available' : 'Not available'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: UUID_AVAILABILITY_COLORS[latest.is_available],
              color: '#fff',
              fontSize: 18,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {latest.is_available === 'Available' ? '✓' : '✕'}
          </span>
          <div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 14, fontWeight: 600 }}>
              {latest.uuid}
            </div>
            <div style={{ fontSize: 13, color: UUID_AVAILABILITY_COLORS[latest.is_available], fontWeight: 600, marginTop: 2 }}>
              {availabilityHeadline(latest)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{availabilityDetail(latest)}</div>
          </div>
        </div>
      )}

      {history.length > 0 && <UuidResultTable results={history} title="Check history (this session)" />}

      {!latest && history.length === 0 && !checking && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Enter a UUID above to check whether it can be assigned to a new settlement.
        </div>
      )}
    </div>
  )
}
