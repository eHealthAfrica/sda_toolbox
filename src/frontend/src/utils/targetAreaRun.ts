import type { SkippedState, TargetAreaRunSummary } from '../types/targetArea'

/**
 * Reads the X-TA-Summary response header of POST /ta/generate_ta:
 * {"states_run": ["Borno"], "skipped": [{"state": "Zamfara", "reason": "..."}]}.
 *
 * Anything unexpected, including a missing header, gives null so the page shows no states card rather than a
 * wrong one. Entries that are not well formed are left out; a state listed twice is shown once.
 */
export function parseTargetAreaSummary(header: string | null): TargetAreaRunSummary | null {
  if (!header) return null
  try {
    const body: unknown = JSON.parse(header)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    const record = body as Record<string, unknown>
    if (!Array.isArray(record.states_run) || !Array.isArray(record.skipped)) return null

    const statesRun = unique(record.states_run.filter((name): name is string => typeof name === 'string' && name.trim() !== ''))

    const skipped: SkippedState[] = []
    const seen = new Set<string>()
    for (const item of record.skipped) {
      if (typeof item !== 'object' || item === null) continue
      const { state, reason } = item as Record<string, unknown>
      if (typeof state !== 'string' || state.trim() === '' || seen.has(state)) continue
      seen.add(state)
      skipped.push({ state, reason: typeof reason === 'string' && reason.trim() !== '' ? reason : 'No reason was given' })
    }
    return { statesRun, skipped }
  } catch {
    return null
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

/** "3 of 4 states ran" for the card; the count of every state the run looked at is ran + skipped. */
export function statesRunText(summary: TargetAreaRunSummary): string {
  const total = summary.statesRun.length + summary.skipped.length
  return `${summary.statesRun.length} of ${total}`
}
