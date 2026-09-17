import { useMemo, useState } from 'react'
import { ApiError, fetchH2HArchive, fetchH2HReports, submitH2HTracking } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import type { DailyPostReport } from '../../types/dailyReport'
import DailyReportChartsPanel from '../dailyReport/DailyReportChartsPanel'
import { parseH2HCsv } from '../../api/parseResult'
import type { ParsedResult, SettlementCoverageCategory, TrackingFormInput, VisitationStatus } from '../../types/h2h'
import { SETTLEMENT_COVERAGE_CATEGORIES, VISITATION_STATUSES } from '../../types/h2h'
import { detectColumns, findCumulativeColumn } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import { getVisitationOrderFor } from '../../utils/colors'
import {
  buildMapPoints,
  computeCoverageCounts,
  computeStateCoverage,
  computeStateVisitation,
  computeTotalTimeSpent,
  computeVisitationCounts,
  countUniqueValues,
  matchesColumnValue,
  uniqueColumnValues,
} from '../../utils/aggregate'
import type { MapPoint, StateCoverageEntry, StateVisitationEntry } from '../../utils/aggregate'
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
// coverage/visitation card, a legend swatch on either breakdown chart, a
// segment on either breakdown chart, or the settlement table's own
// Visitation/Coverage selects. This is a SEPARATE dimension from the
// State/LGA/Ward drill below (drillState/drillLga/drillWard): the drill
// narrows WHICH settlements are in scope geographically, this narrows WHICH
// settlements match a coverage/visitation value, and the two compose (e.g.
// "Fully Covered settlements, in Lagos"). A drill change does NOT clear this
// filter — nothing about picking a different state invalidates "coverage:
// Fully Covered" — same convention as MlosQcPage's issue/status/proximity
// filter vs. its own State/LGA/Ward drill.
//
// 'groupCoverage'/'groupVisitation' are the compound form a bar-SEGMENT click
// produces (a specific {value, category} pair at whichever level the chart
// is currently showing) — a legend click or a card click always produces the
// plain 'coverage'/'visitation' form instead (category only, no group value).
type DrillLevel = 'state' | 'lga' | 'ward'

type H2HFilter =
  | { kind: 'coverage'; category: SettlementCoverageCategory }
  | { kind: 'visitation'; status: VisitationStatus }
  | { kind: 'groupCoverage'; level: DrillLevel; value: string; category: SettlementCoverageCategory }
  | { kind: 'groupVisitation'; level: DrillLevel; value: string; status: VisitationStatus }

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
  // Geographic drill scope. Selecting a State (via the settlement table's
  // select, or clicking a bar's axis label on either breakdown chart) drills
  // the two breakdown charts and every title card down to that state's LGAs;
  // additionally selecting an LGA drills further, to that LGA's wards.
  // Selecting a Ward narrows the scope one step further still without
  // introducing a level below it (ward is the bottom of the hierarchy) — see
  // scopedRecords/groupLevel below.
  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  const [drillWard, setDrillWard] = useState<string | null>(null)
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
  // Daily/Cumulative report charts for this run, fetched separately (see
  // handleSubmit below) only when the "Generate daily reports" toggle was
  // on. The settlements CSV above resolves first regardless — this is a
  // second, non-fatal step: a failure here surfaces as reportsError
  // alongside the settlement results rather than failing the whole run.
  const [reports, setReports] = useState<DailyPostReport[] | null>(null)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: TrackingFormInput) {
    setSubmitting(true)
    setError(null)
    setMopUp(input.isMopUp)
    setFilter(null)
    setDrillState(null)
    setDrillLga(null)
    setDrillWard(null)
    setCsvBlob(null)
    setArchiveJobId(null)
    setDownloadError(null)
    setReports(null)
    setReportsError(null)
    const jobId = startJob('h2h', input.tracksFile?.name ?? 'H2H tracking run')
    try {
      const { csvBlob: newCsvBlob, jobId: newArchiveJobId } = await submitH2HTracking(input)
      const parsed = await parseH2HCsv(newCsvBlob, input.analysisDay, input.dipFile?.name ?? 'settlements.csv')
      setResult(parsed)
      setCsvBlob(newCsvBlob)
      setArchiveJobId(newArchiveJobId)
      completeJob(jobId)

      // A second, independent fetch off the same job id — a failure here
      // (most likely a 404, e.g. h2h_cache.py's peek_result not deployed
      // yet) is surfaced via reportsError without touching `error` or
      // failing the job the settlement results already completed under.
      if (input.generateReport && newArchiveJobId) {
        try {
          const fetchedReports = await fetchH2HReports(newArchiveJobId)
          setReports(fetchedReports)
        } catch (reportsErr) {
          if (reportsErr instanceof ApiError) {
            const detailText =
              typeof reportsErr.detail === 'string' ? reportsErr.detail : JSON.stringify(reportsErr.detail)
            setReportsError(`${reportsErr.message}${detailText ? ` — ${detailText}` : ''}`)
          } else {
            setReportsError('Could not load the daily report charts for this run.')
          }
        }
      }
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

  const columns = analysis && analysis.error === null ? analysis.columns : null

  // State/LGA/Ward select options for the settlement list table, always
  // built from the FULL result (not the current drill scope) so every value
  // stays pickable regardless of what's currently selected — cascading the
  // same way MlosQcPage's do: lgaOptions narrowed to whichever state (if
  // any) is picked, wardOptions narrowed to whichever state+LGA are picked.
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

  const wardOptions = useMemo(() => {
    if (!analysis || analysis.error !== null || !analysis.columns.ward) return []
    let scope = analysis.records
    if (drillState) scope = scope.filter((r) => matchesColumnValue(r, analysis.columns.state, drillState))
    if (drillLga) scope = scope.filter((r) => matchesColumnValue(r, analysis.columns.lga, drillLga))
    return uniqueColumnValues(scope, analysis.columns.ward)
  }, [analysis, drillState, drillLga])

  // Records narrowed by the State/LGA/Ward drill only — the "full picture"
  // for whichever geography is currently selected, before the coverage/
  // visitation filter narrows it further. See coverageBase/visitationBase
  // below for why the breakdown charts and coverage/visitation cards don't
  // always read from filteredRecords directly.
  const scopedRecords = useMemo(() => {
    if (!analysis || analysis.error !== null) return []
    const { columns: cols, records } = analysis
    let recs = records
    if (drillState && cols.state) recs = recs.filter((r) => matchesColumnValue(r, cols.state, drillState))
    if (drillLga && cols.lga) recs = recs.filter((r) => matchesColumnValue(r, cols.lga, drillLga))
    if (drillWard && cols.ward) recs = recs.filter((r) => matchesColumnValue(r, cols.ward, drillWard))
    return recs
  }, [analysis, drillState, drillLga, drillWard])

  const scopedMapPoints = useMemo(() => {
    if (!analysis || analysis.error !== null) return []
    let pts = analysis.mapPoints
    if (drillState) pts = pts.filter((p) => p.state === drillState)
    if (drillLga) pts = pts.filter((p) => p.lga === drillLga)
    if (drillWard) pts = pts.filter((p) => p.ward === drillWard)
    return pts
  }, [analysis, drillState, drillLga, drillWard])

  const groupColumnFor = (level: DrillLevel): string | null =>
    !columns ? null : level === 'state' ? columns.state : level === 'lga' ? columns.lga : columns.ward

  const groupLevel: DrillLevel = drillLga ? 'ward' : drillState ? 'lga' : 'state'
  const groupColumn = groupColumnFor(groupLevel)

  const filteredRecords = useMemo(() => {
    if (!analysis || analysis.error !== null) return []
    const base = scopedRecords
    if (!filter) return base
    const { cumColumn } = analysis
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
  }, [analysis, scopedRecords, filter])

  const filteredMapPoints = useMemo(() => {
    if (!analysis || analysis.error !== null) return []
    const base = scopedMapPoints
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
  }, [analysis, scopedMapPoints, filter])

  // Each element's own dimension reads from scopedRecords (drill only) so it
  // stays fully interactive/browsable; every other dimension reads from
  // filteredRecords (drill + whatever the other dimension's filter is) —
  // same self-scope-vs-cross-scope rule as MlosQcPage's charts. Both the
  // plain and the group-compound form of a filter count as "this dimension
  // is active" for that purpose.
  const coverageBase = filter?.kind === 'coverage' || filter?.kind === 'groupCoverage' ? scopedRecords : filteredRecords
  const visitationBase = filter?.kind === 'visitation' || filter?.kind === 'groupVisitation' ? scopedRecords : filteredRecords

  const coverageCounts = useMemo(() => computeCoverageCounts(coverageBase), [coverageBase])
  const visitationCounts = useMemo(
    () => (analysis && analysis.error === null ? computeVisitationCounts(visitationBase, analysis.cumColumn, analysis.activeVisitationOrder) : []),
    [visitationBase, analysis],
  )
  const groupCoverage: StateCoverageEntry[] = useMemo(
    () => (groupColumn ? computeStateCoverage(coverageBase, groupColumn) : []),
    [coverageBase, groupColumn],
  )
  const groupVisitation: StateVisitationEntry[] = useMemo(
    () => (groupColumn && analysis && analysis.error === null ? computeStateVisitation(visitationBase, groupColumn, analysis.cumColumn) : []),
    [visitationBase, groupColumn, analysis],
  )

  // Visitation/Coverage select options on the settlement table — narrowed to
  // the current State/LGA/Ward scope (only values that actually occur there
  // are offered), same as stateOptions/lgaOptions/wardOptions above, but
  // NOT cascaded against each other — each always reflects the full
  // geography scope regardless of what the other is currently set to, so
  // picking one doesn't hide options the other might still want.
  const visitationOptions = useMemo(() => {
    if (!analysis || analysis.error !== null) return []
    const present = new Set(uniqueColumnValues(scopedRecords, analysis.cumColumn))
    return VISITATION_STATUSES.filter((status) => present.has(status))
  }, [analysis, scopedRecords])
  const coverageOptions = useMemo(() => {
    const present = new Set(uniqueColumnValues(scopedRecords, 'Settlement Coverage'))
    return SETTLEMENT_COVERAGE_CATEGORIES.filter((category) => present.has(category))
  }, [scopedRecords])

  // Title cards always describe "what's currently in view" — full drill +
  // filter scope — same convention as MlosQcPage's summary cards.
  const totalSettlements = filteredRecords.length
  const totalStates = columns?.state ? countUniqueValues(filteredRecords, columns.state) : 0
  const totalLgas = columns?.lga ? countUniqueValues(filteredRecords, columns.lga) : 0
  const totalWards = columns?.ward ? countUniqueValues(filteredRecords, columns.ward) : 0
  const totalTimeSpentMins = useMemo(() => computeTotalTimeSpent(filteredRecords), [filteredRecords])

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
  // StatCard shows once a card is active. A card, a legend swatch, or the
  // table's own Visitation/Coverage select all funnel into these same two
  // functions (or the plain-select variants below) — one source of truth
  // for "is coverage/visitation currently filtered, and to what". Clicking
  // while a group-compound filter is active for the SAME category/status
  // clears it too (dropping its group-value constraint along with it);
  // a DIFFERENT category/status replaces it with the plain (ungrouped) form.
  function toggleCoverage(category: SettlementCoverageCategory) {
    setFilter((f) => {
      const alreadyActive =
        (f?.kind === 'coverage' && f.category === category) || (f?.kind === 'groupCoverage' && f.category === category)
      return alreadyActive ? null : { kind: 'coverage', category }
    })
  }
  function toggleVisitation(status: VisitationStatus) {
    setFilter((f) => {
      const alreadyActive =
        (f?.kind === 'visitation' && f.status === status) || (f?.kind === 'groupVisitation' && f.status === status)
      return alreadyActive ? null : { kind: 'visitation', status }
    })
  }
  function toggleGroupCoverage(value: string, category: SettlementCoverageCategory) {
    setFilter((f) =>
      f?.kind === 'groupCoverage' && f.level === groupLevel && f.value === value && f.category === category
        ? null
        : { kind: 'groupCoverage', level: groupLevel, value, category },
    )
  }
  function toggleGroupVisitation(value: string, status: VisitationStatus) {
    setFilter((f) =>
      f?.kind === 'groupVisitation' && f.level === groupLevel && f.value === value && f.status === status
        ? null
        : { kind: 'groupVisitation', level: groupLevel, value, status },
    )
  }

  // "Set or clear" variants for the settlement table's own Visitation/
  // Coverage selects — a select isn't a toggle (picking a value always
  // means "show this value", not "show this value unless it's already
  // showing"), but choosing the blank "All ___" option should only clear
  // the filter if it's actually this dimension that's currently active
  // (otherwise a Visitation select showing "All statuses" because a
  // Coverage filter is active would wrongly clear that Coverage filter).
  function handleFilterCoverageSelect(category: SettlementCoverageCategory | null) {
    if (category) setFilter({ kind: 'coverage', category })
    else if (filter?.kind === 'coverage') setFilter(null)
  }
  function handleFilterVisitationSelect(status: VisitationStatus | null) {
    if (status) setFilter({ kind: 'visitation', status })
    else if (filter?.kind === 'visitation') setFilter(null)
  }

  // Drill semantics: picking a new State clears LGA and Ward under it;
  // picking a new LGA clears Ward under it; Ward has nothing under it, so
  // setting it doesn't cascade further. Unlike the filter above, drilling
  // does NOT clear the active coverage/visitation filter — nothing about
  // picking a different state invalidates "coverage: Fully Covered", same
  // convention as MlosQcPage's drill vs. category filter. Shared by the
  // table's selects and both breakdown charts' axis-label clicks/back
  // links — one set of handlers for every entry point into the same state.
  function handleDrillStateChange(state: string | null) {
    setDrillState(state)
    setDrillLga(null)
    setDrillWard(null)
  }
  function handleDrillLgaChange(lga: string | null) {
    setDrillLga(lga)
    setDrillWard(null)
  }
  function handleDrillWardChange(ward: string | null) {
    setDrillWard(ward)
  }

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

  // A click on a bar's axis label always drills — at 'ward', the bottom of
  // the hierarchy, that means narrowing the scope to exactly that ward
  // (drillWard) rather than opening up a level below it, since there isn't
  // one.
  const breakdownOnAxisSelect =
    groupLevel === 'state' ? handleDrillStateChange : groupLevel === 'lga' ? handleDrillLgaChange : handleDrillWardChange
  const breakdownOnDrillUp =
    groupLevel === 'lga' ? () => handleDrillStateChange(null) : groupLevel === 'ward' ? () => handleDrillLgaChange(null) : undefined
  const breakdownDrillUpLabel = groupLevel === 'lga' ? '← All states' : groupLevel === 'ward' ? `← All LGAs in ${drillState}` : undefined

  const activeCoverageCategory =
    filter?.kind === 'coverage' ? filter.category : filter?.kind === 'groupCoverage' ? filter.category : null
  const activeVisitationStatus =
    filter?.kind === 'visitation' ? filter.status : filter?.kind === 'groupVisitation' ? filter.status : null
  const activeGroupValue =
    filter?.kind === 'groupCoverage' || filter?.kind === 'groupVisitation'
      ? filter.level === groupLevel
        ? filter.value
        : null
      : null

  const filterVisitationValue = filter?.kind === 'visitation' ? filter.status : null
  const filterCoverageValue = filter?.kind === 'coverage' ? filter.category : null

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

      {analysis && analysis.error === null && columns && (
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
            totalSettlements={totalSettlements}
            totalStates={totalStates}
            totalLgas={totalLgas}
            totalWards={totalWards}
            totalTimeSpentMins={totalTimeSpentMins}
          />
          <CoverageCards counts={coverageCounts} activeCategory={activeCoverageCategory} onSelect={toggleCoverage} />
          <VisitationCards
            counts={visitationCounts}
            cumColumnLabel={analysis.cumColumn}
            activeStatus={activeVisitationStatus}
            onSelect={toggleVisitation}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
            <StateCoverageChart
              data={groupCoverage}
              title={coverageTitle}
              emptyMessage={groupEmptyMessage}
              activeState={activeGroupValue}
              activeCategory={activeCoverageCategory}
              onSelect={toggleGroupCoverage}
              onLegendSelect={toggleCoverage}
              onAxisSelect={breakdownOnAxisSelect}
              onDrillUp={breakdownOnDrillUp}
              drillUpLabel={breakdownDrillUpLabel}
            />
            <StateVisitationChart
              data={groupVisitation}
              cumColumnLabel={analysis.cumColumn}
              title={visitationTitle}
              emptyMessage={groupEmptyMessage}
              activeOrder={analysis.activeVisitationOrder}
              activeState={activeGroupValue}
              activeStatus={activeVisitationStatus}
              onSelect={toggleGroupVisitation}
              onLegendSelect={toggleVisitation}
              onAxisSelect={breakdownOnAxisSelect}
              onDrillUp={breakdownOnDrillUp}
              drillUpLabel={breakdownDrillUpLabel}
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
                    columns={columns}
                    cumColumn={analysis.cumColumn}
                    totalCount={scopedRecords.length}
                    filterState={drillState}
                    filterLga={drillLga}
                    filterWard={drillWard}
                    filterVisitation={filterVisitationValue}
                    filterCoverage={filterCoverageValue}
                    onFilterStateChange={handleDrillStateChange}
                    onFilterLgaChange={handleDrillLgaChange}
                    onFilterWardChange={handleDrillWardChange}
                    onFilterVisitationChange={handleFilterVisitationSelect}
                    onFilterCoverageChange={handleFilterCoverageSelect}
                    stateOptions={stateOptions}
                    lgaOptions={lgaOptions}
                    wardOptions={wardOptions}
                    visitationOptions={visitationOptions}
                    coverageOptions={coverageOptions}
                    filterDescription={filterDescription}
                    onClearFilter={() => setFilter(null)}
                    bare
                  />
                ),
              },
            ]}
          />

          {(reports || reportsError) && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Daily report charts</h3>
              <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 16 }}>
                Generated from this run by the same Daily Report pipeline as Reporting → Daily Report.
              </p>
              {reportsError && (
                <div
                  style={{
                    background: '#fdecea',
                    border: '1px solid var(--color-critical)',
                    color: '#7a2020',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 14px',
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  {reportsError}
                </div>
              )}
              {reports && reports.length > 0 && <DailyReportChartsPanel reports={reports} />}
              {reports && reports.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '12px 0' }}>
                  The response contained no report figures.
                </div>
              )}
            </div>
          )}
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
