// Compiler · Disaggregate MLoS — POST /compiler/disaggregate
// (toolbox/apps/aggregators/splitter.py::disaggregate_mlos, lines 19-79).
// Splits an uploaded Master List of Settlements into one Excel sheet per
// LGA (or per Ward — lga_code + "_" + ward_code), each formatted with
// borders and data-validation rules (add_borders / add_data_validation_rules).
// Returns a single .xlsx workbook, not zipped.
//
// `mlos_file` is the only UploadFile; `level` has no Form()/Query()
// annotation on the backend, so — same FastAPI inference already documented
// in api/client.ts for /qc/validation — it resolves to a Query param, sent
// on the URL rather than as a form field.
//
// This route is unusual among the ones investigated this session: it does
// NOT silently drop rows. Every uploaded row lands in exactly one sheet
// (grouped by pandas groupby, no team-code/day-of-activity filter, no
// dedup). Verified against a real MLoS export (QC_Results.csv, 12,963 rows)
// during design: 21 LGA groups / 225 Ward groups, every row accounted for
// either way.
//
// Two real risks, both explained in the page's caveat card:
//  - Sheet names come from `level_code.replace("/", "-").split("_")` joined
//    by spaces and truncated to Excel's 31-character sheet-name limit — two
//    differently-named groups that happen to truncate to the same 31
//    characters would silently collide (second sheet's data overwrites the
//    first). No collision in the real sample file checked during design.
//  - Ward-level splitting can approach (or on a larger dataset, exceed)
//    Excel's hard 255-sheet-per-workbook ceiling; openpyxl raises if it
//    does. 225 sheets on the one real sample checked is already close.
//  - (Theoretical, not observed) pandas' groupby drops rows whose group key
//    is NaN by default — a row missing its LGA/Ward value entirely would
//    vanish from every sheet with nothing logged. Not seen in the one real
//    file checked (zero missing admin values), so this page reports a
//    missing-admin-value count computed from the ORIGINAL upload rather
//    than assuming it can never happen.

export const DISAGGREGATE_LEVELS = ['LGA', 'Ward'] as const
export type DisaggregateLevel = (typeof DISAGGREGATE_LEVELS)[number]

export interface DisaggregateFormInput {
  mlosFile: File | null
  level: DisaggregateLevel
}

export interface SheetSummary {
  name: string
  recordCount: number
}

export interface DisaggregateResult {
  sheets: SheetSummary[]
  /** Row count from the ORIGINAL uploaded file, computed client-side before submission — not from the response. */
  totalRecordsOriginal: number
  /** Rows in the original upload missing an LGA (or, at Ward level, an LGA or Ward) value — these would silently vanish from every sheet (pandas groupby drops NaN keys). */
  rowsMissingAdminValue: number
  level: DisaggregateLevel
}
