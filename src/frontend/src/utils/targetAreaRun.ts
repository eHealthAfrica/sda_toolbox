import type { PlannedMatch, SkippedState, TargetAreaRunSummary } from '../types/targetArea'

/**
 * Reads the X-TA-Summary response header of POST /ta/generate_ta:
 * {"states_run": ["Borno"], "skipped": [{"state": "Zamfara", "reason": "..."}], "planned": {"requested": 40, "matched": 38}}
 * (`planned` only when a planned list was uploaded).
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
    return { statesRun, skipped, planned: readPlanned(record.planned) }
  } catch {
    return null
  }
}

function readPlanned(value: unknown): PlannedMatch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { requested, matched } = value as Record<string, unknown>
  if (typeof requested !== 'number' || typeof matched !== 'number') return null
  if (!Number.isFinite(requested) || !Number.isFinite(matched) || requested < 0 || matched < 0) return null
  return { requested, matched: Math.min(matched, requested) }
}

/** True when a planned list was uploaded and some of its settlements were not found in the generated areas. */
export function plannedShortfall(summary: TargetAreaRunSummary): number {
  return summary.planned ? summary.planned.requested - summary.planned.matched : 0
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

/** "3 of 4 states ran" for the card; the count of every state the run looked at is ran + skipped. */
export function statesRunText(summary: TargetAreaRunSummary): string {
  const total = summary.statesRun.length + summary.skipped.length
  return `${summary.statesRun.length} of ${total}`
}
