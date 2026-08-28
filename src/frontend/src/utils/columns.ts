// Client-side mirror of how the backend locates admin/geo columns, since the
// settlements CSV's column names are NOT fixed — they come from whatever the
// uploaded DIP file used. The real detection is fuzzy-matching
// (toolbox/mlos/mtools.py::get_admin_col, toolbox/spatial_mgr/geo_accessor.py)
// with score cutoffs and numeric/pattern checks we can't fully replicate
// without a fuzzy-match library. This is a pragmatic approximation: prefer an
// exact/near match, exclude obvious decoys (code/id/old columns), and fall
// back to the first plausible substring match.

const EXCLUDE_PATTERN = /(code|old|id)/i

function scoreColumn(column: string, keywords: string[]): number {
  const lower = column.toLowerCase().trim()
  for (const [i, kw] of keywords.entries()) {
    if (lower === kw) return 100 - i
    if (lower === kw + 's') return 95 - i
  }
  for (const [i, kw] of keywords.entries()) {
    if (lower.includes(kw)) return 60 - i
  }
  return 0
}

function findColumn(columns: string[], keywords: string[]): string | null {
  const candidates = columns
    .filter((c) => !EXCLUDE_PATTERN.test(c))
    .map((c) => ({ column: c, score: scoreColumn(c, keywords) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)

  return candidates.length > 0 ? candidates[0].column : null
}

export interface DetectedColumns {
  state: string | null
  lga: string | null
  ward: string | null
  settlement: string | null
  latitude: string | null
  longitude: string | null
  // Unlike the fields above, there's no backend fuzzy-matcher for a
  // population column to mirror (toolbox/triangulate/ — the REACH pipeline —
  // never reads or computes one; population handling only exists in the
  // separate MLoS QC pipeline's set_population/set_target fixups). This is
  // our own best-effort guess for REACH's "target population" cards, based on
  // the column names that pipeline uses (config.yaml's
  // ATTRIBUTE_COLUMNS.NUMERIC_COLUMNS / REMAPPERS.MP) — treat a match here as
  // a guess, not a guarantee, and always handle `null` (no population data
  // available) rather than assuming it's always found.
  population: string | null
  // Same caveat as population — no backend fuzzy-matcher to mirror, just a
  // best-effort guess based on the real sample export's own column name
  // ("Accessibility status"). Values arrive with inconsistent casing (see
  // utils/reachAggregate.ts::normalizeAccessibility), which is handled after
  // this column is found, not by the matcher itself.
  accessibility: string | null
}

export function detectColumns(columns: string[]): DetectedColumns {
  return {
    state: findColumn(columns, ['state']),
    lga: findColumn(columns, ['lga']),
    ward: findColumn(columns, ['ward']),
    settlement: findColumn(columns, ['settlement', 'site name', 'name']),
    latitude: findColumn(columns, ['latitude', 'lat', 'y']),
    longitude: findColumn(columns, ['longitude', 'long', 'lon', 'lng', 'x']),
    population: findColumn(columns, ['population', 'set_population', 'target_population', 'set_target', 'target']),
    accessibility: findColumn(columns, ['accessibility status', 'accessibility']),
  }
}

// Client-side mirror of two more backend column-detection calls used only by
// the DIP Generator page: toolbox/tools/filters.py::find_column(dataset,
// 'Team') and dip_tools.py::find_day_of_activity_col. Both are kept separate
// from detectColumns()/findColumn() above rather than folded in, because
// they genuinely work differently from the admin/geo matcher:
//
// - The real find_column() is a fuzzy string matcher (thefuzz/rapidfuzz's
//   process.extractBests, score_cutoff=90) with NO decoy-exclusion list —
//   unlike findColumn() above (which deliberately excludes any column
//   matching /code|old|id/i so "LGA Code" doesn't win over "LGA"), the real
//   Team column the backend expects to find is very often literally named
//   "Team Code" (see the real sample PDF's "Team Code" field, and
//   TemplateFields.team being fed straight into "unique_team_code"). Running
//   it through the code/old/id-excluding matcher would systematically miss
//   the real column, so this is a separate, non-excluding scorer.
// - find_day_of_activity_col() isn't a fuzzy match at all — it takes the
//   FIRST column (in column order) whose name matches the regex
//   /^.*?\bDay\b.*$/i, full stop. No scoring, no cutoff.
function scoreColumnNoExclude(column: string, keywords: string[]): number {
  const lower = column.toLowerCase().trim()
  for (const [i, kw] of keywords.entries()) {
    if (lower === kw) return 100 - i
    if (lower === kw + 's') return 95 - i
  }
  for (const [i, kw] of keywords.entries()) {
    if (lower.includes(kw)) return 60 - i
  }
  return 0
}

/**
 * Same no-decoy-exclusion matcher as findTeamColumn below, generalized —
 * mirrors toolbox/tools/filters.py::find_column's real behavior (fuzzy
 * match, no EXCLUDE_PATTERN filtering) for any column the backend locates
 * this way. Used directly by findTeamColumn and by the Compiler · Tracks
 * page's lat/lon/speed/timestamp matchers (tracks_manager/preprocess.py's
 * filter_valid_tracks calls the real find_column with 'lat', 'lon', and
 * 'speed mps'; tracks.py's combine_tracks calls it with 'gps timestamp' —
 * none of those column names would ever trip the code/old/id exclusion
 * findColumn() above applies, but using the same non-excluding matcher as
 * findTeamColumn keeps this consistent with how the backend actually reads
 * these columns rather than reusing the admin-column matcher by coincidence).
 */
export function findColumnNoExclude(columns: string[], keywords: string[]): string | null {
  const candidates = columns
    .map((c) => ({ column: c, score: scoreColumnNoExclude(c, keywords) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
  return candidates.length > 0 ? candidates[0].column : null
}

export function findTeamColumn(columns: string[]): string | null {
  return findColumnNoExclude(columns, ['team'])
}

export function findDayOfActivityColumn(columns: string[]): string | null {
  return columns.find((c) => /\bday\b/i.test(c)) ?? null
}

// tracks_manager/preprocess.py::filter_valid_tracks reads these three via
// find_column(tracks_df, col_name='lat' | 'lon' | 'speed mps'); tracks.py's
// combine_tracks separately reads 'gps timestamp' the same way. All four are
// genuine fuzzy matches (score_cutoff=90, no exclusion list) against
// whatever the uploaded track file's own column names are.
export function findLatitudeColumnStrict(columns: string[]): string | null {
  return findColumnNoExclude(columns, ['lat'])
}

export function findLongitudeColumnStrict(columns: string[]): string | null {
  return findColumnNoExclude(columns, ['lon'])
}

export function findSpeedColumn(columns: string[]): string | null {
  return findColumnNoExclude(columns, ['speed mps', 'speed'])
}

export function findGpsTimestampColumn(columns: string[]): string | null {
  return findColumnNoExclude(columns, ['gps timestamp', 'timestamp'])
}

export function findCumulativeColumn(columns: string[], analysisDay: number): string | null {
  const exact = `day_${analysisDay}_cumm`
  if (columns.includes(exact)) return exact
  // Fallback: same tolerant match the backend's detect_day_column uses —
  // any column containing the day number and "cumm".
  return (
    columns.find(
      (c) => c.toLowerCase().includes('cumm') && c.match(/\d+/)?.[0] === String(analysisDay),
    ) ?? null
  )
}

// Client-side mirror of toolbox/tools/filters.py::detect_number
// (`re.search(CONFIG['REGEX']['NUM_PATTERN'], text)`, where NUM_PATTERN is
// `\d+` in config.yaml — the first run of digits anywhere in the string).
// Used only to DEFAULT the Daily Report page's Cumulative-column dropdown
// once a Day column is picked (guessing at a "day_{N}_cumm"-shaped column
// via findCumulativeColumn above) — never sent to the backend itself.
// Deliberately null-safe, unlike the real detect_number: that one has no
// None-check and raises `TypeError: expected string or bytes-like object`
// when called with `campaign_day_col=None` (a cumulative-only Daily Report
// request) — see api/client.ts::submitDailyReport for exactly where that
// bites the real /reports/daily route.
export function extractDayNumber(text: string | null): number | null {
  if (!text) return null
  const match = text.match(/\d+/)
  return match ? parseInt(match[0], 10) : null
}

export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}
