import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { AppView } from '../layout/AppShell'
import { fetchJobsSummary, fetchRecentJobs } from '../../api/client'
import type { JobRow, JobsSummary } from '../../types/jobs'

// Every AppView the Dashboard can actually navigate to. Used to guard
// clicking a job row: toolbox/job_tracker/middleware.py logs a few tool keys
// with no frontend page yet ('hitnrun', 'contact-analysis',
// 'submission-reviewer', 'checkout', 'post-implementation-report',
// 'timespent', 'microplan-dip') — a row for one of those stays inert rather
// than calling onNavigate with a view AppShell doesn't know.
const KNOWN_VIEWS = new Set<string>([
  'h2h',
  'mlos-qc',
  'mlos-ops',
  'uuid-checker',
  'reach',
  'target-area',
  'microplan-combine',
  'microplan-validate',
  'microplan-merger',
  'microplan-generator',
  'compiler-tracks',
  'compiler-disaggregate',
  'compiler-lga-data',
  'daily-report',
])

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface DashboardPageProps {
  onNavigate: (view: AppView) => void
}

const jobThStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--color-text-muted)',
  fontWeight: 600,
  padding: '6px 8px',
  borderBottom: '1px solid var(--color-border)',
}
const jobTdStyle: CSSProperties = {
  padding: '7px 8px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 12,
}

const VIEW_LABELS: Partial<Record<AppView, string>> = {
  h2h: 'H2H Settlement Tracking',
  'mlos-qc': 'MLoS · QC & Validation',
  'mlos-ops': 'MLoS · Standardize / Fixer / Update',
  'uuid-checker': 'UUID Checker',
  reach: 'REACH Analysis',
  'target-area': 'Target Area Generator',
  'microplan-combine': 'Microplan · Combine DMP Files',
  'microplan-validate': 'Microplan · Validate DIP',
  'microplan-merger': 'Microplan · DIP + Map Merger',
  'microplan-generator': 'Microplan · DIP Generator',
  'compiler-tracks': 'Compiler · Tracks',
  'compiler-disaggregate': 'Compiler · Disaggregate MLoS',
  'compiler-lga-data': 'Compiler · Combine LGA Data',
  'daily-report': 'Reporting · Daily Report',
}

interface QuickTool {
  view: AppView
  title: string
  sub: string
  icon: ReactNode
}

// The four quick-access destinations from the approved dashboard design
// (sda_toolbox_frontend_design/mockup.html's "Quick access to tools" grid).
// Real navigation, real routes — no mock data involved.
const QUICK_TOOLS: QuickTool[] = [
  {
    view: 'mlos-qc',
    title: 'MLoS · QC & Validation',
    sub: 'Spatial and attribute QC on a settlement list',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1c-2.8 0-5 2.1-5 4.9C3 9.5 8 15 8 15s5-5.5 5-9.1C13 3.1 10.8 1 8 1z"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <circle cx="8" cy="5.7" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    view: 'h2h',
    title: 'Gridded Settlement Analysis',
    sub: 'Coverage & visitation from GPS tracks vs. the gridded extent',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="1.8" fill="currentColor" />
        <circle cx="3" cy="4" r="1.3" fill="currentColor" opacity=".55" />
        <circle cx="13" cy="3.5" r="1.3" fill="currentColor" opacity=".55" />
        <circle cx="13" cy="12.5" r="1.3" fill="currentColor" opacity=".55" />
        <circle cx="3.5" cy="12" r="1.3" fill="currentColor" opacity=".55" />
      </svg>
    ),
  },
  {
    view: 'reach',
    title: 'REACH Analysis',
    sub: 'Triangulate settlement visitation across data sources',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1.5l1.8 3.7 4.1.6-3 2.9.7 4.1L8 10.9l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 1.5z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    view: 'uuid-checker',
    title: 'UUID Checker',
    sub: 'Check settlement GUIDs against the database',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <ellipse cx="8" cy="3.2" rx="6" ry="2.1" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M2 3.2v9.6c0 1.16 2.7 2.1 6 2.1s6-.94 6-2.1V3.2M2 8c0 1.16 2.7 2.1 6 2.1s6-.94 6-2.1"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
    ),
  },
]

/**
 * Home dashboard — the real-app counterpart to the approved dashboard design
 * in sda_toolbox_frontend_design/mockup.html.
 *
 * Two of that mockup's sections carry over here: pure navigation (Quick
 * access), and Job activity, which is backed by a real backend job log (see
 * GET /jobs/summary + GET /jobs — toolbox/job_tracker/) — every real tool
 * endpoint is logged automatically by JobLoggingMiddleware, so Active/
 * Completed/Failed here are durable, server-side counts across every user
 * of this instance, not a per-tab tally that resets on refresh like the
 * state/jobTracker.tsx counter this replaced.
 *
 * The mockup's "Tool status" card (a 12/2 live-vs-blocked split) isn't
 * shown here — it was hand-maintained static text, not a number computed
 * from anything live, so it stayed out. The rest of the mockup's dashboard —
 * the settlement/QC/coverage stat tiles, the coverage map and visitation
 * charts, the Recent jobs table — was explicit sample data even in the
 * mockup itself ("sample data for design purposes"), standing in for
 * analytics aggregates that don't exist in the real backend at all (unlike
 * job activity, which has a real endpoint of its own — see above). Rather
 * than ship invented numbers that would look live to an actual analyst,
 * those sections stay out here until there's a real endpoint behind them —
 * same posture as every other page in this app.
 */
export default function DashboardPage({ onNavigate }: DashboardPageProps) {
  const [summary, setSummary] = useState<JobsSummary | null>(null)
  const [recentJobs, setRecentJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  // Poll GET /jobs/summary + GET /jobs on an interval while the Dashboard is
  // mounted, so counts started by another tab/user of this instance show up
  // here too — not just what this render happened to catch on mount. 15s is
  // frequent enough to feel live without hammering the backend for a card
  // that's read far more often than it's written.
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [summaryResult, recentResult] = await Promise.all([fetchJobsSummary(), fetchRecentJobs(8)])
        if (cancelled) return
        setSummary(summaryResult)
        setRecentJobs(recentResult)
        setFetchError(false)
      } catch {
        if (cancelled) return
        setFetchError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const activeCount = summary?.active ?? 0
  const completedCount = summary?.completed ?? 0
  const failedCount = summary?.failed ?? 0

  return (
    <div>
      <div className="grid grid-g4" style={{ marginBottom: 16 }}>
        {QUICK_TOOLS.map((tool) => (
          <div key={tool.view} className="quick-tool" onClick={() => onNavigate(tool.view)}>
            <div className="qt-icon">{tool.icon}</div>
            <div>
              <div className="qt-title">{tool.title}</div>
              <div className="qt-sub">{tool.sub}</div>
            </div>
            <span className="qt-arrow">→</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Job activity</div>
        <div className="card-sub">
          Across every user of this instance
          {fetchError ? (summary ? ' — couldn’t refresh just now, showing the last counts received' : ' — couldn’t reach the job log') : ''}
        </div>
        <div className="grid grid-g3">
          <div className="stat-tile" style={{ borderLeft: '3px solid var(--color-primary)' }}>
            <div className="stat-label">Active</div>
            <div className="stat-value tabular">{activeCount}</div>
            <div className="stat-foot">still waiting on a response</div>
          </div>
          <div className="stat-tile" style={{ borderLeft: '3px solid var(--color-good)' }}>
            <div className="stat-label">Completed</div>
            <div className="stat-value tabular">{completedCount}</div>
            <div className="stat-foot">came back with a result</div>
          </div>
          <div className="stat-tile" style={{ borderLeft: '3px solid var(--color-critical)' }}>
            <div className="stat-label">Failed</div>
            <div className="stat-value tabular">{failedCount}</div>
            <div className="stat-foot">the request errored or the route crashed</div>
          </div>
        </div>
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '14px 0 2px' }}>
            Loading recent activity…
          </div>
        ) : recentJobs.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={jobThStyle}>Tool</th>
                <th style={jobThStyle}>Status</th>
                <th style={jobThStyle}>Started</th>
                <th style={jobThStyle}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.map((job) => {
                const view = KNOWN_VIEWS.has(job.tool) ? (job.tool as AppView) : null
                return (
                  <tr
                    key={job.id}
                    onClick={view ? () => onNavigate(view) : undefined}
                    style={{ cursor: view ? 'pointer' : 'default' }}
                  >
                    <td style={jobTdStyle}>{VIEW_LABELS[job.tool as AppView] ?? job.label}</td>
                    <td style={jobTdStyle}>
                      <span className={`job-status-pill job-status-pill--${job.status}`}>{job.status}</span>
                    </td>
                    <td style={jobTdStyle}>{new Date(job.started_at).toLocaleTimeString()}</td>
                    <td style={jobTdStyle}>{formatDuration(job.duration_ms)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '14px 0 2px' }}>
            {fetchError
              ? "Job activity is temporarily unavailable — couldn't reach the job log."
              : "No submissions yet — run any tool and it'll show up here."}
          </div>
        )}
      </div>
    </div>
  )
}
