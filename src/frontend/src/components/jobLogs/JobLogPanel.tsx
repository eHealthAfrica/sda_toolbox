import { useEffect, useRef, useState } from 'react'
import type { JobLogLine } from '../../types/jobLogs'

interface JobLogPanelProps {
  lines: JobLogLine[]
  // True when older lines were dropped because the backend buffer is full.
  truncated: boolean
  // True while the tool's request is in flight.
  running: boolean
}

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: 'var(--color-text-muted)',
  INFO: 'var(--color-text-secondary)',
  WARNING: '#8a5a00',
  ERROR: 'var(--color-critical)',
  CRITICAL: 'var(--color-critical)',
}

const smallButton = {
  minHeight: 26,
  padding: '0 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
} as const

function clock(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString([], { hour12: false })
}

// The pipeline's raw log lines, for when the progress bar is not enough (the
// "Show log" section of JobProgress). It only draws what it is given; the
// polling lives in useJobLogs, which JobProgress calls once.
export default function JobLogPanel({ lines, truncated, running }: JobLogPanelProps) {
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines, autoScroll])

  async function copyAll() {
    const text = lines.map((l) => `${l.ts} ${l.level} ${l.message}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be refused (insecure origin); nothing to fall back to.
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
          {lines.length} line{lines.length === 1 ? '' : 's'}
          {running ? ' so far' : ''}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Follow
          </label>
          <button type="button" onClick={() => void copyAll()} disabled={lines.length === 0} style={smallButton}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </div>
      <div
        ref={bodyRef}
        role="log"
        aria-live="off"
        tabIndex={0}
        style={{
          maxHeight: 240,
          overflow: 'auto',
          borderTop: '1px solid var(--color-border)',
          background: '#fafaf8',
          padding: '8px 14px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 11.5,
          lineHeight: 1.55,
        }}
      >
        {truncated && <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>Older lines were dropped; showing the latest {lines.length}.</div>}
        {lines.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)' }}>
            {running ? 'Waiting for the first log line…' : 'No log lines were recorded for this run.'}
          </div>
        ) : (
          lines.map((line) => (
            <div key={line.seq} style={{ display: 'flex', gap: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <span style={{ color: 'var(--color-text-muted)', flex: 'none' }}>{clock(line.ts)}</span>
              <span
                style={{
                  color: LEVEL_COLOR[line.level] ?? 'var(--color-text-secondary)',
                  flex: 'none',
                  minWidth: 54,
                  fontWeight: line.level === 'ERROR' || line.level === 'CRITICAL' ? 700 : 400,
                }}
              >
                {line.level}
              </span>
              <span style={{ color: 'var(--color-text)' }}>{line.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
