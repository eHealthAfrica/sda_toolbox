// Types for Microplan · DIP Generator — client-side counterpart to
// POST /dip/generator (toolbox/apps/planfeld/dip_template.py::
// generate_daily_implementation_plan, lines 113-152).
//
// This route is a genuine match, same category as Validate DIP and DIP +
// Map Merger: it already takes a compiled DIP (+ an optional Team
// Allocation file, when validate_dip is on) and returns exactly what this
// page needs — one PDF per field team plus a standardized "DIP.csv" — so
// this page calls the real endpoint and parses its actual response rather
// than re-implementing generate_team_dips/DIPTemplateGenerator itself.
//
// TWO things this page does that go beyond "call it and parse the
// response," both flagged during design and confirmed against the real
// source before writing a line of this file:
//
// 1. VALIDATE_DIP CURRENTLY CRASHES EVERY BATCH. Tracing generate_team_dips
//    (template_generator.py, lines 188-195) into
//    validate_daily_implementation_plan(..., referred=True)
//    (mp_validator.py, lines 189-215): with referred=True that function
//    returns `(review_datasets, fields)`, where review_datasets is a dict
//    ({'dip': enriched_dip, 'ward_review': ..., 'team_review': ...}) — not
//    the DataFrame prepare_dip_data returns on the non-validate path. Back
//    in generate_team_dips, that dict is passed straight into
//    DIPTemplateGenerator(dip_data, ...).export_all_teams(), which does
//    self.df['unique_team_code'] — a dict has no such key, so this raises
//    KeyError on every single batch. Switching validate_dip on doesn't
//    quietly change nothing, it makes the request fail outright (a 500,
//    surfaced to this page as a batch error). This page surfaces that
//    plainly — see the caveat card DipGeneratorPage renders once every
//    batch has failed with validation on — and points users to the
//    actually-working Validate DIP page instead of implying this toggle
//    does what its name suggests.
//
// 2. CLIENT-SIDE BATCHING IS A FRONTEND WORKAROUND, NOT A BACKEND FEATURE.
//    /dip/generator has no lgas/state param the way /dip/merger does, and
//    generates every team's PDF in one blocking call with no progress
//    reporting — export_all_teams (template_generator.py, line 36) has no
//    batching of its own. To get a progress bar and to avoid one
//    multi-hundred-MB all-or-nothing request, this page parses the uploaded
//    dip_file client-side (utils/dipGeneratorParse.ts::splitDipFileByLga),
//    groups rows by LGA using the same fuzzy column-matching approach
//    columns.ts already uses elsewhere in this app, and re-uploads one
//    smaller dip_file per LGA-batch via several sequential
//    submitDipGenerator calls — merging every batch's response client-side
//    (JSZip) into one final downloadable zip. This does NOT reduce total
//    server-side compute (the same PDFs still have to be generated
//    somewhere) — what it buys is visible progress and the ability to keep
//    whatever's already completed if a later batch fails. The one open
//    risk, carried over from design: the client's LGA-column guess
//    (columns.ts::detectColumns) has to agree with the backend's own
//    get_admin_col/find_column fuzzy matching, or a batch could silently
//    group rows under the wrong LGA — this page has no way to detect that
//    from the response alone.

export type BatchStatus = 'pending' | 'active' | 'done' | 'error'

export interface DipBatch {
  id: string
  lgas: string[] // the raw LGA values (as found in the uploaded file) this batch covers
  rowCount: number
  status: BatchStatus
  teamsGenerated: number // filled in once status is 'done'
  error: string | null
}

// One team's generated DIP PDF, read back from a batch's real response zip.
// lga/ward/teamCode come from parsing the real, verbatim filename convention
// (template_generator.py::generate_team_pdf, line 60):
// `f"DIP of Team {team_code} {ward} ward, {lga} LGA.pdf"`, with any "/" in
// the LGA name replaced by a single space (Python's str.replace() with no
// count replaces every occurrence) — a DIFFERENT sanitization than
// /dip/merger's own output, which replaces "/" with "-" instead
// (merger.py, line 67). Worth knowing if this page's LGA spellings are ever
// compared against the Map Merger page's.
export interface GeneratedTeamDip {
  lga: string
  ward: string
  teamCode: string
  filename: string
  pages: number
  days: string[] | null // union of activity-day tokens for this team, read from the merged DIP.csv when a matching unique_team_code row is found; null if no match (e.g. the "/" mangling above breaks the join for a slash-bearing LGA name)
  pdfBytes: Uint8Array
}

export interface DipGeneratorAnalysis {
  teamDips: GeneratedTeamDip[] // sorted by LGA, then ward, then team code
  lgaCount: number
  wardCount: number // distinct LGA+Ward pairs
  totalTeams: number
  teamsByLga: { lga: string; teams: number }[] // sorted descending
  csvRows: Record<string, unknown>[] // the merged DIP.csv, all batches concatenated
}

// Ingest note — computed from the RAW uploaded file, before any batch is
// sent, mirroring prepare_dip_data's own drop condition (dip_tools.py line
// 102-105: keep a row if EITHER the team column OR the day-of-activity
// column is non-empty; drop only if both are blank). Uses
// columns.ts::findTeamColumn / findDayOfActivityColumn, the same
// fuzzy-matching approximation columns.ts already documents as imperfect
// for the admin/geo fields — same caveat applies here.
export interface IngestNote {
  totalRows: number
  lgaColumn: string | null
  teamColumn: string | null
  dayColumn: string | null
  rowsMissingBoth: number // would be dropped by prepare_dip_data before any PDF is generated
  distinctLgas: number
}
