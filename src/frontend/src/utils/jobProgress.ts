// The stages of a tool's pipeline, in order, and how a stage name reported by
// the backend maps onto them. The names must match the strings the backend
// passes to report_stage() (see apps/tracking/tracks_analysis.py,
// reach_analysis.py); a name the list does not contain is
// shown as plain text without moving the bar, so a renamed stage never breaks
// the page.

import type { JobLogLine, JobLogStatus } from '../types/jobLogs'

export const GTS_STEPS = ['Reading tracks', 'Validating tracks', 'Analysing teams and devices', 'Writing results'] as const

export const REACH_STEPS = [
  'Reading settlements',
  'Reading data sources',
  'Validating inputs',
  'Matching settlements',
  'Writing results',
] as const

export interface JobProgress {
  // Stages finished so far, and how many there are.
  completed: number
  total: number
  // The stage name, or a short state: "Starting…", "Finished", "Stopped at: ...".
  headline: string
  // "Step 2 of 4", or null when no stage is known.
  stepText: string | null
  // True while the page is waiting on the run; the current stage then pulses.
  running: boolean
  failed: boolean
  done: boolean
}

function indexOfStage(steps: readonly string[], stage: string | null): number {
  if (!stage) return -1
  const wanted = stage.trim().toLowerCase()
  return steps.findIndex((s) => s.toLowerCase() === wanted)
}

// `status` is the backend's view of the run (JobLogStatus) and wins over the
// browser's `requestRunning`: the backend knows the pipeline has finished
// before the browser has finished downloading and reading the result.
export function computeProgress(
  steps: readonly string[],
  stage: string | null,
  status: JobLogStatus | null,
  requestRunning: boolean,
): JobProgress {
  const total = steps.length
  const at = indexOfStage(steps, stage)

  if (status === 'completed') {
    return { completed: total, total, headline: 'Finished', stepText: null, running: false, failed: false, done: true }
  }

  if (status === 'failed') {
    return {
      completed: Math.max(at, 0),
      total,
      headline: at >= 0 ? `Stopped at: ${steps[at]}` : 'The run stopped',
      stepText: at >= 0 ? `Step ${at + 1} of ${total}` : null,
      running: false,
      failed: true,
      done: false,
    }
  }

  if (!requestRunning && at < 0 && status !== 'active') {
    // Not started: nothing to show but an idle bar.
    return { completed: 0, total, headline: 'Waiting to start', stepText: null, running: false, failed: false, done: false }
  }

  if (at < 0) {
    const named = stage && stage.trim() !== '' ? stage.trim() : null
    return { completed: 0, total, headline: named ?? 'Starting…', stepText: null, running: requestRunning, failed: false, done: false }
  }

  return {
    completed: at,
    total,
    headline: steps[at],
    stepText: `Step ${at + 1} of ${total}`,
    // The page stopped waiting (e.g. the connection dropped) while the backend
    // may still be working: show where it got to, without the moving effect.
    running: requestRunning,
    failed: false,
    done: false,
  }
}

// What the tool is doing right now, in its own words: the newest log line,
// skipping DEBUG noise. Null before the first line.
export function latestLogMessage(lines: readonly JobLogLine[]): JobLogLine | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].level !== 'DEBUG' && lines[i].message.trim() !== '') return lines[i]
  }
  return null
}

// 83 -> "1:23", 3725 -> "1:02:05"
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
