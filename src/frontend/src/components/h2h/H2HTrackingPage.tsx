import { useMemo, useState } from 'react'
import { ApiError, fetchH2HArchive, submitH2HTracking } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { parseH2HCsv } from '../../api/parseResult'
import type { ParsedResult, SettlementCoverageCategory, TrackingFormInput, VisitationStatus } from '../../types/h2h'
import { detectColumns, findCumulativeColumn } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import { getVisitationOrderFor } from '../../utils/colors'
import {
  buildMapPoints,
  computeCoverageCounts,
  computeStateCoverage,
  computeStateVisitation,
  computeVisitationCounts,
  countUniqueValues,
  matchesColumnValue,
  uniqueColumnValues,
} from '../../utils/aggregate'
import type { CountEntry, MapPoint, StateCoverageEntry, StateVisitationEntry } from '../../utils/aggregate'
import type { SettlementRecord } from '../../types/h2h'
import TrackingForm from './TrackingForm'
import SummaryCards from './SummaryCards'
import CoverageCards from './CoverageCards'
import VisitationCards from './VisitationCards'
import VisitationMap from './VisitationMap'
import StateCoverageChart from './StateCoverageChart'
import StateVisitationChart from './StateVisitationChart'
import SettlementListTable from './SettlementListTable'
import TabbedPanel from '../common/TabbedPanel'

// Discriminated on `error` so downstream `if (analysis.error)` / `!analysis.error`
// checks narrow to the right shape without needing `as const` on the returns below
// (an `as const` on a bare `null` literal isn't valid TS — this sidesteps that).
// The per-state/LGA/ward breakdown and the summary/coverage/visitation counts
// used to live here too, computed once from the full record set — they've
// moved into the drillData memo below since they now need to be recomputed
// per drill level/scope instead of just once per run.
type AnalysisResult =
  | { error: string }
  | {
      error: null
      cumColumn: string
      columns: DetectedColumns
      mapPoints: MapPoint[]
      // The two statuses that can actually appear in this run's day_{N}_cumm
      // column — see getVisitationOrderFor. Never all three at once.
      activeVisitationOrder: VisitationStatus[]
      records: SettlementRecord[]
    }

// One category filter can be active at a time — set by clicking a
// coverage/visitation card, or a segment on either breakdown chart. All
// views below (map, table) read off the same selection; picking a new one
// replaces whichever was active, matching MlosQcPage's filter convention.
// This is layered ON TOP OF the drill scope (drillState/drillLga below), not
// a replacement for it — 'groupCoverage'/'groupVisitation' carry a `level`
// so a segment clicked on a by-LGA or by-ward chart filters by the right
// column instead of always assuming "state".
type DrillLevel = 'state' | 'lga' | 'ward'

type H2HFilter =
  | { kind: 'coverage'; category: SettlementCoverageCategory }
  | { kind: 'visitation'; status: VisitationStatus }
  | { kind: 'groupCoverage'; level: DrillLevel; value: string; category: SettlementCoverageCategory }
  | { kind: 'groupVisitation'; level: DrillLevel; value: string; status: VisitationStatus }

// Everything that depends on the current drill scope (drillState/drillLga)
// rather than just on the run's raw results — the breakdown charts' data
// (by state, or drilled to that state's LGAs, or that LGA's wards), the
// scoped record/map-point sets the category filter and map/table further
// narrow, and the summary/coverage/visitation card counts, which should
// read as "for the current selection" rather than always "for the whole
// run" once a state or LGA is picked.
interface DrillData {
  groupLevel: DrillLevel
  groupColumn: string | null
  scopedRecords: SettlementRecord[]
  scopedMapPoints: MapPoint[]
  groupCoverage: StateCoverageEntry[]
  groupVisitation: StateVisitationEntry[]
  visitationCounts: CountEntry<VisitationStatus>[]
  coverageCounts: CountEntry<SettlementCoverageCategory>[]
  totalStates: number
  totalLgas: number
  totalWards: number
  totalSettlements: number
}

export default function H2HTrackingPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedResult | null>(null)
  const [mopUp, setMopUp] = useState(false)
  // Defaults to the table view rather than the map — same convention as
  // every other page in the app that shows a map and a table for the same
  // records (the map is still one click away via the tab).
  const [settlementView, setSettlementView] = useState<'map' | 'list'>('list')
  const [filter, setFilter] = useState<H2HFilter | null>(null)
  // Selecting a state (in the settlement list table's State filter) drills
  // the two breakdown charts and the summary/coverage/visitation cards down
  // to that state's LGAs; additionally selecting an LGA drills them further,
  // to that LGA's wards. See drillData below.
  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  // The exact CSV bytes POST /tracking/gridded returned — kept as-is (not
  // regenerated from the parsed/reformatted records) so "Download CSV" hands
  // back precisely what the backend produced. Always available the instant
  // results are, unlike the ZIP below — no extra request needed, since this
  // is the same response body parseH2HCsv already read.
  const [csvBlob, setCsvBlob] = useState<Blob | null>(null)
  // Identifies this run's cached data on the backend so the full ZIP
  // (settlements CSV + tracks GeoPackage + optional reports) can be built
  // and fetched on demand — see api/client.ts::fetchH2HArchive. Unlike the
  // parsed results, the ZIP itself is genuinely NOT ready yet when this page
  // gets its results (that's the whole point of the split — the tracks
  // GeoPackage is the slow part and no longer blocks getting here), so
  // there's nothing to eagerly hold onto; only a click on the download
  // button below actually asks the backend to build it.
  const [archiveJobId, setArchiveJobId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: TrackingFormInput) {
    setSubmitting(true)
    setError(null)
    setMopUp(input.isMopUp)
    setFilter(null)
    setDrillState(null)
    setDrillLga(null)
    setCsvBlob(null)
    setArchiveJobId(null)
    setDownloadError(null)
    const jobId = startJob('h2h', input.tracksFile?.name ?? 'H2H tracking run')
    try {
      const { csvBlob: newCsvBlob, jobId: newArchiveJobId } = await submitH2HTracking(input)
      const parsed = await parseH2HCsv(newCsvBlob, input.analysisDay, input.dipFile?.name ?? 'settlements.csv')
      setResult(parsed)
      setCsvBlob(newCsvBlob)
      setArchiveJobId(newArchiveJobId)
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText =
          typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while running the analysis.')
      }
      setResult(null)
      setCsvBlob(null)
      setArchiveJobId(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  // CSV filename mirrors the backend's own convention for it — see
  // h2h_validation.py's Content-Disposition on the fast response
  // ({dip_file basename}.csv) — derived here instead of read off the
  // response so no extra CORS-exposed header is needed just for this.
  function handleDownloadCsv() {
    if (!csvBlob) return
    const baseName = (result?.sourceFilename ?? 'settlements').replace(/\.[^./]+$/, '')
    const url = URL.createObjectURL(csvBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${baseName}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Fetches the full ZIP only when actually asked for — see archiveJobId's
  // comment above. Builds a throwaway object URL, clicks a hidden link to
  // trigger the browser's normal download prompt, then revokes it; nothing
  // is kept in state afterward. The backend cache entry behind archiveJobId
  // is consumed by a successful fetch, so a stale id is cleared here too —
  // re-running the analysis is what gets you a fresh one.
  async function handleDownloadZip() {
    if (!archiveJobId) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const zipBlob = await fetchH2HArchive(archiveJobId)
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `h2h_outputs_day${result?.analysisDay ?? ''}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setDownloadError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else {
        setDownloadError('Could not prepare the download — try running the analysis again.')
      }
    } finally {
      setArchiveJobId(null)
      setDownloading(false)
    }
  }

  const analysis = useMemo<AnalysisResult | null>(() => {
    if (!result) return null

    const columns = detectColumns(result.columns)
    const cumColumn = findCumulativeColumn(result.columns, result.analysisDay)

    if (!cumColumn) {
      return { error: `Could not find a "day_${result.analysisDay}_cumm" column in the result.` }
    }

    const mapPoints =
      columns.latitude && columns.longitude
        ? buildMapPoints(
            result.records,
            columns.latitude,
            columns.longitude,
            cumColumn,
            columns.settlement,
            columns.lga,
            columns.ward,
            columns.state,
          )
        : []

    const activeVisitationOrder = getVisitationOrderFor(mopUp)

    return {
      error: null,
      cumColumn,
      columns,
      mapPoints,
      activeVisitationOrder,
      records: result.records,
    }
  }, [result, mopUp])

  // State/LGA options for the settlement list table's drill selects, always
  // built from the FULL result (not the current drill scope) so every state
  // stays pickable regardless of what's currently selected — LGA options are
  // narrowed to the selected state, same cascading convention as
  // PostImplementationChartTable.
  const stateOptions = useMemo(() => {
    if (!analysis || analysis.error !== null || !analysis.columns.state) return []
    return uniqueColumnValues(analysis.records, analysis.columns.state)
  }, [analysis])

  const lgaOptions = useMemo(() => {
    if (!analysis || analysis.error !== null || !analysis.columns.lga) return []
    const scope = drillState
      ? analysis.records.filter((r) => matchesColumnValue(r, analysis.columns.state, drillState))
      : analysis.records
    return uniqueColumnValues(scope, analysis.columns.lga)
  }, [analysis, drillState])

  const drillData = useMemo<DrillData | null>(() => {
    if (!analysis || analysis.error !== null) return null
    const { columns, records, mapPoints, cumColumn, activeVisitationOrder } = analysis

    const groupLevel: DrillLevel = drillLga ? 'ward' : drillState ? 'lga' : 'state'
    const groupColumn = groupLevel === 'state' ? columns.state : groupLevel === 'lga' ? columns.lga : columns.ward

    let scopedRecords = records
    if (drillState) scopedRecords = scopedRecords.filter((r) => matchesColumnValue(r, columns.state, drillState))
    if (drillLga) scopedRecords = scopedRecords.filter((r) => matchesColumnValue(r, columns.lga, drillLga))

    let scopedMapPoints = mapPoints
    if (drillState) scopedMapPoints = scopedMapPoints.filter((p) => p.state === drillState)
    if (drillLga) scopedMapPoints = scopedMapPoints.filter((p) => p.lga === drillLga)

    return {
      groupLevel,
      groupColumn,
      scopedRecords,
      scopedMapPoints,
      groupCoverage: groupColumn ? computeStateCoverage(scopedRecords, groupColumn) : [],
      groupVisitation: groupColumn ? computeStateVisitation(scopedRecords, groupColumn, cumColumn) : [],
      visitationCounts: computeVisitationCounts(scopedRecords, cumColumn, activeVisitationOrder),
      coverageCounts: computeCoverageCounts(scopedRecords),
      totalStates: columns.state ? countUniqueValues(scopedRecords, columns.state) : 0,
      totalLgas: columns.lga ? countUniqueValues(scopedRecords, columns.lga) : 0,
      totalWards: columns.ward ? countUniqueValues(scopedRecords, columns.ward) : 0,
      totalSettlements: scopedRecords.length,
    }
  }, [analysis, drillState, drillLga])

  const filteredRecords = useMemo(() => {
    if (!analysis || analysis.error !== null || !drillData) return []
    const base = drillData.scopedRecords
    if (!filter) return base
    const { columns, cumColumn } = analysis
    const groupColumnFor = (level: DrillLevel) =>
      level === 'state' ? columns.state : level === 'lga' ? columns.lga : columns.ward
    switch (filter.kind) {
      case 'coverage':
        return base.filter((r) => r['Settlement Coverage'] === filter.category)
      case 'visitation':
        return base.filter((r) => r[cumColumn] === filter.status)
      case 'groupCoverage':
        return base.filter(
          (r) => matchesColumnValue(r, groupColumnFor(filter.level), filter.value) && r['Settlement Coverage'] === filter.category,
        )
      case 'groupVisitation':
        return base.filter(
          (r) => matchesColumnValue(r, groupColumnFor(filter.level), filter.value) && r[cumColumn] === filter.status,
        )
      default:
        return base
    }
  }, [analysis, drillData, filter])

  const filteredMapPoints = useMemo(() => {
    if (!analysis || analysis.error !== null || !drillData) return []
    const base = drillData.scopedMapPoints
    if (!filter) return base
    // Explicit return type (not `as const` on the ternary itself — TS1355:
    // a const assertion can't wrap a conditional expression, only a literal)
    // to keep this narrowed to MapPoint's own key names for the p[...] index
    // below, rather than widening to `string`.
    const fieldFor = (level: DrillLevel): 'state' | 'lga' | 'ward' =>
      level === 'state' ? 'state' : level === 'lga' ? 'lga' : 'ward'
    switch (filter.kind) {
      case 'coverage':
        return base.filter((p) => p.coverage === filter.category)
      case 'visitation':
        return base.filter((p) => p.status === filter.status)
      case 'groupCoverage':
        return base.filter((p) => p[fieldFor(filter.level)] === filter.value && p.coverage === filter.category)
      case 'groupVisitation':
        return base.filter((p) => p[fieldFor(filter.level)] === filter.value && p.status === filter.status)
      default:
        return base
    }
  }, [analysis, drillData, filter])

  const filterDescription = useMemo(() => {
    if (!filter) return null
    const levelLabel = (level: DrillLevel) => (level === 'state' ? 'state' : level === 'lga' ? 'LGA' : 'ward')
    switch (filter.kind) {
      case 'coverage':
        return `coverage: ${filter.category}`
      case 'visitation':
        return `visitation: ${filter.status}`
      case 'groupCoverage':
        return `${levelLabel(filter.level)}: ${filter.value} · coverage: ${filter.category}`
      case 'groupVisitation':
        return `${levelLabel(filter.level)}: ${filter.value} · visitation: ${filter.status}`
      default:
        return null
    }
  }, [filter])

  // Toggle semantics throughout: clicking the already-active source clears
  // the filter instead of re-applying it, matching the "click to clear" hint
  // StatCard shows once a card is active.
  function toggleCoverage(category: SettlementCoverageCategory) {
    setFilter((f) => (f?.kind === 'coverage' && f.category === category ? null : { kind: 'coverage', category }))
  }
  function toggleVisitation(status: VisitationStatus) {
    setFilter((f) => (f?.kind === 'visitation' && f.status === status ? null : { kind: 'visitation', status }))
  }
  function toggleGroupCoverage(value: string, category: SettlementCoverageCategory) {
    const level = drillData?.groupLevel ?? 'state'
    setFilter((f) =>
      f?.kind === 'groupCoverage' && f.level === level && f.value === value && f.category === category
        ? null
        : { kind: 'groupCoverage', level, value, category },
    )
  }
  function toggleGroupVisitation(value: string, status: VisitationStatus) {
    const level = drillData?.groupLevel ?? 'state'
    setFilter((f) =>
      f?.kind === 'groupVisitation' && f.level === level && f.value === value && f.status === status
        ? null
        : { kind: 'groupVisitation', level, value, status },
    )
  }

  // Picking a state (or LGA) in the settlement list table drills the
  // breakdown charts/cards down a level — see drillData above — and clears
  // any active segment/card category filter, since it was scoped to
  // whatever level was showing before the drill changed.
  function handleDrillStateChange(state: string | null) {
    setDrillState(state)
    setDrillLga(null)
    setFilter(null)
  }
  function handleDrillLgaChange(lga: string | null) {
    setDrillLga(lga)
    setFilter(null)
  }

  const groupLevel = drillData?.groupLevel ?? 'state'
  const coverageTitle =
    groupLevel === 'state'
      ? 'Settlement coverage by state'
      : groupLevel === 'lga'
      ? `Settlement coverage by LGA — ${drillState}`
      : `Settlement coverage by ward — ${drillState} · ${drillLga}`
  const visitationTitle =
    groupLevel === 'state'
      ? 'Settlement visitation by state'
      : groupLevel === 'lga'
      ? `Settlement visitation by LGA — ${drillState}`
      : `Settlement visitation by ward — ${drillState} · ${drillLga}`
  const groupEmptyMessage =
    groupLevel === 'state'
      ? 'No state column detected in the result.'
      : groupLevel === 'lga'
      ? 'No LGA column detected in the result.'
      : 'No ward column detected in the result.'

  return (
    <div>
      <TrackingForm onSubmit={handleSubmit} submitting={submitting} />

      {error && (
        <div
          style={{
            background: '#fdecea',
            border: '1px solid var(--color-critical)',
            color: '#7a2020',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {submitting && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 20 }}>
          Running settlement tracking analysis — this can take a while for large track sets…
        </div>
      )}

      {analysis?.error && (
        <div style={{ color: 'var(--color-critical)', fontSize: 13, marginBottom: 20 }}>
          {analysis.error}
        </div>
      )}

      {analysis && analysis.error === null && drillData && (
        <>
          {(csvBlob || archiveJobId || downloadError) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              {downloadError && <span style={{ fontSize: 11.5, color: 'var(--color-critical)' }}>{downloadError}</span>}
              {csvBlob && (
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'var(--color-surface)',
                    color: 'var(--color-primary)',
                    border: '1px solid var(--color-primary)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 14px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ⬇ Download CSV
                </button>
              )}
              {archiveJobId && (
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={downloading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: downloading ? 'var(--color-text-muted)' : 'var(--color-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 14px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: downloading ? 'default' : 'pointer',
                  }}
                >
                  {downloading ? 'Preparing ZIP…' : '⬇ Download ZIP (CSV + Tracks)'}
                </button>
              )}
            </div>
          )}

          <SummaryCards
            totalSettlements={drillData.totalSettlements}
            totalStates={drillData.totalStates}
            totalLgas={drillData.totalLgas}
            totalWards={drillData.totalWards}
          />
          <CoverageCards
            counts={drillData.coverageCounts}
            activeCategory={filter?.kind === 'coverage' ? filter.category : null}
            onSelect={toggleCoverage}
          />
          <VisitationCards
            counts={drillData.visitationCounts}
            cumColumnLabel={analysis.cumColumn}
            activeStatus={filter?.kind === 'visitation' ? filter.status : null}
            onSelect={toggleVisitation}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
            <StateCoverageChart
              data={drillData.groupCoverage}
              title={coverageTitle}
              emptyMessage={groupEmptyMessage}
              activeState={filter?.kind === 'groupCoverage' && filter.level === groupLevel ? filter.value : null}
              activeCategory={filter?.kind === 'groupCoverage' && filter.level === groupLevel ? filter.category : null}
              onSelect={toggleGroupCoverage}
            />
            <StateVisitationChart
              data={drillData.groupVisitation}
              cumColumnLabel={analysis.cumColumn}
              title={visitationTitle}
              emptyMessage={groupEmptyMessage}
              activeOrder={analysis.activeVisitationOrder}
              activeState={filter?.kind === 'groupVisitation' && filter.level === groupLevel ? filter.value : null}
              activeStatus={filter?.kind === 'groupVisitation' && filter.level === groupLevel ? filter.status : null}
              onSelect={toggleGroupVisitation}
            />
          </div>

          <TabbedPanel
            activeKey={settlementView}
            onChange={(key) => setSettlementView(key as 'map' | 'list')}
            tabs={[
              {
                key: 'map',
                label: 'Map',
                content: (
                  <VisitationMap
                    points={filteredMapPoints}
                    cumColumnLabel={analysis.cumColumn}
                    legendOrder={analysis.activeVisitationOrder}
                    filterDescription={filterDescription}
                    onClearFilter={() => setFilter(null)}
                    bare
                  />
                ),
              },
              {
                key: 'list',
                label: 'List',
                content: (
                  <SettlementListTable
                    records={filteredRecords}
                    columns={analysis.columns}
                    cumColumn={analysis.cumColumn}
                    filterState={drillState}
                    filterLga={drillLga}
                    onFilterStateChange={handleDrillStateChange}
                    onFilterLgaChange={handleDrillLgaChange}
                    stateOptions={stateOptions}
                    lgaOptions={lgaOptions}
                    filterDescription={filterDescription}
                    onClearFilter={() => setFilter(null)}
                    bare
                  />
                ),
              },
            ]}
          />
        </>
      )}

      {!result && !submitting && !error && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Upload a DIP file and GPS tracks above and run the analysis to see results here.
        </div>
      )}
    </div>
  )
}
