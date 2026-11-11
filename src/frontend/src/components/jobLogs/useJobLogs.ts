import { useEffect, useRef, useState } from 'react'
import { ApiError, fetchJobLogs } from '../../api/client'
import type { JobLogLine, JobLogStatus } from '../../types/jobLogs'
import { JOB_LOGS_ENABLED, mergeLogLines } from '../../utils/jobLogs'

const POLL_MS = 1500

export interface JobLogsState {
  lines: JobLogLine[]
  status: JobLogStatus | null
  // The step the tool last reported (what the progress bar follows).
  stage: string | null
  // null until the first answer; false once the backend says it has no such
  // route, at which point polling stops and the panel hides itself.
  available: boolean | null
  truncated: boolean
}

const EMPTY: JobLogsState = { lines: [], status: null, stage: null, available: null, truncated: false }

// Polls GET /jobs/{jobId}/logs every 1.5 s while `running`, appending new
// lines as they arrive, and makes one last request when the run ends so the
// final lines are not missed. A new jobId starts a fresh log. Does nothing
// when the feature flag is off or there is no job id.
export function useJobLogs(jobId: string | null, running: boolean): JobLogsState {
  const [state, setState] = useState<JobLogsState>(EMPTY)
  const cursor = useRef(0)
  const stopped = useRef(false)

  // A new job starts from nothing.
  useEffect(() => {
    cursor.current = 0
    stopped.current = false
    setState(EMPTY)
  }, [jobId])

  useEffect(() => {
    if (!JOB_LOGS_ENABLED || !jobId) return
    let cancelled = false
    let inFlight = false

    async function tick() {
      if (inFlight || stopped.current) return
      inFlight = true
      try {
        const response = await fetchJobLogs(jobId as string, cursor.current)
        if (cancelled) return
        cursor.current = response.next
        setState((prev) => ({
          lines: mergeLogLines(prev.lines, response.lines),
          status: response.status,
          stage: response.stage ?? prev.stage,
          available: true,
          truncated: prev.truncated || response.truncated === true,
        }))
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 404) {
          // The backend has no log route: stop asking and hide the panel.
          stopped.current = true
          setState((prev) => ({ ...prev, available: false }))
        }
        // Any other failure is treated as momentary; the next tick retries.
      } finally {
        inFlight = false
      }
    }

    void tick()
    if (!running) {
      // The run has ended: that one request was the last, and it picks up
      // whatever was logged after the previous poll.
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [jobId, running])

  return state
}
