// Mirrors the response shapes in "SDA Toolbox Reliability: Backend Spec"
// (API contract section): GET /jobs/stats, GET /incidents,
// PATCH /incidents/{id}, GET /ready. These endpoints are built on the backend
// side (toolbox/job_tracker/); until they exist the Reliability page shows a
// "backend not upgraded" card instead of failing.

export type StatsWindow = '7d' | '30d' | '90d'

// Kept as plain strings in the payloads (a backend that adds a category must
// not break the page); the known set below only drives labels and colours.
export const KNOWN_CATEGORIES = [
  'code_error',
  'resource',
  'dependency',
  'interrupted',
  'data_contract',
  'user_input',
] as const

export interface StatsWindowInfo {
  from: string
  to: string
  days: number
}

export interface OverallStats {
  total: number
  completed: number
  failed_counted: number
  failed_excluded: number
  // Fraction 0..1, or null when there were no completed / counted-failed jobs.
  success_rate: number | null
  p50_ms: number | null
  p95_ms: number | null
  mttr_seconds: number | null
  mttr_median_seconds: number | null
  mttr_p90_seconds: number | null
  resolved_incidents: number
  open_incidents: number
}

export interface ToolStats {
  tool: string
  label: string
  total: number
  completed: number
  failed_counted: number
  failed_excluded: number
  success_rate: number | null
  p95_ms: number | null
  last_failure_at: string | null
  open_incident_id: string | null
}

export interface CategoryStats {
  category: string
  count: number
  counted: boolean
}

export interface DailyStats {
  // 'YYYY-MM-DD', UTC.
  date: string
  completed: number
  failed_counted: number
  failed_excluded: number
  success_rate: number | null
}

export interface TopCause {
  traceback_hash: string | null
  error_type: string | null
  sample: string | null
  tool: string
  category: string
  count: number
  last_seen: string
}

export interface JobsStats {
  window: StatsWindowInfo
  target: { success_rate: number }
  overall: OverallStats
  by_tool: ToolStats[]
  by_category: CategoryStats[]
  daily: DailyStats[]
  top_causes: TopCause[]
}

export type IncidentStatus = 'open' | 'acknowledged' | 'resolved'
export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3'

export interface Incident {
  id: string
  tool: string
  title: string
  severity: IncidentSeverity
  status: IncidentStatus
  error_category: string | null
  traceback_hash: string | null
  opened_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution: string | null
  runbook: string | null
  failure_count: number
  // Set while the incident is not resolved.
  age_seconds: number | null
  // resolved_at - opened_at, once resolved.
  duration_seconds: number | null
}

// Body for PATCH /incidents/{id}; send only what changes.
export interface IncidentPatch {
  status?: 'acknowledged' | 'resolved'
  severity?: IncidentSeverity
  resolution?: string
  runbook?: string
  resolved_by?: string
}

export type ReadyStatus = 'ready' | 'degraded' | 'not_ready'

export interface ReadyCheck {
  name: string
  ok: boolean
  critical: boolean
  ms: number | null
  detail: string | null
}

export interface ReadyReport {
  status: ReadyStatus
  uptime_seconds: number | null
  checks: ReadyCheck[]
}
