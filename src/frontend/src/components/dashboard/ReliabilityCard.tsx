import { useEffect, useState } from 'react'
import { ApiError, fetchJobsStats } from '../../api/client'
import type { JobsStats } from '../../types/reliability'
import { TONE_COLORS, formatPct, formatSeconds, rateTone } from '../../utils/reliability'

interface ReliabilityCardProps {
  onOpen: () => void
}

type CardState = 'loading' | 'ok' | 'unavailable' | 'error'

// The Dashboard keeps every page mounted, so this polls slowly: reliability
// numbers are 30-day aggregates and do not need a 15-second refresh.
const POLL_MS = 60000

const linkButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-primary)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
} as const

// A short reliability summary for the home page: 30-day success rate against
// the target, open incidents, MTTR and the tool most in need of attention,
// with a link to the full Reliability page. On a backend without
// GET /jobs/stats it says so instead of showing zeros.
export default function ReliabilityCard({ onOpen }: ReliabilityCardProps) {
  const [stats, setStats] = useState<JobsStats | null>(null)
  const [state, setState] = useState<CardState>('loading')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const result = await fetchJobsStats('30d')
        if (cancelled) return
        setStats(result)
        setState('ok')
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 404) {
          setStats(null)
          setState('unavailable')
        } else {
          setState('error')
        }
      }
    }

    void load()
    const interval = setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const target = stats?.target.success_rate ?? 0.95
  const overall = stats?.overall
  const tone = rateTone(overall?.success_rate ?? null, target)
  const color = TONE_COLORS[tone]
  const worst = stats?.by_tool.find((t) => t.failed_counted > 0) ?? null

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div className="card-title">Reliability</div>
          <div className="card-sub">
            Last 30 days, across every tool
            {state === 'error' && stats ? ' — couldn’t refresh just now, showing the last numbers received' : ''}
          </div>
        </div>
        <button type="button" onClick={onOpen} style={linkButtonStyle}>
          Open Reliability →
        </button>
      </div>

      {state === 'loading' && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>}

      {state === 'unavailable' && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Reliability tracking isn’t switched on for this backend yet. The Reliability page lists what it needs.
        </div>
      )}

      {state === 'error' && !stats && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Couldn’t load reliability data just now.</div>
      )}

      {stats && overall && (
        <>
          <div className="grid grid-g3">
            <div className="stat-tile" style={{ borderLeft: `3px solid ${color}` }}>
              <div className="stat-label">Success rate</div>
              <div className="stat-value tabular" style={{ color }}>
                {formatPct(overall.success_rate)}
              </div>
              <div className="stat-foot">target {formatPct(target, 0)}</div>
            </div>
            <div className="stat-tile" style={{ borderLeft: `3px solid ${overall.open_incidents > 0 ? 'var(--color-critical)' : 'var(--color-good)'}` }}>
              <div className="stat-label">Open incidents</div>
              <div className="stat-value tabular">{overall.open_incidents}</div>
              <div className="stat-foot">{overall.open_incidents > 0 ? 'unresolved right now' : 'nothing unresolved'}</div>
            </div>
            <div className="stat-tile" style={{ borderLeft: '3px solid var(--color-primary)' }}>
              <div className="stat-label">Mean time to resolve</div>
              <div className="stat-value tabular">{formatSeconds(overall.mttr_seconds)}</div>
              <div className="stat-foot">{overall.resolved_incidents} resolved in the window</div>
            </div>
          </div>
          {worst && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 12 }}>
              Needs attention: <strong style={{ color: 'var(--color-text)' }}>{worst.label}</strong> — {formatPct(worst.success_rate)} success,{' '}
              {worst.failed_counted} counted failure{worst.failed_counted === 1 ? '' : 's'}
            </div>
          )}
        </>
      )}
    </div>
  )
}
