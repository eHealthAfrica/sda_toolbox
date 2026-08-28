// Mirrors toolbox/job_tracker/store.py's `jobs` table / get_summary() /
// get_recent() — the backend-persisted replacement for the old
// state/jobTracker.tsx session-only tracker. Every real tool endpoint is
// logged automatically by JobLoggingMiddleware (toolbox/job_tracker/
// middleware.py), so these counts survive a page reload and are shared
// across every user hitting this backend instance, unlike the old
// React-only tracker they replace.
export type JobStatus = 'active' | 'completed' | 'failed'

export interface JobsSummary {
  active: number
  completed: number
  failed: number
  total: number
}

// One row from GET /jobs. `tool` is the same short key
// state/jobTracker.tsx's AppView union uses (see middleware.py's
// TOOL_ENDPOINTS table) — but not every tool key currently has a frontend
// page (e.g. 'hitnrun', 'contact-analysis'), so treat it as a plain string,
// not AppView, and guard before navigating on it. `label` is a static
// human-readable tool name (e.g. "Tracking — Gridded H2H"), not a per-run
// identifier — the backend doesn't record the uploaded filename the old
// client-side tracker used to show under "Run".
export interface JobRow {
  id: string
  tool: string
  label: string
  method: string
  path: string
  status: JobStatus
  status_code: number | null
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  error: string | null
}
