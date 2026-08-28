// Types for POST /reports/post
// (toolbox/apps/tracking/reporter/post_implementation_report.py::
// generate_post_implementation_reports).
//
// The endpoint now returns a JSON array of PostReport objects
// (toolbox/reporting/reporter.py::PostReport) instead of a ZIP of PNGs — one
// LGA-level summary pie chart ('level': 'lga') and one ward-level breakdown
// bar chart ('level': 'ward') per LGA in the uploaded settlement list. Each
// entry carries its own state/lga/level fields directly, so nothing needs to
// be recovered from a filename anymore (contrast the old
// utils/postImplementationAggregate.ts::parseChartFilename, now removed).
//
// `figure` is a raw Plotly figure spec — reporter.py::PostReport.
// serialize_figure returns `json.loads(figure.to_json())`, which is exactly
// the `{data, layout}` shape plotly.py's own JSON export produces and that
// plotly.js consumes on the frontend. @types/plotly.js does NOT actually
// export a top-level `Figure` type (confirmed — `import type { Figure } from
// 'plotly.js'` fails to compile with TS2614; the earlier version of this
// file assumed it did and was never caught because no tsc was run against
// it until now), so this composes the same shape from the two named types
// that package genuinely does export.

import type { Data, Layout } from 'plotly.js'

export interface PostImplementationFormInput {
  settlementFile: File | null
  /** Sent as the required `report_col` form field — the final visitation/coverage status column. */
  reportCol: string
}

/** 'lga' = LGA-level summary pie chart. 'ward' = ward-level breakdown bar chart for that LGA. */
export type PIFigureLevel = 'lga' | 'ward'

/** A raw Plotly figure spec, shaped exactly like plotly.py's `Figure.to_json()` output. */
export interface PostReportFigure {
  data: Data[]
  layout: Partial<Layout>
}

/** One entry of the `list[PostReport]` JSON response — toolbox/reporting/reporter.py::PostReport. */
export interface PostReport {
  state: string
  lga: string
  level: PIFigureLevel
  figure: PostReportFigure
  save_name: string
}
