// Types for the Microplan · Combine DMP Files page (client-side counterpart
// to POST /aggregator/dmp/combine, toolbox/apps/planfeld/dmp.py).
//
// IMPORTANT — why this analysis runs entirely client-side instead of calling
// the backend and reading its response:
//
// The route as currently written (dmp.py::extract_and_retrieve_datasets)
// expects a FLAT zip of per-LGA CSVs (filename pattern "...—LGA.csv") and
// writes ONE EXCEL SHEET PER LGA via a plain pd.read_csv per file. That does
// not match either (a) the real upload shape — a zip of zipped LGA folders,
// each containing WARD-level CSVs, confirmed against the sample
// COMPRESSED.zip — or (b) the target output shape you described and the
// sample output_example.xlsx confirmed: two sheets, "Settlements" (13,184
// rows) and "Special Places" (620 rows). A plain pd.read_csv on a real ward
// CSV also mis-parses it: each ward file is actually TWO stacked tables (a
// settlement list, then — after a few blank rows — a "Special Place"/"Type"
// mini-table of schools/mosques/markets/churches with no LGA/Ward columns of
// its own), which read_csv would fold into the settlement table's columns as
// garbage rows.
//
// Until the backend is updated to match, this page parses the uploaded zip
// itself (parseDmpArchive in utils/microplanCombine.ts) so the cards/table
// numbers are always correct, and builds the downloadable .xlsx client-side
// too (utils/microplanWorkbook.ts) in the verified Settlements/Special
// Places shape. Swap this out for a real API call once dmp.py is updated —
// see submitCombineDmpFiles in api/client.ts for the (currently unused, but
// present and ready) request wiring for that route.

export type DipExpansion = 'expand' | 'keep'

// One row of the "Settlements" output sheet — column set and order verified
// against the sample output_example.xlsx exactly (State/State Code/LGA Code/
// Ward Code/"Population by day" are read from the source CSV but dropped
// from this shape, matching that file).
export interface SettlementRecord {
  source: string // `${lga}—${ward}`, e.g. "Aleiro—Aleiro Dangaladima I"
  settlementGuid: string
  lga: string
  ward: string
  wardId: string // `${lga}_${ward}` — matches output_example.xlsx's WardID column exactly
  takeOffPoint: string
  settlementName: string
  habitation: string
  accessibility: string
  category: string
  population: number
  latitude: number
  longitude: number
  team: string
  days: string
}

// One row of the "Special Places" output sheet — LGA/Ward/Source are
// inherited from the settlement rows above the "Special Place"/"Type"
// mini-table in the same ward CSV, since that table has no admin columns.
export interface SpecialPlaceRecord {
  source: string
  lga: string
  ward: string
  specialPlace: string
  type: string
}

export interface ManifestEntry {
  archiveName: string
  status: 'processed' | 'skipped'
  wardFilesRead?: number
  reason?: string
}

export interface BreakdownSlice {
  label: string
  count: number
  pct: number
}

export interface WardTeamCount {
  ward: string
  teams: number
}

export interface LgaTeamCount {
  lga: string
  teams: number
  wards: WardTeamCount[]
}

export interface CombineAnalysis {
  manifest: ManifestEntry[]
  settlements: SettlementRecord[]
  specialPlaces: SpecialPlaceRecord[]

  lgaCount: number
  wardCount: number
  settlementCount: number
  specialPlaceCount: number

  categoryBreakdown: BreakdownSlice[]
  habitationBreakdown: BreakdownSlice[]
  accessibilityBreakdown: BreakdownSlice[]
  specialPlaceTypeBreakdown: BreakdownSlice[]

  teamCount: number
  teamsByLga: LgaTeamCount[]

  rawPopulation: number
  dedupedPopulation: number
  duplicateSettlementCount: number
  duplicateRowCount: number
  targetPopulationUnder5: number

  campaignDays: number // only meaningful when dip === 'expand'; max day number seen in "Days"
}
