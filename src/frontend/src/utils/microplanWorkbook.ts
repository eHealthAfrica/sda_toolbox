// Builds the downloadable "combined_dmp.xlsx" client-side, in the verified
// two-sheet shape (Settlements, Special Places — column names/order matched
// against the sample output_example.xlsx exactly). See the top-of-file
// comment in types/microplan.ts for why this isn't just the
// /aggregator/dmp/combine response.
//
// "Expand Days into Day N columns" mirrors toolbox/mlos/planfeld/microplan/
// mp.py::populate_daily_implementation_plan exactly: for day 1..campaignDays,
// add a "Day N" column set to "Yes" when that day number appears in the
// settlement's Days string, blank otherwise.

import * as XLSX from 'xlsx'
import type { CombineAnalysis, DipExpansion } from '../types/microplan'

function dayFlags(days: string, campaignDays: number): Record<string, string> {
  const found = new Set(Array.from(days.matchAll(/\d/g)).map((m) => m[0]))
  const flags: Record<string, string> = {}
  for (let n = 1; n <= campaignDays; n++) {
    flags[`Day ${n}`] = found.has(String(n)) ? 'Yes' : ''
  }
  return flags
}

export function buildAndDownloadWorkbook(analysis: CombineAnalysis, dip: DipExpansion): void {
  const settlementRows = analysis.settlements.map((s) => ({
    'Source.Name': s.source,
    'Settlement GUID': s.settlementGuid,
    LGA: s.lga,
    Ward: s.ward,
    WardID: s.wardId,
    'Take off point': s.takeOffPoint,
    'Settlement Name': s.settlementName,
    'Settlement Habitation': s.habitation,
    'Settlement Accessibility': s.accessibility,
    'Settlement category': s.category,
    Population: s.population,
    Latitude: s.latitude,
    Longitude: s.longitude,
    Team: s.team,
    Days: s.days,
    ...(dip === 'expand' ? dayFlags(s.days, analysis.campaignDays) : {}),
  }))

  const specialPlaceRows = analysis.specialPlaces.map((sp) => ({
    Source: sp.source,
    LGA: sp.lga,
    Ward: sp.ward,
    'Special Place': sp.specialPlace,
    Type: sp.type,
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(settlementRows), 'Settlements')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(specialPlaceRows), 'Special Places')
  XLSX.writeFile(workbook, 'combined_dmp.xlsx')
}
