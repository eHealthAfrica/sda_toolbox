// Types for POST /reports/daily (toolbox/apps/tracking/reporter/
// campaign_day_reporting.py::generate_campaign_daily_report). See
// api/client.ts::submitDailyReport for the full, source-grounded writeup of
// why this route cannot succeed today — these types describe the real
// request/response contract regardless, since that contract is fully
// determinable from source even though every path through it currently
// crashes or is blocked.

export interface DailyReportFormInput {
  settlementFile: File | null
  /** Sent as the `campaign_day_col` query param, only when non-null. */
  campaignDayCol: string | null
  /** Sent as the `cumulative_day_col` query param, only when non-null. */
  cumulativeDayCol: string | null
}

/** One PNG chart image read out of the response ZIP, as an object URL. */
export interface DailyReportChartImage {
  filename: string
  url: string
}

export interface DailyReportChartSet {
  summary: DailyReportChartImage
  breakdown: DailyReportChartImage
}

/**
 * DailyReport.generate_report() (reporting/reporter.py:47-63) builds a
 * "day" set only when campaign_day_col was supplied, a "cumulative" set only
 * when cumulative_day_col was supplied — either, or both, can be present.
 */
export interface ParsedDailyReportResult {
  day: DailyReportChartSet | null
  cumulative: DailyReportChartSet | null
}
