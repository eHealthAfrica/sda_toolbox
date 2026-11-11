import { useEffect, useMemo, useState } from 'react'
import { ApiError, fetchFailedJobs, fetchIncidents, fetchJobsStats, fetchReady } from '../../api/client'
import type { JobRow } from '../../types/jobs'
import type { Incident, JobsStats, ReadyReport, StatsWindow } from '../../types/reliability'
import { filterByTool, formatPct } from '../../utils/reliability'
import FailureCategoryBars from './FailureCategoryBars'
import IncidentList from './IncidentList'
import ReadyPanel from './ReadyPanel'
import RecentFailuresTable from './RecentFailuresTable'
import ReliabilityKpis from './ReliabilityKpis'
import SuccessTrendChart from './SuccessTrendChart'
import ToolReliabilityTable from './ToolReliabilityTable'
import TopCausesTable from './TopCausesTable'
import { Card, EmptyNote, Segmented, buttonStyle } from './reliabilityShared'

interface ReliabilityPageProps {
  // App.tsx keeps every page mounted; polling only runs while this one is on
  // screen, so a hidden page does not keep hitting the backend.
  active: boolean
}

type StatsState = 'loading' | 'ok' | 'unavailable' | 'error'

const POLL_MS = 30000

const WINDOW_OPTIONS: { value: StatsWindow; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

// Shown when GET /jobs/stats answers 404: the backend has not had the
// reliability upgrade yet. Lists exactly what the page reads so the backend
// work can be checked off against it.
function SetupCard() {
  return (
    <Card title="The backend needs the reliability upgrade" sub="This page reads endpoints that this backend does not have yet.">
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
        The numbers, charts and incident list appear here as soon as these routes exist, with no frontend change:
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li>
            <code>GET /jobs/stats?window=30d</code>: success rate, MTTR, per-tool table, categories, daily series and top causes
          </li>
          <li>
            <code>GET /incidents</code> and <code>PATCH /incidents/{'{id}'}</code>: the incident log
          </li>
          <li>
            <code>GET /jobs?status=failed</code> with the new error fields, and <code>GET /ready</code>
          </li>
        </ul>
        <div style={{ marginTop: 8 }}>The full request and response shapes are in the “SDA Toolbox Reliability: Backend Spec” document, section “API contract”.</div>
      </div>
    </Card>
  )
}

export default function ReliabilityPage({ active }: ReliabilityPageProps) {
  const [windowKey, setWindowKey] = useState<StatsWindow>('30d')
  const [stats, setStats] = useState<JobsStats | null>(null)
  const [statsState, setStatsState] = useState<StatsState>('loading')
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [failedJobs, setFailedJobs] = useState<JobRow[]>([])
  const [ready, setReady] = useState<ReadyReport | null>(null)
  const [readyUnavailable, setReadyUnavailable] = useState(false)
  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false

    async function load() {
      const [statsResult, incidentsResult, failedResult, readyResult] = await Promise.allSettled([
        fetchJobsStats(windowKey),
        fetchIncidents('all', 100),
        fetchFailedJobs(15),
        fetchReady(),
      ])
      if (cancelled) return

      if (statsResult.status === 'fulfilled') {
        setStats(statsResult.value)
        setStatsState('ok')
      } else if (statsResult.reason instanceof ApiError && statsResult.reason.status === 404) {
        setStats(null)
        setStatsState('unavailable')
      } else {
        // Keep whatever was on screen; only flag the error.
        setStatsState('error')
      }

      if (incidentsResult.status === 'fulfilled') setIncidents(incidentsResult.value)
      if (failedResult.status === 'fulfilled') setFailedJobs(failedResult.value)

      if (readyResult.status === 'fulfilled') {
        setReady(readyResult.value)
        setReadyUnavailable(false)
      } else if (readyResult.reason instanceof ApiError && readyResult.reason.status === 404) {
        setReady(null)
        setReadyUnavailable(true)
      }

      setUpdatedAt(Date.now())
    }

    void load()
    const interval = setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [active, windowKey, reloadTick])

  const toolLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const job of failedJobs) labels[job.tool] = job.label
    for (const t of stats?.by_tool ?? []) labels[t.tool] = t.label
    return labels
  }, [stats, failedJobs])

  const shownIncidents = useMemo(() => filterByTool(incidents, selectedTool), [incidents, selectedTool])
  const shownCauses = useMemo(() => filterByTool(stats?.top_causes ?? [], selectedTool), [stats, selectedTool])
  const shownFailures = useMemo(() => filterByTool(failedJobs, selectedTool), [failedJobs, selectedTool])

  function handleIncidentChanged(updated: Incident) {
    setIncidents((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
    // The KPI tiles and tool table count open incidents; refresh them now
    // rather than waiting for the next poll.
    setReloadTick((n) => n + 1)
  }

  const selectedLabel = selectedTool ? (toolLabels[selectedTool] ?? selectedTool) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        .rl-row { display: grid; gap: 16px; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); }
        .rl-row--even { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        @media (max-width: 1000px) { .rl-row, .rl-row--even { grid-template-columns: minmax(0, 1fr); } }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented<StatsWindow> label="Time window" value={windowKey} options={WINDOW_OPTIONS} onChange={setWindowKey} />
        <button type="button" onClick={() => setReloadTick((n) => n + 1)} style={buttonStyle}>
          Refresh
        </button>
        {selectedLabel && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, background: '#eaf1fb', color: 'var(--color-primary)', padding: '4px 10px', borderRadius: 16, fontWeight: 600 }}>
            Showing {selectedLabel}
            <button
              type="button"
              onClick={() => setSelectedTool(null)}
              aria-label="Clear the tool filter"
              style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
          {statsState === 'error' && 'Could not refresh just now · '}
          {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Loading…'}
        </span>
      </div>

      {statsState === 'unavailable' && <SetupCard />}

      {statsState === 'loading' && !stats && <EmptyNote>Loading reliability data…</EmptyNote>}

      {statsState === 'error' && !stats && (
        <Card title="Could not load reliability data" sub="The backend answered with an error or could not be reached.">
          <button type="button" onClick={() => setReloadTick((n) => n + 1)} style={buttonStyle}>
            Try again
          </button>
        </Card>
      )}

      {stats && (
        <>
          <ReliabilityKpis overall={stats.overall} target={stats.target.success_rate} windowDays={stats.window.days} />

          <div className="rl-row">
            <Card
              title="Success rate by day"
              sub={`Counted jobs only, against the ${formatPct(stats.target.success_rate, 0)} target. Days are UTC.`}
            >
              <SuccessTrendChart daily={stats.daily} target={stats.target.success_rate} />
            </Card>
            <Card title="Why jobs failed" sub="Failures in this window, by cause">
              <FailureCategoryBars categories={stats.by_category} />
            </Card>
          </div>

          <Card title="Reliability by tool" sub="Worst first. Select a tool to filter the incidents, causes and failures below.">
            <ToolReliabilityTable
              tools={stats.by_tool}
              target={stats.target.success_rate}
              selectedTool={selectedTool}
              onSelectTool={setSelectedTool}
            />
          </Card>
        </>
      )}

      {statsState !== 'unavailable' && (
        <Card
          title="Incidents"
          sub={selectedLabel ? `Filtered to ${selectedLabel}` : 'Opened automatically on a counted failure; resolved after two clean runs or by hand'}
        >
          <IncidentList incidents={shownIncidents} toolLabels={toolLabels} onChanged={handleIncidentChanged} />
        </Card>
      )}

      <div className="rl-row">
        {stats && (
          <Card title="Most common crash causes" sub="Failures grouped by traceback, most frequent first">
            <TopCausesTable causes={shownCauses} toolLabels={toolLabels} />
          </Card>
        )}
        <Card title="Backend readiness" sub="Live checks from GET /ready">
          <ReadyPanel report={ready} unavailable={readyUnavailable} />
        </Card>
      </div>

      <Card title="Recent failures" sub={selectedLabel ? `Filtered to ${selectedLabel}` : 'Newest failed jobs across all tools'}>
        <RecentFailuresTable jobs={shownFailures} />
      </Card>
    </div>
  )
}
