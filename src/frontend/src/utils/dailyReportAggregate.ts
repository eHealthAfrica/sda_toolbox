import type { DailyPostReport, DailyReportFigureLevel, DailyReportQualifier } from '../types/dailyReport'
import { reportQualifier } from '../types/dailyReport'

export interface StateChartCount {
  state: string
  count: number
}

/**
 * Count of generated reports of one level ('state' summary pies or 'lga'
 * LGA-breakdown bars), grouped by state — optionally narrowed to one
 * Daily/Cumulative qualifier (pass null to count both together). Mirrors
 * utils/postImplementationAggregate.ts::countReportsByState, extended with
 * the qualifier dimension Post Implementation has no analogue for.
 */
export function countReportsByState(
  reports: DailyPostReport[],
  level: DailyReportFigureLevel,
  qualifier: DailyReportQualifier | null,
): StateChartCount[] {
  const counts = new Map<string, number>()
  for (const report of reports) {
    if (report.level !== level) continue
    if (qualifier && reportQualifier(report) !== qualifier) continue
    counts.set(report.state, (counts.get(report.state) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => a.state.localeCompare(b.state))
}

export function uniqueStates(reports: DailyPostReport[]): string[] {
  return Array.from(new Set(reports.map((r) => r.state))).sort((a, b) => a.localeCompare(b))
}

/**
 * Narrows the full report set down to whatever the page's current
 * State/Qualifier selection scopes to — used by both the chart tables and
 * the gallery so they always agree on what's "in view". Unlike Post
 * Implementation there is no LGA dimension here: DailyReport's `lga` field
 * is always null (see types/dailyReport.ts), so Qualifier (Day/Cumulative)
 * takes the second-filter role LGA plays over there.
 */
export function filterReports(
  reports: DailyPostReport[],
  state: string | null,
  qualifier: DailyReportQualifier | null,
): DailyPostReport[] {
  return reports.filter(
    (report) => (!state || report.state === state) && (!qualifier || reportQualifier(report) === qualifier),
  )
}
