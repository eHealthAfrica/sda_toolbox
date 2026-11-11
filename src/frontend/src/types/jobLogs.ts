// Shapes for GET /jobs/{job_id}/logs, served by the backend's job tracker
// (toolbox/job_tracker/router.py). The log panel and the progress bar stay
// hidden unless VITE_JOB_LOGS=true is set at build time, and hide themselves
// if the route answers 404.

export type JobLogStatus = 'unknown' | 'active' | 'completed' | 'failed'

export interface JobLogLine {
  // Increasing per job; the client asks for lines after the last one it has.
  seq: number
  // ISO timestamp of the log record.
  ts: string
  // DEBUG, INFO, WARNING, ERROR or CRITICAL; kept as a string so a new level
  // never breaks the panel.
  level: string
  message: string
}

export interface JobLogsResponse {
  job_id: string
  // 'unknown' means the backend has not seen this job id yet: the client
  // generates the id and starts asking before the request has necessarily
  // reached the middleware, so this is a normal first answer, not an error.
  status: JobLogStatus
  // The step the tool last reported it was on (the progress bar follows it);
  // null before the first report, and absent on an older backend.
  stage?: string | null
  lines: JobLogLine[]
  // Pass this as `after` on the next request.
  next: number
  // True when older lines were dropped because the per-job buffer is full.
  truncated?: boolean
}
