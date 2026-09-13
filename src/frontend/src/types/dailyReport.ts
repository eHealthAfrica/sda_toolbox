// Types for POST /reports/daily (toolbox/apps/tracking/reporter/
// campaign_day_reporting.py::generate_campaign_daily_report).
//
// The route was reworked server-side to match the exact same JSON contract
// POST /reports/post already used: it now returns `list[PostReport]`
// (toolbox/reporting/reporter.py::PostReport) directly — plain JSON built
// by DailyReport.generate_report(), the same shared PostReport model,
// viz.py/prep.py helpers, and `{state, lga, level, figure, save_name}`
// shape Post Implementation uses — not the old ZIP-of-four-fixed-filename-
// PNGs response this app used to expect. api/parseResult.ts::
// parseDailyReportZip (and the old DailyReportResults.tsx it fed) have been
// removed accordingly; see api/client.ts::submitDailyReport for the fetch.
//
// DailyReport's own PostReport instances differ from Post Implementation's
// in ways that matter here specifically (confirmed directly against
// toolbox/reporting/reporter.py::DailyReport, not assumed):
//   - `level` is only ever 'state' (one pie chart per state — the
//     Daily/Cumulative SUMMARY, generate_summary_report) or 'lga' (one bar
//     chart per state, broken down BY lga on the x-axis — the
//     Daily/Cumulative BREAKDOWN, generate_lga_reports). There is no
//     'ward' level, and — confirmed from source — the `lga` field itself is
//     always `None` on every entry DailyReport produces. This route has no
//     per-LGA report, only per-STATE, so there is no LGA filter to offer
//     here the way Post Implementation's ward-level reports have one.
//   - generate_report() concatenates FOUR groups into one flat array — Day
//     Breakdown, Day Summary, Cumulative Breakdown, Cumulative Summary —
//     and the ONLY signal telling them apart is literal text baked into
//     `save_name` (both generate_summary_report and generate_lga_reports set
//     `qualifier = 'Daily' if subset else 'Cumulative'` and interpolate it
//     into the filename, e.g. "Kano State Day 4 Daily Summary .png" vs
//     "Kano State Day 4 Cumulative Breakdown Report.png") — there is no
//     dedicated field for it. reportQualifier() below recovers it; every
//     name contains the word exactly once, so a substring check is exact.
//   - `campaign_day_col` and `coverage_col` are both REQUIRED, bare
//     (un-annotated) params on the route — Query params, per this repo's
//     FastAPI convention — not the old optional day/cumulative pair. A
//     single call always builds both a Day and a Cumulative set, so there
//     is no more "at least one of two" form validation.

import type { Data, Layout } from 'plotly.js'

export interface DailyReportFormInput {
  settlementFile: File | null
  /** Sent as the required `campaign_day_col` query param. */
  campaignDayCol: string
  /** Sent as the required `coverage_col` query param. */
  coverageCol: string
}

/** 'state' = per-state summary pie chart. 'lga' = per-state breakdown-by-LGA bar chart. Never 'ward' — see the top-of-file note. */
export type DailyReportFigureLevel = 'state' | 'lga'

/** A raw Plotly figure spec, shaped exactly like plotly.py's `Figure.to_json()` output — same shape as types/postImplementation.ts's PostReportFigure. */
export interface DailyReportFigure {
  data: Data[]
  layout: Partial<Layout>
}

/** One entry of the `list[PostReport]` JSON response — toolbox/reporting/reporter.py::PostReport, as DailyReport.generate_report() produces it. `lga` is always null here (see top-of-file note). */
export interface DailyPostReport {
  state: string
  lga: string | null
  level: DailyReportFigureLevel
  figure: DailyReportFigure
  save_name: string
}

/** 'day' = this campaign day only (the `data[campaign_day_col].notnull()` subset). 'cumulative' = the full dataset. Parsed from `save_name` — see the top-of-file note; there is no dedicated field for it. */
export type DailyReportQualifier = 'day' | 'cumulative'

/**
 * Recovers the Daily/Cumulative split reporter.py bakes into `save_name`
 * text instead of a field (`qualifier = 'Daily' if subset else 'Cumulative'`,
 * reporter.py's generate_summary_report/generate_lga_reports) — every
 * save_name contains the literal word exactly once, so a direct substring
 * check is exact, not a heuristic.
 */
export function reportQualifier(report: DailyPostReport): DailyReportQualifier {
  return report.save_name.includes('Cumulative') ? 'cumulative' : 'day'
}
