import { parseFileRows } from './dipGeneratorParse'
import { detectColumns } from './columns'
import type { DetectedColumns } from './columns'
import { settlementKey, uniqueKeySet } from './targetAreaAggregate'
import type { TargetAreaRecord } from '../types/targetArea'

export interface SettlementReference {
  records: TargetAreaRecord[]
  columns: DetectedColumns
  /** Same de-duplicated settlement-key set parseSettlementKeySet used to return on its own — kept here so callers don't need to re-derive it. */
  keySet: Set<string>
}

// Reads an uploaded MLoS/planned-list file client-side (before, or in
// parallel with, the request going out) to get a TRUE reference for
// settlements — same "parse the raw upload for ground truth" pattern
// already used elsewhere in this app (compilerDisaggregateParse.ts::
// analyzeOriginalMlos, dipGeneratorParse.ts::buildIngestNote,
// compilerTracksOriginalCount.ts). This is what lets TargetAreaPage answer
// "settlements missing a voronoi TA" against the settlements actually
// uploaded, not just against whatever gridded_ta happened to return — a
// settlement absent from BOTH voronoi and gridded would be invisible to a
// voronoi-vs-gridded-only comparison. Returning the raw records + detected
// columns (not just the flat key set this used to return alone, as
// parseSettlementKeySet) also lets TargetAreaPage group the master list by
// State/LGA/Ward for TargetAreaGeoBreakdownTable, without parsing the same
// file a second time.
//
// Returns null (rather than throwing) on a read/parse failure so a bad or
// unusual planned-list file doesn't take down the whole results view — the
// caller shows an honest "couldn't be read" state instead of a silent 0.
export async function parseSettlementReference(file: File): Promise<SettlementReference | null> {
  try {
    const { headers, rows } = await parseFileRows(file)
    const columns = detectColumns(headers)
    const records = rows as TargetAreaRecord[]
    const keySet = uniqueKeySet(records, (r) => settlementKey(r, columns.state, columns.lga, columns.ward, columns.settlement))
    return { records, columns, keySet }
  } catch {
    return null
  }
}
