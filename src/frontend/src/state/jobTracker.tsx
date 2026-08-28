import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppView } from '../components/layout/AppShell'

// Session-scoped job tracker — the real (not fabricated) data source behind
// the Dashboard's Active/Completed/Failed counts. This does NOT talk to any
// backend job queue (none exists — see the design note on DashboardPage),
// it only records the real submissions this browser tab has made since it
// was opened: every page that calls a real POST/PATCH endpoint in
// api/client.ts wraps its handleSubmit with startJob/completeJob/failJob
// from useJobTracker() below, so a count here always corresponds to an
// actual network call this session made, not a guess or a placeholder.
//
// Scope, stated plainly (and surfaced the same way on the Dashboard card):
// this resets to zero on every page refresh and is invisible to any other
// browser tab or user — it is a "what has THIS session done" tally, not a
// durable audit log. That's a real limitation, not a bug to silently work
// around with localStorage or the like (this app has no user/session
// concept on the backend to key such a thing to).
export type JobStatus = 'active' | 'completed' | 'failed'

export interface JobRecord {
  id: string
  view: AppView
  label: string
  status: JobStatus
  startedAt: number
  endedAt: number | null
}

interface JobTrackerValue {
  jobs: JobRecord[]
  startJob: (view: AppView, label: string) => string
  completeJob: (id: string) => void
  failJob: (id: string) => void
}

const JobTrackerContext = createContext<JobTrackerValue | null>(null)

let jobCounter = 0
function makeJobId(): string {
  jobCounter += 1
  return `job-${jobCounter}`
}

export function JobTrackerProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobRecord[]>([])

  const startJob = useCallback((view: AppView, label: string) => {
    const id = makeJobId()
    setJobs((prev) => [...prev, { id, view, label, status: 'active', startedAt: Date.now(), endedAt: null }])
    return id
  }, [])

  const completeJob = useCallback((id: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'completed', endedAt: Date.now() } : j)))
  }, [])

  const failJob = useCallback((id: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'failed', endedAt: Date.now() } : j)))
  }, [])

  const value = useMemo(() => ({ jobs, startJob, completeJob, failJob }), [jobs, startJob, completeJob, failJob])

  return <JobTrackerContext.Provider value={value}>{children}</JobTrackerContext.Provider>
}

export function useJobTracker(): JobTrackerValue {
  const ctx = useContext(JobTrackerContext)
  if (!ctx) {
    throw new Error('useJobTracker() called outside a JobTrackerProvider — check that main.tsx still wraps <App/> with it.')
  }
  return ctx
}

// Powers AppShell's notification bell badge: counts start/complete/fail
// transitions that happened after `since`, without needing a separate event
// log — every JobRecord already carries its own startedAt and (once
// settled) endedAt, so comparing those against a last-viewed timestamp
// reconstructs "what happened since I last looked" for free. A job that
// both started and ended after `since` counts as two events, since starting
// and finishing are each their own notable moment for the bell to surface.
export function countJobEventsSince(jobs: JobRecord[], since: number): number {
  let count = 0
  for (const job of jobs) {
    if (job.startedAt > since) count += 1
    if (job.endedAt !== null && job.endedAt > since) count += 1
  }
  return count
}
