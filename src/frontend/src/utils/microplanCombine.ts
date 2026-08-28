// Client-side parser for the Microplan "Combine DMP Files" upload — see the
// long comment at the top of types/microplan.ts for why this runs entirely
// in the browser instead of reading the /aggregator/dmp/combine response.
//
// Input shape (verified against the sample COMPRESSED.zip): a zip containing
// one .zip per LGA, each of which contains that LGA's ward-level CSVs
// (possibly nested under State/LGA subfolders — depth doesn't matter, we
// match by extension anywhere in the archive). Each ward CSV is actually TWO
// stacked tables: an 18-column settlement list, then — after a few
// whitespace-only separator rows — a "Special Place","Type" mini-table
// (school/mosque/market/church names) with no admin columns of its own; that
// context is inherited from the settlement rows above it in the same file.

import JSZip from 'jszip'
import Papa from 'papaparse'
import type {
  BreakdownSlice,
  CombineAnalysis,
  DipExpansion,
  LgaTeamCount,
  ManifestEntry,
  SettlementRecord,
  SpecialPlaceRecord,
  WardTeamCount,
} from '../types/microplan'

// Column indices in the settlement table's 18-column header — fixed across
// every ward CSV in the sample (verified: single distinct column-set across
// all 225 ward files).
const COL = {
  lga: 3,
  ward: 5,
  takeOffPoint: 6,
  guid: 7,
  name: 8,
  habitation: 9,
  accessibility: 10,
  category: 11,
  population: 12,
  longitude: 13,
  latitude: 14,
  team: 15,
  days: 16,
} as const

function cell(row: string[], idx: number): string {
  return (row[idx] ?? '').trim()
}

function rowIsBlank(row: string[]): boolean {
  return row.every((c) => !c || !c.trim())
}

// Splits one ward CSV's raw rows into (settlement rows, special place rows +
// inherited context), mirroring the two-stacked-tables structure exactly.
function splitWardCsv(rawRows: string[][]): { settlementRows: string[][]; specialRows: { name: string; type: string }[] } {
  let splitIdx: number | null = null
  let spHeaderIdx: number | null = null

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    const first0 = cell(row, 0)
    const first1 = cell(row, 1)
    if (first0 === 'Special Place' && first1 === 'Type') {
      spHeaderIdx = i
      break
    }
    const restPopulated = row.slice(2).some((c) => c && c.trim())
    if (!restPopulated && first0 === '' && splitIdx === null) {
      splitIdx = i
    }
  }

  const settleEnd = splitIdx ?? spHeaderIdx ?? rawRows.length
  const settlementRows = rawRows.slice(1, settleEnd).filter((row) => !rowIsBlank(row))

  const specialRows: { name: string; type: string }[] = []
  if (spHeaderIdx !== null) {
    for (const row of rawRows.slice(spHeaderIdx + 1)) {
      const name = cell(row, 0)
      if (name) specialRows.push({ name, type: cell(row, 1) })
    }
  }

  return { settlementRows, specialRows }
}

function toRecord(row: string[]): SettlementRecord {
  const lga = cell(row, COL.lga)
  const ward = cell(row, COL.ward)
  return {
    source: `${lga}—${ward}`,
    settlementGuid: cell(row, COL.guid),
    lga,
    ward,
    wardId: `${lga}_${ward}`,
    takeOffPoint: cell(row, COL.takeOffPoint),
    settlementName: cell(row, COL.name),
    habitation: cell(row, COL.habitation),
    accessibility: cell(row, COL.accessibility),
    category: cell(row, COL.category),
    population: Number(cell(row, COL.population)) || 0,
    longitude: Number(cell(row, COL.longitude)) || 0,
    latitude: Number(cell(row, COL.latitude)) || 0,
    team: cell(row, COL.team),
    days: cell(row, COL.days),
  }
}

function breakdown(values: string[]): BreakdownSlice[] {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const total = values.length || 1
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count)
}

function determineCampaignDays(daysValues: string[]): number {
  const seen = new Set<number>()
  for (const d of daysValues) {
    for (const m of d.matchAll(/\d/g)) seen.add(Number(m[0]))
  }
  return seen.size ? Math.max(...seen) : 0
}

export async function parseDmpArchive(zipFile: File, _dip: DipExpansion): Promise<CombineAnalysis> {
  const outer = await JSZip.loadAsync(await zipFile.arrayBuffer())

  const lgaArchiveNames = Object.keys(outer.files).filter(
    (name) => !outer.files[name].dir && name.toLowerCase().endsWith('.zip'),
  )

  const manifest: ManifestEntry[] = []
  const settlements: SettlementRecord[] = []
  const specialPlaces: SpecialPlaceRecord[] = []

  for (const archiveName of lgaArchiveNames) {
    const archiveData = await outer.files[archiveName].async('arraybuffer')
    const inner = await JSZip.loadAsync(archiveData)
    const csvNames = Object.keys(inner.files).filter(
      (name) => !inner.files[name].dir && name.toLowerCase().endsWith('.csv'),
    )

    if (csvNames.length === 0) {
      manifest.push({
        archiveName,
        status: 'skipped',
        reason:
          'Archive contains no ward CSVs directly (only nested .zip entries) — likely a re-zip of the whole folder rather than a single LGA, not this LGA\'s ward data.',
      })
      continue
    }

    for (const csvName of csvNames) {
      const text = await inner.files[csvName].async('string')
      const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false })
      const rawRows = parsed.data.filter((row): row is string[] => Array.isArray(row))
      if (rawRows.length < 2) continue

      const { settlementRows, specialRows } = splitWardCsv(rawRows)
      if (settlementRows.length === 0) continue

      const records = settlementRows.map(toRecord)
      settlements.push(...records)

      if (specialRows.length > 0) {
        const ctx = records[0]
        for (const sp of specialRows) {
          specialPlaces.push({ source: ctx.source, lga: ctx.lga, ward: ctx.ward, specialPlace: sp.name, type: sp.type })
        }
      }
    }

    manifest.push({ archiveName, status: 'processed', wardFilesRead: csvNames.length })
  }

  const lgas = new Set(settlements.map((s) => s.lga))
  const wardKeys = new Set(settlements.map((s) => s.wardId))

  // Team coverage: distinct Team values overall, and grouped LGA -> Ward.
  const teamSet = new Set(settlements.map((s) => s.team))
  const lgaWardTeams = new Map<string, Map<string, Set<string>>>()
  for (const s of settlements) {
    if (!lgaWardTeams.has(s.lga)) lgaWardTeams.set(s.lga, new Map())
    const wardMap = lgaWardTeams.get(s.lga)!
    if (!wardMap.has(s.ward)) wardMap.set(s.ward, new Set())
    wardMap.get(s.ward)!.add(s.team)
  }
  const teamsByLga: LgaTeamCount[] = Array.from(lgaWardTeams.entries())
    .map(([lga, wardMap]) => {
      const wards: WardTeamCount[] = Array.from(wardMap.entries())
        .map(([ward, teams]) => ({ ward, teams: teams.size }))
        .sort((a, b) => b.teams - a.teams)
      const teams = wards.reduce((sum, w) => sum + w.teams, 0)
      return { lga, teams, wards }
    })
    .sort((a, b) => b.teams - a.teams)

  // Population de-duplication: settlements split across 2+ field teams get
  // one row per team, each repeating the same population figure — verified
  // against the sample (90 settlements / 100 extra rows, population value
  // identical across every duplicate). Count each physical settlement once.
  const seenSettlementKeys = new Set<string>()
  let dedupedPopulation = 0
  let duplicateRowCount = 0
  let duplicateSettlementCount = 0
  const dupKeyCounts = new Map<string, number>()
  for (const s of settlements) {
    const key = `${s.lga}|${s.ward}|${s.settlementName}`
    dupKeyCounts.set(key, (dupKeyCounts.get(key) ?? 0) + 1)
  }
  for (const s of settlements) {
    const key = `${s.lga}|${s.ward}|${s.settlementName}`
    if (seenSettlementKeys.has(key)) {
      duplicateRowCount += 1
      continue
    }
    seenSettlementKeys.add(key)
    dedupedPopulation += s.population
  }
  for (const count of dupKeyCounts.values()) {
    if (count > 1) duplicateSettlementCount += 1
  }

  const rawPopulation = settlements.reduce((sum, s) => sum + s.population, 0)

  return {
    manifest,
    settlements,
    specialPlaces,
    lgaCount: lgas.size,
    wardCount: wardKeys.size,
    settlementCount: settlements.length,
    specialPlaceCount: specialPlaces.length,
    categoryBreakdown: breakdown(settlements.map((s) => s.category)),
    habitationBreakdown: breakdown(settlements.map((s) => s.habitation)),
    accessibilityBreakdown: breakdown(settlements.map((s) => s.accessibility)),
    specialPlaceTypeBreakdown: breakdown(specialPlaces.map((s) => s.type)),
    teamCount: teamSet.size,
    teamsByLga,
    rawPopulation,
    dedupedPopulation,
    duplicateSettlementCount,
    duplicateRowCount,
    targetPopulationUnder5: Math.round(dedupedPopulation * 0.2),
    campaignDays: determineCampaignDays(settlements.map((s) => s.days)),
  }
}
