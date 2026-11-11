import { useEffect, useMemo, useState } from 'react'
import { JOB_LOGS_ENABLED } from '../../utils/jobLogs'
import { computeProgress, formatElapsed, latestLogMessage } from '../../utils/jobProgress'
import { useJobLogs } from './useJobLogs'

interface JobProgressProps {
  // The client-generated id sent with the request; null before any run.
  jobId: string | null
  // True while the tool's request is in flight.
  running: boolean
  // The pipeline's stages in order (GTS_STEPS, REACH_STEPS, ...).
  steps: readonly string[]
}

// A fresh class prefix keeps the keyframes from clashing with App.css.
const CSS = `
@keyframes jobprogress-pulse { 0%, 100% { opacity: 0.55 } 50% { opacity: 0.2 } }
.jobprogress-active { animation: jobprogress-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .jobprogress-active { animation: none; opacity: 0.4; } }
`

const LEVEL_COLOR: Record<string, string> = {
  WARNING: '#8a5a00',
  ERROR: 'var(--color-critical)',
  CRITICAL: 'var(--color-critical)',
}

// Where the run is in the pipeline: a bar that fills as stages finish (the
// stage in progress pulses), the stage's name, how long it has taken, and
// under the bar the newest line the tool logged, which says what it is doing
// at this moment. The raw log is not shown. Shown only when the live-log
// feature is on (VITE_JOB_LOGS=true) and the backend answers; on any other
// backend it renders nothing, so the page looks exactly as it did before.
// The bar moves by stage, not by percentage: the backend cannot know how long
// a stage will take, so nothing here pretends to.
export default function JobProgress({ jobId, running, steps }: JobProgressProps) {
  const { lines, status, stage, available } = useJobLogs(jobId, running)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const progress = useMemo(() => computeProgress(steps, stage, status, running), [steps, stage, status, running])
  const newest = useMemo(() => latestLogMessage(lines), [lines])

  // A new run starts the clock.
  useEffect(() => {
    if (!jobId) return
    setStartedAt(Date.now())
    setEndedAt(null)
  }, [jobId])

  // Stop the clock when the run is over, whichever side noticed first.
  const over = progress.failed || progress.done || (!running && status !== null && status !== 'unknown')
  useEffect(() => {
    if (over) setEndedAt((prev) => prev ?? Date.now())
  }, [over])

  useEffect(() => {
    if (!running || over) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, over])

  if (!JOB_LOGS_ENABLED || !jobId || available === false) return null

  const elapsed = startedAt === null ? null : formatElapsed(((endedAt ?? now) - startedAt) / 1000)
  const total = Math.max(progress.total, 1)
  const donePercent = (progress.completed / total) * 100
  const stagePercent = progress.done ? 0 : 100 / total

  // The line under the bar: what the tool is doing now, or how the run ended.
  let message: string
  let messageColor = 'var(--color-text-secondary)'
  if (progress.done) {
    message = elapsed ? `Finished in ${elapsed}` : 'Finished'
  } else if (progress.failed) {
    message = newest?.message ?? 'The run stopped before it finished.'
    messageColor = 'var(--color-critical)'
  } else {
    message = newest?.message ?? (running ? 'Waiting for the first update…' : '')
    if (newest && LEVEL_COLOR[newest.level]) messageColor = LEVEL_COLOR[newest.level]
  }

  const barColor = progress.done ? 'var(--color-good)' : 'var(--color-primary)'

  return (
    <section
      aria-label="Pipeline progress"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        marginBottom: 20,
        padding: '12px 14px 12px',
      }}
    >
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, fontWeight: 600, color: progress.failed ? 'var(--color-critical)' : 'var(--color-text)' }}
        >
          {progress.headline}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {[progress.stepText, elapsed].filter(Boolean).join(' · ')}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Pipeline progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.completed}
        aria-valuetext={[progress.headline, progress.stepText].filter(Boolean).join(', ')}
        style={{ position: 'relative', height: 8, borderRadius: 4, background: 'rgba(11, 11, 11, 0.1)', overflow: 'hidden' }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '0 auto 0 0',
            width: `${donePercent}%`,
            background: barColor,
            transition: 'width 400ms ease',
          }}
        />
        {(progress.running || progress.failed) && (
          <div
            className={progress.running && !progress.failed ? 'jobprogress-active' : undefined}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${donePercent}%`,
              width: `${stagePercent}%`,
              background: progress.failed ? 'var(--color-critical)' : barColor,
              transition: 'left 400ms ease',
            }}
          />
        )}
      </div>

      <div
        title={message}
        aria-live="off"
        style={{
          marginTop: 8,
          minHeight: 18,
          fontSize: 12.5,
          lineHeight: 1.45,
          color: messageColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {message}
      </div>
    </section>
  )
}
