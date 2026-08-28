import type { PIFigureLevel, PostReport } from '../types/postImplementation'

export interface StateChartCount {
  state: string
  count: number
}

/** Count of generated reports of one level ('lga' summary pies or 'ward' breakdown bars), grouped by state — powers the two "charts generated, by state" bar charts. */
export function countReportsByState(reports: PostReport[], level: PIFigureLevel): StateChartCount[] {
  const counts = new Map<string, number>()
  for (const report of reports) {
    if (report.level !== level) continue
    counts.set(report.state, (counts.get(report.state) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => a.state.localeCompare(b.state))
}

export function uniqueStates(reports: PostReport[]): string[] {
  return Array.from(new Set(reports.map((r) => r.state))).sort((a, b) => a.localeCompare(b))
}

/** LGA options scoped to whichever State is currently selected — mirrors the State->LGA narrowing already used elsewhere in this app (e.g. ContactSettlementListTable). */
export function uniqueLgasForState(reports: PostReport[], state: string | null): string[] {
  const scoped = state ? reports.filter((r) => r.state === state) : reports
  return Array.from(new Set(scoped.map((r) => r.lga))).sort((a, b) => a.localeCompare(b))
}

/** Narrows the full report set down to whatever the page's current State/LGA selection scopes to — used by both the tables and the gallery so they always agree on what's "in view". */
export function filterReports(reports: PostReport[], state: string | null, lga: string | null): PostReport[] {
  return reports.filter((report) => (!state || report.state === state) && (!lga || report.lga === lga))
}
