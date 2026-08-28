import type { SettlementCoverageCategory, VisitationStatus } from '../types/h2h'
import type { ValidationStatus } from '../types/mlos'
import type { ExistsStatus } from '../types/uuidChecker'
import type { AccessibilityStatus, ReachVisitationStatus } from '../types/reach'

// Fallback for any category value that shows up in the data but isn't in a
// known enum's color map (unexpected/legacy string, or a cell that's just
// missing) — shared across features so an "I don't recognize this" swatch
// always looks the same.
export const UNKNOWN_COLOR = '#9aa5b1'

// Mirrors toolbox/configs/config.yaml -> REPORTING.VISITATION exactly. 'Not
// Visited' and 'Not Yet Visited' share the same pale-pink config color
// (#f4cccc) — an earlier version of this map gave 'Not Visited' a stronger
// red for legibility on an interactive map, but the campaign has since
// standardized both statuses to the same server-side color, so H2H/reporting
// charts stay pixel-consistent with the backend's own Plotly reports. A
// consumer that genuinely needs the two visually distinguishable (e.g.
// VisitationMap's point markers) should pair this color with a non-color
// encoding rather than reintroducing a divergent hex here.
export const VISITATION_COLORS: Record<VisitationStatus, string> = {
  Visited: '#38761d',
  'Not Yet Visited': '#f4cccc',
  'Not Visited': '#f4cccc',
}

export const VISITATION_ORDER: VisitationStatus[] = ['Visited', 'Not Yet Visited', 'Not Visited']

// Mirrors toolbox/configs/config.yaml -> REPORTING.VISITATION.Planned.
// 'Planned' isn't a VisitationStatus value itself (see types/h2h.ts — that
// type only has Visited/Not Yet Visited/Not Visited), just the shared color
// for "planned settlements" series (e.g. LgaBreakdownChart's "Planned
// settlements by LGA" bars), so it's a standalone constant rather than a 4th
// key in VISITATION_COLORS.
export const PLANNED_COLOR = '#4a86e8'

// A single run's day_{N}_cumm column never actually contains all three
// statuses at once: manage_mop_up() (toolbox/campaign/visitation_analysis.py
// + campaign_tools.py::update_dip_visitation) rewrites every 'Not Yet
// Visited' to 'Not Visited' when the run is flagged as a mop-up day, and
// leaves them as 'Not Yet Visited' otherwise. So a result is always Visited
// plus exactly one of the other two — never both. Cards/legends should show
// only the two statuses that can actually appear for the run that produced
// the data, based on the is_mop_up flag the form submitted.
export function getVisitationOrderFor(isMopUp: boolean): VisitationStatus[] {
  return isMopUp ? ['Visited', 'Not Visited'] : ['Visited', 'Not Yet Visited']
}

// Mirrors toolbox/configs/config.yaml -> REPORTING.COVERAGE exactly —
// toolbox/campaign/campaign_tools.py::classify_coverage buckets, on a single
// good -> critical ramp.
export const COVERAGE_COLORS: Record<SettlementCoverageCategory, string> = {
  'Fully Covered': '#38761d',
  'Partially Covered': '#6aa84f',
  'Poorly Covered': '#93c47d',
  'No Coverage': '#ea9999',
}

export const COVERAGE_ORDER: SettlementCoverageCategory[] = [
  'Fully Covered',
  'Partially Covered',
  'Poorly Covered',
  'No Coverage',
]

// Categorical palette for series that aren't a fixed status enum (e.g. LGA
// bars), matching the dataviz-skill categorical slot set.
export const CATEGORICAL_PALETTE = [
  '#4a86e8', '#38761d', '#fab219', '#8e44ad', '#16a596',
  '#d03b3b', '#f39c12', '#2c7fb8', '#6b5b95', '#c9622a',
]

// toolbox/mlos/validation/review/run_validate.py's validation_status —
// 'Validated' and 'Not Validated' sit on the same good/critical scale as
// coverage; 'Validation Ongoing' is in-progress (warning); 'Validated
// Unknown' (malformed/unreadable settlement name — is_invalid, set before QC
// even runs) is a distinct "couldn't assess" bucket, not a point on that
// scale, so it gets its own categorical color rather than reusing the
// unknown-value gray (which means something different: "value not in our
// known set" vs. this being a real, named business status).
export const VALIDATION_STATUS_COLORS: Record<ValidationStatus, string> = {
  Validated: '#0ca30c',
  'Validation Ongoing': '#fab219',
  'Validated Unknown': '#6b5b95',
  'Not Validated': '#d03b3b',
}

// toolbox/apps/db_access/uuid_checker.py's Exists enum — a plain found/not-
// found binary, so it sits on the same good/critical two-color scale as
// coverage rather than needing a third "unknown" bucket (an unrecognized
// entry never reaches this map — it's filtered client-side before the
// request goes out, see utils/uuidFile.ts).
export const UUID_EXISTS_COLORS: Record<ExistsStatus, string> = {
  EXISTS: '#0ca30c',
  'NOT EXISTS': '#d03b3b',
}

// toolbox/triangulate/triangulate.py's `status` column — same binary shape
// as UUID_EXISTS_COLORS above (no mop-up-dependent third state the way
// H2H's day_{N}_cumm has), and now shares the campaign's VISITATION color
// scheme directly (config.yaml -> REPORTING.VISITATION) rather than its own
// values, so "Visited"/"Not Visited" read identically wherever they appear
// across H2H and REACH.
export const REACH_VISITATION_COLORS: Record<ReachVisitationStatus, string> = {
  Visited: VISITATION_COLORS.Visited,
  'Not Visited': VISITATION_COLORS['Not Visited'],
}

// toolbox/triangulate/triangulate.py's `reach` column — the count of
// independent data sources (0-3 today: eTally/MST/GTS) that corroborated a
// settlement; `status` above is fully derived from it (reach===0 -> 'Not
// Visited', else 'Visited'). More corroboration is better, so this reuses
// the same good->critical four-step shape as COVERAGE_COLORS above rather
// than inventing a new ramp. Index 0 is reach=0 (critical/red) through
// index 3, reach=3 (good/green); getReachCountColor falls back to
// UNKNOWN_COLOR for any reach value beyond what's mapped here.
export const REACH_COUNT_COLORS: string[] = ['#d03b3b', '#fab219', '#8bc34a', '#0ca30c']

export function getReachCountColor(reach: number): string {
  return REACH_COUNT_COLORS[reach] ?? UNKNOWN_COLOR
}

// The uploaded file's own "Accessibility status" column — same good ->
// critical three-step shape as COVERAGE_COLORS above (fully accessible is
// the good end, inaccessible the critical end), reusing that exact ramp.
export const ACCESSIBILITY_COLORS: Record<AccessibilityStatus, string> = {
  'Fully Accessible': '#0ca30c',
  'Partially Accessible': '#fab219',
  Inaccessible: '#d03b3b',
}

export const ACCESSIBILITY_ORDER: AccessibilityStatus[] = ['Fully Accessible', 'Partially Accessible', 'Inaccessible']

// toolbox/campaign/contact_analysis.py's `contact` column — count of
// previous-campaign rounds a settlement was recorded 'Visited' in. Unlike
// `reach` above, this doesn't have a fixed 0-3 ceiling: the real max is
// however many round columns a given contact-analysis upload produced (see
// utils/contactAggregate.ts::detectRoundColumns), which varies by upload. A
// fixed step array can't cover an unknown range, so this interpolates
// continuously between the campaign's own coverage-ramp endpoints — critical
// (#ea9999, 0 contacts) to good (#38761d, contact === maxContact) — rather
// than picking a new ad hoc palette.
const CONTACT_CRITICAL_RGB: [number, number, number] = [234, 153, 153] // #ea9999
const CONTACT_GOOD_RGB: [number, number, number] = [56, 118, 29] // #38761d

function lerpChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t)
}

export function getContactCountColor(contact: number, maxContact: number): string {
  if (maxContact <= 0) return UNKNOWN_COLOR
  const t = Math.max(0, Math.min(1, contact / maxContact))
  const r = lerpChannel(CONTACT_CRITICAL_RGB[0], CONTACT_GOOD_RGB[0], t)
  const g = lerpChannel(CONTACT_CRITICAL_RGB[1], CONTACT_GOOD_RGB[1], t)
  const b = lerpChannel(CONTACT_CRITICAL_RGB[2], CONTACT_GOOD_RGB[2], t)
  return `rgb(${r}, ${g}, ${b})`
}
