import { SETTLEMENT_COVERAGE_CATEGORIES } from './h2h'
import type { SettlementCoverageCategory } from './h2h'

export { SETTLEMENT_COVERAGE_CATEGORIES }
export type { SettlementCoverageCategory }

// toolbox/apps/campaign/contact_analysis.py::inter_campaign_contact_analysis
// (POST /contact_analysis) — base_file is the baseline settlement list;
// previous_campaign_file is a single Excel workbook where EACH SHEET is one
// previous campaign round's own visitation/coverage export. The backend
// reads `openpyxl.load_workbook(...).sheetnames` to get the round list — see
// toolbox/campaign/contact_analysis.py's own __main__ dev harness — so the
// number of "rounds" compared is exactly the sheet count of this one file,
// not a value either file states directly. The response CSV names each
// round's harmonized visitation column after that same sheet name (e.g. a
// "July Round" sheet produces a "July Round" column of
// Visited/Not Visited/Not Found) — see utils/contactAggregate.ts's
// detectRoundColumns, which recovers the round list client-side from
// whichever of those columns the response actually has, rather than this
// app needing to inspect the uploaded workbook itself.
export interface ContactAnalysisFormInput {
  baseFile: File | null
  previousCampaignFile: File | null
}

// harmonize_visitation (toolbox/campaign/contact_analysis.py) — the value
// each round column holds for a given settlement. 'Not Found' means the
// settlement didn't appear in that round's own dataset at all (excluded
// from contact_proportion's denominator — see evaluate_contact_prop), not
// that it was visited-and-marked-absent.
export const ROUND_VISITATION_STATUSES = ['Visited', 'Not Visited', 'Not Found'] as const
export type RoundVisitationStatus = (typeof ROUND_VISITATION_STATUSES)[number]

// One row of the CSV POST /contact_analysis returns. `unique_code`/
// `settlement_id` and the fuzzy-detected admin/geo columns pass through
// from the baseline file unchanged (utils/columns.ts::detectColumns mirrors
// the same fuzzy matching used elsewhere in this app); one column per round
// (see ContactAnalysisFormInput's comment); `contact` (count of
// 'Visited' rounds), `contact_proportion` (contact / rounds with a
// Visited-or-Not-Visited value for that settlement — NOT necessarily divided
// by the total round count, since a round the settlement was absent from
// doesn't count toward either side), and `coverage` (harmonize_coverage's
// single best coverage value across every round) are always present.
export type ContactRecord = Record<string, string | number | null>

export interface ParsedContactAnalysisResult {
  records: ContactRecord[]
  columns: string[]
  sourceFilename: string
}
