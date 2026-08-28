import { parseFileRows } from './dipGeneratorParse'
import { detectColumns } from './columns'
import { settlementKey, uniqueKeySet } from './targetAreaAggregate'
import type { TargetAreaRecord } from '../types/targetArea'

// Reads an uploaded MLoS/planned-list file client-side (before, or in
// parallel with, the request going out) to get a TRUE reference set of
// settlements — same "parse the raw upload for ground truth" pattern
// already used elsewhere in this app (compilerDisaggregateParse.ts::
// analyzeOriginalMlos, dipGeneratorParse.ts::buildIngestNote,
// compilerTracksOriginalCount.ts). This is what lets TargetAreaPage answer
// "settlements missing a voronoi TA" against the settlements actually
// uploaded, not just against whatever gridded_ta happened to return — a
// settlement absent from BOTH voronoi and gridded would be invisible to a
// voronoi-vs-gridded-only comparison.
//
// Returns null (rather than throwing) on a read/parse failure so a bad or
// unusual planned-list file doesn't take down the whole results view — the
// caller shows an honest "couldn't be read" state instead of a silent 0.
export async function parseSettlementKeySet(file: File): Promise<Set<string> | null> {
  try {
    const { headers, rows } = await parseFileRows(file)
    const columns = detectColumns(headers)
    return uniqueKeySet(rows as TargetAreaRecord[], (r) =>
      settlementKey(r, columns.state, columns.lga, columns.ward, columns.settlement),
    )
  } catch {
    return null
  }
}
