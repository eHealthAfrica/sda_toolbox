import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, patchIncident } from '../../api/client'
import type { Incident, IncidentPatch, IncidentSeverity } from '../../types/reliability'
import { formatSeconds, relativeTime } from '../../utils/reliability'
import {
  CategoryPill,
  EmptyNote,
  IncidentStatusPill,
  Segmented,
  SeverityPill,
  buttonStyle,
  monoStyle,
  primaryButtonStyle,
} from './reliabilityShared'

type IncidentFilter = 'active' | 'resolved' | 'all'

interface IncidentListProps {
  incidents: Incident[]
  toolLabels: Record<string, string>
  onChanged: (updated: Incident) => void
}

const VISIBLE_LIMIT = 25

// FastAPI sends { detail: "..." } or { detail: [{ msg, loc }, ...] }; fall
// back to the HTTP status when the body is something else.
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail
    if (detail && typeof detail === 'object' && 'detail' in detail) {
      const inner = (detail as { detail: unknown }).detail
      if (typeof inner === 'string') return inner
      if (Array.isArray(inner)) {
        const msgs = inner.map((item) => (item && typeof item === 'object' && 'msg' in item ? String((item as { msg: unknown }).msg) : '')).filter(Boolean)
        if (msgs.length > 0) return msgs.join('; ')
      }
    }
    return `The backend refused the change (HTTP ${error.status}).`
  }
  return 'Could not reach the backend.'
}

export default function IncidentList({ incidents, toolLabels, onChanged }: IncidentListProps) {
  const [filter, setFilter] = useState<IncidentFilter>('active')
  const [showAll, setShowAll] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolution, setResolution] = useState('')
  const [resolvedBy, setResolvedBy] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const activeCount = incidents.filter((i) => i.status !== 'resolved').length
  const filtered = incidents.filter((i) => (filter === 'all' ? true : filter === 'active' ? i.status !== 'resolved' : i.status === 'resolved'))
  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_LIMIT)

  async function apply(id: string, patch: IncidentPatch) {
    setBusyId(id)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    try {
      const updated = await patchIncident(id, patch)
      onChanged(updated)
      if (patch.status === 'resolved') {
        setResolvingId(null)
        setResolution('')
      }
    } catch (error) {
      setErrors((prev) => ({ ...prev, [id]: describeError(error) }))
    } finally {
      setBusyId(null)
    }
  }

  function submitResolution(event: FormEvent, id: string) {
    event.preventDefault()
    const text = resolution.trim()
    if (!text) {
      setErrors((prev) => ({ ...prev, [id]: 'Write what caused it and how it was fixed before resolving.' }))
      return
    }
    void apply(id, { status: 'resolved', resolution: text, ...(resolvedBy.trim() ? { resolved_by: resolvedBy.trim() } : {}) })
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <Segmented<IncidentFilter>
          label="Incident filter"
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setShowAll(false)
          }}
          options={[
            { value: 'active', label: `Active (${activeCount})` },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyNote>{filter === 'active' ? 'No active incidents.' : filter === 'resolved' ? 'No resolved incidents yet.' : 'No incidents recorded yet.'}</EmptyNote>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {visible.map((inc) => {
            const resolving = resolvingId === inc.id
            const busy = busyId === inc.id
            const needsFourLines = inc.severity === 'sev1' || inc.severity === 'sev2'
            return (
              <li key={inc.id} style={{ padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <SeverityPill severity={inc.severity} />
                  <IncidentStatusPill status={inc.status} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{inc.title}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 6 }}>
                  <span>{toolLabels[inc.tool] ?? inc.tool}</span>
                  <span>opened {relativeTime(inc.opened_at)}</span>
                  <span>
                    {inc.failure_count} failure{inc.failure_count === 1 ? '' : 's'}
                  </span>
                  {inc.error_category && <CategoryPill category={inc.error_category} />}
                  {inc.status !== 'resolved' && inc.age_seconds !== null && <span>open for {formatSeconds(inc.age_seconds)}</span>}
                  {inc.status === 'resolved' && inc.duration_seconds !== null && (
                    <span>
                      resolved after {formatSeconds(inc.duration_seconds)}
                      {inc.resolved_by ? ` by ${inc.resolved_by === 'auto' ? 'auto-resolve' : inc.resolved_by}` : ''}
                    </span>
                  )}
                  {inc.runbook && <span style={monoStyle}>docs/runbooks/{inc.runbook}.md</span>}
                </div>

                {inc.status === 'resolved' && inc.resolution && (
                  <div style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--color-text)', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
                    {inc.resolution}
                  </div>
                )}

                {inc.status !== 'resolved' && !resolving && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                    {inc.status === 'open' && (
                      <button type="button" disabled={busy} onClick={() => void apply(inc.id, { status: 'acknowledged' })} style={buttonStyle}>
                        {busy ? 'Saving…' : 'Acknowledge'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setResolvingId(inc.id)
                        setResolution('')
                      }}
                      style={buttonStyle}
                    >
                      Resolve…
                    </button>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                      Severity
                      <select
                        value={inc.severity}
                        disabled={busy}
                        onChange={(e) => void apply(inc.id, { severity: e.target.value as IncidentSeverity })}
                        style={{ minHeight: 28, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: 12, padding: '0 6px' }}
                      >
                        <option value="sev1">Sev 1</option>
                        <option value="sev2">Sev 2</option>
                        <option value="sev3">Sev 3</option>
                      </select>
                    </label>
                  </div>
                )}

                {resolving && (
                  <form onSubmit={(e) => submitResolution(e, inc.id)} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)' }} htmlFor={`res-${inc.id}`}>
                      Resolution
                    </label>
                    <textarea
                      id={`res-${inc.id}`}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      rows={needsFourLines ? 5 : 2}
                      placeholder={
                        needsFourLines
                          ? 'Timeline (first failure, detection, fix)\nRoot-cause category\nThe fix\nRegression test that now prevents it'
                          : 'One-line cause and fix'
                      }
                      style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 10px', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        value={resolvedBy}
                        onChange={(e) => setResolvedBy(e.target.value)}
                        placeholder="Resolved by (name)"
                        aria-label="Resolved by"
                        style={{ minHeight: 30, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0 10px', fontSize: 12.5 }}
                      />
                      <button type="submit" disabled={busy} style={primaryButtonStyle}>
                        {busy ? 'Saving…' : 'Mark resolved'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setResolvingId(null)
                          setErrors((prev) => {
                            const next = { ...prev }
                            delete next[inc.id]
                            return next
                          })
                        }}
                        style={buttonStyle}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {errors[inc.id] && (
                  <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--color-critical)' }}>
                    {errors[inc.id]}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {filtered.length > VISIBLE_LIMIT && (
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--color-border)' }}>
          <button type="button" onClick={() => setShowAll((v) => !v)} style={buttonStyle}>
            {showAll ? 'Show fewer' : `Show all ${filtered.length}`}
          </button>
        </div>
      )}
    </div>
  )
}
