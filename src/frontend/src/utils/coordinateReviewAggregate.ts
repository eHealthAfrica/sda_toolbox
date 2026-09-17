import type { CoordinateReviewRecord, RowAgreement, SourceEvidence } from '../types/coordinateReview'
import type { DetectedColumns } from './columns'
import { toNumber } from './columns'

// How close two SOURCES' own coordinates must land to each other to count
// as "agreeing" — and, separately, how close their agreed point must land
// to the ORIGINAL baseline coordinate to call the original "consistent"
// rather than flag it for review. A fixed constant, not a user-facing
// slider: this is purely a frontend judgment call layered on top of the
// backend's data (the backend has no concept of source-to-source agreement
// at all — see types/coordinateReview.ts), and it was deliberately removed
// from the page so end users can't tune it. Revisit this number here if the
// analysts' actual field experience says 120m is too tight or too loose.
export const AGREEMENT_RADIUS_M = 120

const EARTH_RADIUS_M = 6371000

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

// pandas writes Python booleans as the literal strings "True"/"False" in
// to_csv output — PapaParse's dynamicTyping does not reliably normalize
// that capitalization, so this is handled explicitly rather than trusting
// dynamicTyping (see parseResult.ts::parseCoordinateReviewCsv, which parses
// this result with dynamicTyping off for the same reason).
export function toBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === null || value === undefined || value === '') return null
  const s = String(value).trim().toLowerCase()
  if (s === 'true') return true
  if (s === 'false') return false
  return null
}

const SOURCE_SUFFIXES = ['_similarity', '_latitude', '_longitude', '_distance', '_grid3', '_near_tracks'] as const

// Detects source names purely from the header — one per sheet in the
// uploaded `sources` workbook, in column order. `_similarity` is the one
// suffix guaranteed to be unique to a source group (baseline files never
// carry a bare "..._similarity" column), so it's the anchor; the other five
// suffixes for that same prefix are assumed present since coord_review.py
// always writes all six together per source.
export function detectSourceNames(columns: string[]): string[] {
  const names: string[] = []
  for (const col of columns) {
    if (col.endsWith('_similarity')) {
      const name = col.slice(0, -'_similarity'.length)
      if (name && !names.includes(name)) names.push(name)
    }
  }
  return names
}

// Every column that isn't part of a detected source's 6-column group — the
// baseline settlement's own columns, in their original order, whatever they
// happen to be named (see CoordinateReviewRecord's comment).
export function baselineColumns(columns: string[], sourceNames: string[]): string[] {
  const sourceCols = new Set<string>()
  sourceNames.forEach((name) => SOURCE_SUFFIXES.forEach((suffix) => sourceCols.add(`${name}${suffix}`)))
  return columns.filter((c) => !sourceCols.has(c))
}

// null when this source didn't match the row at all (blank similarity) —
// distinguished from "matched but missing coordinates", which is treated
// the same way (null) since there's nothing usable to plot or cluster with
// either way.
export function getSourceEvidence(record: CoordinateReviewRecord, source: string): SourceEvidence | null {
  const similarity = toNumber(record[`${source}_similarity`] as string | number | null)
  if (similarity === null) return null
  const latitude = toNumber(record[`${source}_latitude`] as string | number | null)
  const longitude = toNumber(record[`${source}_longitude`] as string | number | null)
  if (latitude === null || longitude === null) return null
  const distance = toNumber(record[`${source}_distance`] as string | number | null) ?? 0
  return {
    similarity,
    latitude,
    longitude,
    distance,
    grid3: toBool(record[`${source}_grid3`]) ?? false,
    near_tracks: toBool(record[`${source}_near_tracks`]) ?? false,
  }
}

// The core judgment call this tool exists for: given every source that
// matched this settlement, do two or more of THEM agree with each other
// (regardless of whether they agree with the original point)? If so, is
// that agreed-upon location basically where the original already sits
// ('consistent'), or somewhere else worth a human looking at ('review')?
// 'none' means no two sources agree with each other at all — there's no
// alternative candidate to weigh, so there's nothing actionable here either
// way.
export function analyzeRow(
  record: CoordinateReviewRecord,
  sourceNames: string[],
  baselineLatCol: string | null,
  baselineLonCol: string | null,
): RowAgreement {
  const baseLat = baselineLatCol ? toNumber(record[baselineLatCol] as string | number | null) : null
  const baseLon = baselineLonCol ? toNumber(record[baselineLonCol] as string | number | null) : null

  const matched = sourceNames
    .map((name) => ({ name, evidence: getSourceEvidence(record, name) }))
    .filter((s): s is { name: string; evidence: SourceEvidence } => s.evidence !== null)

  let bestCluster: string[] = []
  for (let i = 0; i < matched.length; i++) {
    for (let j = i + 1; j < matched.length; j++) {
      const a = matched[i].evidence
      const b = matched[j].evidence
      const d = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude)
      if (d > AGREEMENT_RADIUS_M) continue
      const clusterSet = new Set([matched[i].name, matched[j].name])
      matched.forEach(({ name, evidence }) => {
        if (clusterSet.has(name)) return
        const okAll = [...clusterSet].every((m) => {
          const mEv = matched.find((s) => s.name === m)!.evidence
          return haversineMeters(evidence.latitude, evidence.longitude, mEv.latitude, mEv.longitude) <= AGREEMENT_RADIUS_M
        })
        if (okAll) clusterSet.add(name)
      })
      if (clusterSet.size > bestCluster.length) bestCluster = [...clusterSet]
    }
  }

  if (!bestCluster.length) {
    return { status: 'none', cluster: [], centroid: null, distanceFromBaseline: null }
  }

  const clusterEvidence = bestCluster.map((name) => matched.find((s) => s.name === name)!.evidence)
  const centLat = clusterEvidence.reduce((s, e) => s + e.latitude, 0) / clusterEvidence.length
  const centLon = clusterEvidence.reduce((s, e) => s + e.longitude, 0) / clusterEvidence.length
  const centroid = { latitude: centLat, longitude: centLon }

  if (baseLat === null || baseLon === null) {
    // No usable baseline coordinate to compare against — treat as needing a
    // human look rather than silently calling it consistent.
    return { status: 'review', cluster: bestCluster, centroid, distanceFromBaseline: null }
  }

  const distanceFromBaseline = haversineMeters(baseLat, baseLon, centLat, centLon)
  const status: RowAgreement['status'] = distanceFromBaseline <= AGREEMENT_RADIUS_M ? 'consistent' : 'review'
  return { status, cluster: bestCluster, centroid, distanceFromBaseline }
}

export interface GeographyCoverage {
  states: number
  lgas: number
  wards: number
  settlements: number
}

export function computeGeographyCoverage(records: CoordinateReviewRecord[], columns: DetectedColumns): GeographyCoverage {
  const states = new Set<string>()
  const lgas = new Set<string>()
  const wards = new Set<string>()
  const settlements = new Set<string>()
  for (const r of records) {
    const state = columns.state ? r[columns.state] : null
    const lga = columns.lga ? r[columns.lga] : null
    const ward = columns.ward ? r[columns.ward] : null
    const settlement = columns.settlement ? r[columns.settlement] : null
    if (state) states.add(String(state))
    if (state && lga) lgas.add(`${state}|${lga}`)
    if (state && lga && ward) wards.add(`${state}|${lga}|${ward}`)
    if (state && lga && ward && settlement) settlements.add(`${state}|${lga}|${ward}|${settlement}`)
  }
  return { states: states.size, lgas: lgas.size, wards: wards.size, settlements: settlements.size }
}

export interface AgreementSummary {
  total: number
  review: number
  consistent: number
  none: number
}

export function computeAgreementSummary(rows: RowAgreement[]): AgreementSummary {
  return {
    total: rows.length,
    review: rows.filter((r) => r.status === 'review').length,
    consistent: rows.filter((r) => r.status === 'consistent').length,
    none: rows.filter((r) => r.status === 'none').length,
  }
}

export interface SourceStats {
  source: string
  matchRate: number
  avgDistance: number | null
  grid3Rate: number | null
  tracksRate: number | null
}

// Per-source context shown as supporting evidence, not the primary signal —
// see the per-source panel's own note in the page. avgDistance here is
// still baseline-to-source (the backend's own `distance` column), not the
// source-to-source agreement distance the recommendation is based on.
export function computeSourceStats(records: CoordinateReviewRecord[], source: string): SourceStats {
  const evs = records.map((r) => getSourceEvidence(r, source)).filter((e): e is SourceEvidence => e !== null)
  const matchRate = records.length ? Math.round((evs.length / records.length) * 100) : 0
  const avgDistance = evs.length ? Math.round(evs.reduce((s, e) => s + e.distance, 0) / evs.length) : null
  const grid3Rate = evs.length ? Math.round((evs.filter((e) => e.grid3).length / evs.length) * 100) : null
  const tracksRate = evs.length ? Math.round((evs.filter((e) => e.near_tracks).length / evs.length) * 100) : null
  return { source, matchRate, avgDistance, grid3Rate, tracksRate }
}

export function uniqueColumnValues(records: CoordinateReviewRecord[], column: string | null): string[] {
  if (!column) return []
  const values = new Set<string>()
  for (const r of records) {
    const raw = r[column]
    if (raw !== null && raw !== undefined && raw !== '') values.add(String(raw).trim())
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

export function formatMeters(distance: number | null): string {
  if (distance === null || distance === undefined) return '—'
  if (distance < 1000) return `${Math.round(distance)} m`
  return `${(distance / 1000).toFixed(1)} km`
}

export interface AgreementGroupBreakdownEntry {
  group: string
  review: number
  consistent: number
  none: number
  total: number
}

// Per-group (state/LGA/ward, whichever the current drill level is) stacked
// breakdown across the three recommendation outcomes — the coordinate-review
// analogue of duplicateCheckerAggregate.ts::computeDuplicateGroupBreakdown.
// Takes already-computed {record, analysis} pairs (from analyzeRow) rather
// than recomputing the analysis itself, since the page already has to do
// that for the results table and summary cards — no need to run the
// source-agreement search twice over the same rows.
export function computeAgreementGroupBreakdown(
  rows: { record: CoordinateReviewRecord; analysis: RowAgreement }[],
  groupColumn: string | null,
): AgreementGroupBreakdownEntry[] {
  const byGroup = new Map<string, AgreementGroupBreakdownEntry>()
  for (const { record, analysis } of rows) {
    const raw = groupColumn ? record[groupColumn] : null
    if (raw === null || raw === undefined || raw === '') continue
    const group = String(raw).trim()
    if (!byGroup.has(group)) byGroup.set(group, { group, review: 0, consistent: 0, none: 0, total: 0 })
    const entry = byGroup.get(group)!
    entry.total += 1
    if (analysis.status === 'review') entry.review += 1
    else if (analysis.status === 'consistent') entry.consistent += 1
    else entry.none += 1
  }
  return Array.from(byGroup.values()).sort((a, b) => b.total - a.total)
}
