import type { CategoryStats, DailyStats } from '../types/reliability'

// Pure helpers for the Reliability page: formatting, tone thresholds and the
// chart scale. Kept free of React so they can be tested on their own.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const CATEGORY_LABELS: Record<string, string> = {
  code_error: 'Code error',
  resource: 'Resource limit',
  dependency: 'Dependency down',
  interrupted: 'Interrupted',
  data_contract: 'Data check failed',
  user_input: 'Bad input',
}

export const CATEGORY_HINTS: Record<string, string> = {
  code_error: 'An unhandled exception or HTTP 500 in the toolbox',
  resource: 'Timeout, out of memory or disk full',
  dependency: 'The database or an outside service was unreachable',
  interrupted: 'The backend restarted or crashed while the job ran',
  data_contract: 'The uploaded data failed a DataOps check',
  user_input: 'The request itself was wrong, such as a missing field or file type',
}

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return 'Uncategorised'
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ')
}

export function formatPct(rate: number | null, digits = 1): string {
  if (rate === null || Number.isNaN(rate)) return '—'
  return `${(rate * 100).toFixed(digits)}%`
}

// 45s, 12m, 1h 30m, 2d 3h. Whole units only; the review cares about the order
// of magnitude, not seconds.
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const m = minutes % 60
    return m === 0 ? `${hours}h` : `${hours}h ${m}m`
  }
  const days = Math.floor(hours / 24)
  const h = hours % 24
  return h === 0 ? `${days}d` : `${days}d ${h}h`
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
  if (ms < 3600000) {
    const totalSeconds = Math.round(ms / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return s === 0 ? `${m}m` : `${m}m ${s}s`
  }
  return formatSeconds(ms / 1000)
}

export function relativeTime(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const delta = Math.max(0, Math.round((nowMs - t) / 1000))
  if (delta < 10) return 'just now'
  return `${formatSeconds(delta)} ago`
}

// 'YYYY-MM-DD' -> '14 Oct' without going through Date (no timezone shift).
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  if (!m || !d) return date
  return `${d} ${MONTHS[m - 1]}`
}

// 'YYYY-MM-DD' -> 'Wed 14 Oct 2026'. The weekday is computed in UTC so it
// matches the backend's UTC day buckets.
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`
}

export type RateTone = 'good' | 'warning' | 'critical' | 'none'

// At or above target is good; within three points below is a warning (close
// enough that one bad day tips it); anything lower is critical.
export function rateTone(rate: number | null, target: number): RateTone {
  if (rate === null) return 'none'
  if (rate >= target) return 'good'
  if (rate >= target - 0.03) return 'warning'
  return 'critical'
}

export const TONE_COLORS: Record<RateTone, string> = {
  good: 'var(--color-good)',
  warning: '#b87a00',
  critical: 'var(--color-critical)',
  none: 'var(--color-text-muted)',
}

export function totalJobs(day: DailyStats): number {
  return day.completed + day.failed_counted + day.failed_excluded
}

export interface RateScale {
  lo: number
  hi: number
  ticks: number[]
}

// The success-rate axis runs from a rounded floor below the worst day up to
// 100%. It is deliberately not always 0 to 100: a rate that lives between 90
// and 100% would be a flat line on a full axis. The floor is labelled on the
// chart so the cut is visible.
export function rateScale(daily: DailyStats[], target: number): RateScale {
  const rates = daily.map((d) => d.success_rate).filter((r): r is number => r !== null)
  const worst = rates.length > 0 ? Math.min(...rates, target) : target
  const rawLo = Math.max(0, Math.min(0.8, Math.floor((worst - 0.05) * 10) / 10))
  const step = 1 - rawLo > 0.4 ? 0.2 : 0.1
  // Round the floor down to a whole number of steps below 100% so the ticks
  // land evenly (100, 80, 60, 40 rather than 100, 90, 70, 50).
  const lo = Math.max(0, Math.round((1 - Math.ceil((1 - rawLo) / step - 1e-9) * step) * 100) / 100)
  const ticks: number[] = []
  for (let v = lo; v <= 1.0000001; v += step) ticks.push(Math.round(v * 100) / 100)
  if (ticks[ticks.length - 1] !== 1) ticks.push(1)
  return { lo, hi: 1, ticks }
}

export function sumCategoryCounts(categories: CategoryStats[], counted: boolean): number {
  return categories.filter((c) => c.counted === counted).reduce((acc, c) => acc + c.count, 0)
}

export function filterByTool<T extends { tool: string }>(items: T[], tool: string | null): T[] {
  return tool === null ? items : items.filter((item) => item.tool === tool)
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return ''
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
