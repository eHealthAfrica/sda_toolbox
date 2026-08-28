// Mirrors toolbox/models/__init__.py::State — the enum *values* (not the
// Python member names) are what the backend's Query param expects, e.g.
// `state_names=Akwa%20Ibom`, `state_names=Cross%20River`.
export const STATE_OPTIONS = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT',
  'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi',
  'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
  'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const

export type StateName = (typeof STATE_OPTIONS)[number]

// Mirrors toolbox/models/__init__.py::Extensions
export const TRACKS_EXTENSION_OPTIONS = [
  { value: 'csv', label: 'CSV' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'kml', label: 'KML' },
  { value: 'kmz', label: 'KMZ' },
  { value: 'gpkg', label: 'GeoPackage (.gpkg)' },
] as const

// Mirrors toolbox/campaign/campaign_tools.py::classify_coverage — the
// 'Settlement Coverage' column the backend derives from the `Coverage` ratio.
export const SETTLEMENT_COVERAGE_CATEGORIES = [
  'Fully Covered',
  'Partially Covered',
  'Poorly Covered',
  'No Coverage',
] as const

export type SettlementCoverageCategory = (typeof SETTLEMENT_COVERAGE_CATEGORIES)[number]

// Mirrors the visitation status values written into the `day_{N}_cumm`
// column (toolbox/campaign/visitation_analysis.py + campaign_tools.py).
// 'Not Visited' only appears when the analysis day is flagged as a mop-up
// day — otherwise unvisited settlements are 'Not Yet Visited'.
export const VISITATION_STATUSES = ['Visited', 'Not Yet Visited', 'Not Visited'] as const
export type VisitationStatus = (typeof VISITATION_STATUSES)[number]

export interface TrackingFormInput {
  tracksFile: File | null
  dipFile: File | null
  analysisDay: number
  isMopUp: boolean
  tracksExtension: string | null
  generateReport: boolean
}

// One row of the settlements CSV returned by POST /tracking/gridded. Column
// names beyond the ones the backend always writes (Coverage, Settlement
// Coverage, Time Spent, day_{N}, day_{N}_cumm) are NOT fixed — they come
// from whatever the uploaded DIP file used, and the backend itself detects
// them by fuzzy-matching column names (see toolbox/mlos/mtools.py and
// toolbox/spatial_mgr/geo_accessor.py). We do the same client-side in
// src/utils/columns.ts rather than assuming literal names.
export type SettlementRecord = Record<string, string | number | null>

export interface ParsedResult {
  records: SettlementRecord[]
  columns: string[]
  sourceFilename: string
  analysisDay: number
}
