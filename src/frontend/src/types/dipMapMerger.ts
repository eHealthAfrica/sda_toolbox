// Types for Microplan · DIP + Map Merger — client-side counterpart to
// POST /dip/merger (toolbox/apps/planfeld/dip_template.py::merge_dip_and_maps).
//
// This route is a genuine match for what this page needs — it already takes
// a Team Guide Maps zip + a DIP zip and returns a zip of one merged map-book
// PDF per LGA — so this page calls the real endpoint and parses its actual
// response, the same approach as Microplan · Validate DIP.
//
// What this page CANNOT get from the backend response is any account of
// what went in versus what came out: the endpoint returns only the merged
// zip, nothing about how many DIP/map pages were uploaded or how many
// failed to pair. `toolbox/mlos/planfeld/microplan/merger.py::arrange_pages`
// silently `continue`s past any team whose DIP page doesn't have exactly
// one matching Team Guide Map page — no error, no log line — so a page that
// only reported the merged output would never surface that drop. Since the
// browser holds the raw uploaded File objects before they're ever sent,
// utils/dipMapMergerParse.ts::computePreflight replicates arrange_pages'
// exact matching logic (verified against the real function body) against
// those two files locally, so the ingest note above can show real matched/
// unmatched counts computed from what the user actually uploaded — not a
// guess, and not something invented in this app that could drift from the
// backend's own behavior.
//
// Every team's DIP page is named
// `f"DIP of Team {team_code} {ward} ward, {lga} LGA.pdf"`
// (toolbox/mlos/planfeld/microplan/template_generator.py, line 60) — the
// "{lga} LGA.pdf" suffix is the real matching key the backend globs each
// LGA's files by. The *merged* per-LGA file that actually gets written and
// zipped, though, is saved as `f"{lga_name} Maps.pdf"` instead (merger.py,
// line 67 — any "/" in the LGA name replaced with "-"), e.g. "Aleiro
// Maps.pdf", "Koko-Besse Maps.pdf". This page derives each output book's
// LGA name from that returned filename (stripping the trailing " Maps.pdf"),
// not from the "{lga} LGA.pdf" input-matching pattern.
export interface PreflightLgaStat {
  lga: string
  dipPages: number
  mapPages: number
  matchedTeams: number
  unmatchedPages: number // DIP pages + map pages that never paired, this LGA
}

export interface PreflightResult {
  totalDipPages: number
  totalMapPages: number
  totalMatchedTeams: number
  totalUnmatchedPages: number
  byLga: PreflightLgaStat[]
}

// One LGA's merged map book, read back from the actual response zip.
// `teams` comes from halving `pages` — real and verified (arrange_pages
// interleaves exactly one DIP page then one map page per matched team,
// confirmed by reading merge_pdfs/arrange_pages verbatim) but not a hard
// guarantee: each DIP page is built with reportlab's flowing
// SimpleDocTemplate layout (template_generator.py::generate_team_pdf),
// which will silently auto-paginate onto a 2nd page if one team's
// settlement table is long enough to overflow a single sheet. `oddPageCount`
// flags any book where that assumption is provably broken for at least one
// team (an odd total can't split evenly into DIP+map pairs).
export interface LgaBookStat {
  lga: string
  outputFilename: string
  pages: number
  teams: number
  oddPageCount: boolean
  pdfBytes: Uint8Array
}

export interface DipMapMergerAnalysis {
  preflight: PreflightResult
  books: LgaBookStat[] // sorted by teams, descending
  lgaCount: number
  totalPages: number
  totalTeams: number
  avgTeamsPerLga: number
  largestLga: { lga: string; teams: number } | null
}
