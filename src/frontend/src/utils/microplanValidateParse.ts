// Parses the real POST /dip/validator response (see api/client.ts::
// submitValidateDip) into a ValidateDipAnalysis. This does NOT re-implement
// mp_validator.py's validation logic — it reads the backend's own 3-sheet
// workbook and aggregates it for the page's cards/breakdowns/tables. See the
// top-of-file comment in types/microplanValidate.ts for why this page can
// trust the backend response directly, unlike Microplan · Combine DMP Files.

import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import type {
  DipReviewRow,
  WardReviewRow,
  TeamReviewRow,
  ValidateDipAnalysis,
  BreakdownSlice,
  LgaShortfall,
} from '../types/microplanValidate'

// --- generic sheet/column helpers --------------------------------------

function findSheetName(workbook: XLSX.WorkBook, keyword: string, exclude: string[] = []): string | undefined {
  return workbook.SheetNames.find((name) => {
    const lower = name.toLowerCase()
    return lower.includes(keyword) && !exclude.some((ex) => lower.includes(ex))
  })
}

// The backend writes sheets in dict order dip -> ward_review -> team_review
// (Python dicts preserve insertion order, and pd.ExcelWriter iterates in
// that order), so position [0, 1, 2] is a reliable fallback if sheet names
// ever drift from the current "Dip" / "Ward Review" / "Team Review" —
// exactly what happened with the sample DIP_Review.xlsx reviewed during
// design, which used "DIP" / "Ward" / "Team" instead.
function resolveThreeSheets(workbook: XLSX.WorkBook): { dip: string; ward: string; team: string } {
  const ward = findSheetName(workbook, 'ward')
  const team = findSheetName(workbook, 'team')
  const dip = findSheetName(workbook, 'dip') ?? workbook.SheetNames.find((n) => n !== ward && n !== team)

  if (dip && ward && team && dip !== ward && dip !== team && ward !== team) {
    return { dip, ward, team }
  }

  if (workbook.SheetNames.length !== 3) {
    throw new Error(
      `Expected 3 review sheets (Dip / Ward Review / Team Review) in the response, found ${workbook.SheetNames.length}: ${workbook.SheetNames.join(', ')}`,
    )
  }
  return { dip: workbook.SheetNames[0], ward: workbook.SheetNames[1], team: workbook.SheetNames[2] }
}

function col(row: Record<string, unknown>, ...candidates: string[]): unknown {
  const keys = Object.keys(row)
  for (const candidate of candidates) {
    const match = keys.find((k) => k.trim().toLowerCase() === candidate.toLowerCase())
    if (match !== undefined) return row[match]
  }
  return undefined
}

// The day-of-activity column has no fixed header — the backend detects it
// from the raw uploaded settlements file by keyword (see
// find_day_of_activity_col in toolbox/mlos/planfeld/microplan/dip_tools.py:
// `re.search(r"^.*?\bDay\b.*$", col, re.IGNORECASE)`), then reuses that SAME
// raw column name for both the Dip sheet's per-row day AND the Team
// Review sheet's per-team visit-days aggregate (mp_validator.py's
// TemplateFields.activity_days, written verbatim as the DataFrame column
// key in both validate_team_codes's enriched_dip and
// validate_team_activity_days). So neither sheet ever necessarily has a
// column literally named "Day of Activity" or "Visit Days" — this mirrors
// the backend's own keyword match instead of assuming either literal name,
// which is what left the Team Review table's Visit Days column blank
// whenever the source file's day column was named anything else (e.g. "Day
// of Activity" itself, "Activity Day", etc. all satisfy the backend's
// regex but not a hardcoded "Visit Days" lookup).
function colByDayKeyword(row: Record<string, unknown>): unknown {
  const keys = Object.keys(row)
  const match = keys.find((k) => /\bday\b/i.test(k))
  return match !== undefined ? row[match] : undefined
}

function str(v: unknown): string {
  if (v === undefined || v === null) return ''
  return String(v).trim()
}

function strOrNull(v: unknown): string | null {
  const s = str(v)
  return s === '' ? null : s
}

function num(v: unknown): number {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : 0
}

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// --- raw upload row count (for the ingest note only — no column parsing) --

export async function countRawSettlementRows(file: File): Promise<number> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) {
    const text = await file.text()
    const parsed = Papa.parse(text, { header: false, skipEmptyLines: true })
    // subtract 1 for the header row
    return Math.max(0, (parsed.data as unknown[]).length - 1)
  }
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]
  return Math.max(0, rows.filter((r) => r.length > 0).length - 1)
}

// --- main parse -----------------------------------------------------------

export async function parseValidateDipResponse(
  responseBlob: Blob,
  rawSettlementsFile: File,
): Promise<ValidateDipAnalysis> {
  const [rawSettlementRows, buffer] = await Promise.all([
    countRawSettlementRows(rawSettlementsFile),
    responseBlob.arrayBuffer(),
  ])

  const workbook = XLSX.read(buffer, { type: 'array' })
  const { dip: dipSheetName, ward: wardSheetName, team: teamSheetName } = resolveThreeSheets(workbook)

  const dipRaw = XLSX.utils.sheet_to_json(workbook.Sheets[dipSheetName]) as Record<string, unknown>[]
  const wardRaw = XLSX.utils.sheet_to_json(workbook.Sheets[wardSheetName]) as Record<string, unknown>[]
  const teamRaw = XLSX.utils.sheet_to_json(workbook.Sheets[teamSheetName]) as Record<string, unknown>[]

  const dipRows: DipReviewRow[] = dipRaw.map((r) => ({
    lga: str(col(r, 'LGA')),
    ward: str(col(r, 'Ward')),
    settlementId: str(col(r, 'Settlement ID')),
    settlementName: str(col(r, 'Settlement Name')),
    teamCode: str(col(r, 'Team Code')),
    dayOfActivity: str(colByDayKeyword(r) ?? col(r, 'Day of Activity')),
    teamCodeValidation: strOrNull(col(r, 'Team Code Validation')),
  }))

  const wardReviews: WardReviewRow[] = wardRaw.map((r) => ({
    lga: str(col(r, 'LGA')),
    ward: str(col(r, 'Ward')),
    settlements: num(col(r, 'Settlements')),
    teamAllocation: strOrNull(col(r, 'Team Allocation')),
    expectedTeams: numOrNull(col(r, 'Expected Teams')),
    dipTeams: num(col(r, 'DIP Teams')),
    teamCountValidation: strOrNull(col(r, 'Team Count Validation')),
    missingTeams: strOrNull(col(r, 'Missing Teams')),
  }))

  const teamReviews: TeamReviewRow[] = teamRaw.map((r) => ({
    lga: str(col(r, 'LGA')),
    ward: str(col(r, 'Ward')),
    teamCode: str(col(r, 'Team Code')),
    settlements: num(col(r, 'Settlements')),
    visitDays: str(colByDayKeyword(r) ?? col(r, 'Visit Days')),
    missingDays: strOrNull(col(r, 'Missing Days')),
  }))

  // --- ingest note -----------------------------------------------------
  const settlementIdCounts = new Map<string, number>()
  for (const row of dipRows) {
    settlementIdCounts.set(row.settlementId, (settlementIdCounts.get(row.settlementId) ?? 0) + 1)
  }
  const settlementsCarried = settlementIdCounts.size
  const settlementsSplitAcrossTeams = Array.from(settlementIdCounts.values()).filter((n) => n > 1).length
  const settlementsDropped = Math.max(0, rawSettlementRows - settlementsCarried)

  const wardsMatched = wardReviews.filter((w) => w.teamAllocation !== null).length
  const wardsUnmatched = wardReviews.length - wardsMatched

  const lgaSet = new Set(wardReviews.map((w) => w.lga))
  const wardPairSet = new Set(wardReviews.map((w) => `${w.lga}|${w.ward}`))
  const wardNameOnlySet = new Set(wardReviews.map((w) => w.ward))

  // --- headline findings -------------------------------------------------
  const shortfallWards = wardReviews.filter((w) => w.teamCountValidation !== null)
  const unaccountedTeams = shortfallWards.reduce((sum, w) => {
    const match = w.teamCountValidation?.match(/Missing (\d+) Teams?/)
    return sum + (match ? Number(match[1]) : 0)
  }, 0)
  const unaccountedTeamLgas = new Set(shortfallWards.map((w) => w.lga)).size

  const nonCompliantWards = wardReviews.filter((w) => w.missingTeams !== null)
  const nonCompliantTeamCodes = nonCompliantWards.reduce((sum, w) => {
    const codes = (w.missingTeams ?? '').split(',').map((c) => c.trim()).filter(Boolean)
    return sum + codes.length
  }, 0)

  const teamsMissingDays = teamReviews.filter((t) => t.missingDays !== null).length
  const teamsMissingDaysPct = teamReviews.length > 0 ? (teamsMissingDays / teamReviews.length) * 100 : 0

  const dayCounts: Record<'1' | '2' | '3' | '4', number> = { '1': 0, '2': 0, '3': 0, '4': 0 }
  for (const t of teamReviews) {
    if (!t.missingDays) continue
    for (const d of t.missingDays.split(',').map((x) => x.trim())) {
      if (d === '1' || d === '2' || d === '3' || d === '4') dayCounts[d] += 1
    }
  }
  const missingByDay = (['1', '2', '3', '4'] as const).map((day) => ({ day, count: dayCounts[day] }))

  const shortfallByLga = new Map<string, { teams: number; wards: number }>()
  for (const w of shortfallWards) {
    const match = w.teamCountValidation?.match(/Missing (\d+) Teams?/)
    const shortfall = match ? Number(match[1]) : 0
    const entry = shortfallByLga.get(w.lga) ?? { teams: 0, wards: 0 }
    entry.teams += shortfall
    entry.wards += 1
    shortfallByLga.set(w.lga, entry)
  }
  const unaccountedTeamsByLga: LgaShortfall[] = Array.from(shortfallByLga.entries())
    .map(([lga, v]) => ({ lga, teams: v.teams, wards: v.wards }))
    .sort((a, b) => b.teams - a.teams)

  return {
    dipRows,
    wardReviews,
    teamReviews,

    rawSettlementRows,
    settlementsCarried,
    settlementsDropped,
    settlementsSplitAcrossTeams,
    wardsMatched,
    wardsUnmatched,

    lgaCount: lgaSet.size,
    wardCount: wardPairSet.size,
    wardNameOnlyCount: wardNameOnlySet.size,
    fieldTeamCount: teamReviews.length,

    unaccountedTeams,
    unaccountedTeamWards: shortfallWards.length,
    unaccountedTeamLgas,
    nonCompliantTeamCodes,
    nonCompliantTeamCodeWards: nonCompliantWards.length,
    teamsMissingDays,
    teamsMissingDaysPct,

    missingByDay,
    unaccountedTeamsByLga,
  }
}

// Not currently used by cards, but handy for a future "Team Code Validation
// composition" panel — kept here rather than inline so it's easy to wire in.
export function teamCodeValidationBreakdown(dipRows: DipReviewRow[]): BreakdownSlice[] {
  const total = dipRows.length
  const flagged = dipRows.filter((r) => r.teamCodeValidation !== null).length
  const ok = total - flagged
  return [
    { label: 'OK', count: ok, pct: total ? (ok / total) * 100 : 0 },
    { label: 'Flagged', count: flagged, pct: total ? (flagged / total) * 100 : 0 },
  ]
}
