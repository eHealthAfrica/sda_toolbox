import { useEffect, useMemo, useState } from 'react'
import { ApiError, submitMlosQC } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { parseMlosCsv } from '../../api/parseResult'
import type { ParsedMlosResult, QcFormInput, ValidationStatus } from '../../types/mlos'
import { QC_ISSUE_FLAGS } from '../../types/mlos'
import { detectColumns } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import { countUniqueValues, matchesColumnValue, uniqueColumnValues } from '../../utils/aggregate'
import {
  computeGroupFlagBreakdown,
  computeIssueFlagCounts,
  computeProximityBreakdown,
  computeValidationStatusCounts,
  countFlagged,
} from '../../utils/mlosAggregate'
import QcForm from './QcForm'
import QcSummaryCards from './QcSummaryCards'
import IssueFlagCards from './IssueFlagCards'
import ValidationStatusPie from './ValidationStatusPie'
import IssueFlagBarChart from './IssueFlagBarChart'
import ProximityBreakdownChart from './ProximityBreakdownChart'
import FlagBreakdownChart from './FlagBreakdownChart'
import QcSettlementListTable from './QcSettlementListTable'

// One category filter can be active at a time — set by clicking an
// issue-flag card/bar, a validation-status pie slice, or a proximity
// column. This is a SEPARATE dimension from the State/LGA/Ward drill below:
// the drill narrows WHICH settlements are in scope geographically, this
// narrows WHICH settlements match a QC finding, and the two compose (e.g.
// "Stacked Points issues, in Lagos"). Unlike the old 'lga'/'flaggedOnly'
// filter kinds this replaces, a drill change does NOT clear this filter —
// nothing about picking a different state invalidates "issue: Stacked
// Points", so there's no need to reset it the way H2HTrackingPage resets
// its groupCoverage/groupVisitation filters on a drill change (those really
// are tied to the drill level; these aren't).
type QcFilter =
  | { kind: 'issue'; key: string; label: string }
  | { kind: 'status'; status: ValidationStatus }
  | { kind: 'proximity'; bucket: string }

type DrillLevel = 'state' | 'lga' | 'ward'

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

export default function MlosQcPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedMlosResult | null>(null)
  // The raw CSV blob POST /qc/validation returned, kept alongside the parsed
  // result purely so "Download results" can hand back the server's actual
  // bytes rather than re-serializing parsed records into an approximation.
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)

  // Geographic drill scope — /qc/validation dropped its single `state` param
  // (api/client.ts::submitMlosQC), so a result can now span multiple
  // states, and narrowing down through State -> LGA -> Ward is a real
  // navigation, not a no-op. Driven from two places that both write the
  // same state: the settlement table's State/LGA/Ward selects, and clicking
  // a bar on FlagBreakdownChart (see handleDrillStateChange/
  // handleDrillLgaChange below and the chart wiring further down).
  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  const [drillWard, setDrillWard] = useState<string | null>(null)
  const [filter, setFilter] = useState<QcFilter | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: QcFormInput) {
    setSubmitting(true)
    setError(null)
    setFilter(null)
    setDrillState(null)
    setDrillLga(null)
    setDrillWard(null)
    const jobId = startJob('mlos-qc', input.mlosFile?.name ?? 'QC & Validation run')
    try {
      const csvBlob = await submitMlosQC(input)
      const parsed = await parseMlosCsv(csvBlob, `${input.mlosFile?.name.split('.')[0] ?? 'mlos'}_QC.csv`)
      setResult(parsed)
      setResultBlob(csvBlob)
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while running QC & Validation.')
      }
      setResult(null)
      setResultBlob(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  const columns = useMemo<DetectedColumns | null>(() => (result ? detectColumns(result.columns) : null), [result])

  // State/LGA/Ward select options for the settlement table, cascading the
  // same way H2HTrackingPage's do: always built from the FULL result so
  // every state stays pickable, LGA options narrowed to whichever state is
  // picked, ward options narrowed to whichever state+LGA are picked.
  const stateOptions = useMemo(
    () => (columns?.state ? uniqueColumnValues(result?.records ?? [], columns.state) : []),
    [result, columns],
  )
  const lgaOptions = useMemo(() => {
    if (!columns?.lga) return []
    const scope = drillState
      ? (result?.records ?? []).filter((r) => matchesColumnValue(r, columns.state, drillState))
      : result?.records ?? []
    return uniqueColumnValues(scope, columns.lga)
  }, [result, columns, drillState])
  const wardOptions = useMemo(() => {
    if (!columns?.ward) return []
    let scope = result?.records ?? []
    if (drillState) scope = scope.filter((r) => matchesColumnValue(r, columns.state, drillState))
    if (drillLga) scope = scope.filter((r) => matchesColumnValue(r, columns.lga, drillLga))
    return uniqueColumnValues(scope, columns.ward)
  }, [result, columns, drillState, drillLga])

  // Records narrowed by the State/LGA/Ward drill only — this is the "full
  // picture" for whichever geography is currently selected, before the
  // issue/status/proximity chart filter narrows it further. Every chart
  // below reads from THIS (rather than filteredRecords) for the one
  // dimension it itself owns, so clicking, say, an issue card doesn't turn
  // that same chart into a single trivial 100% bar — it can still be
  // re-picked or cleared. Every OTHER chart, the title cards, and the table
  // read from filteredRecords, so they do reflect it. That's what makes
  // "every chart interactive with every other, including the table" work
  // without one chart fighting its own filter.
  const scopedRecords = useMemo(() => {
    if (!result || !columns) return []
    let recs = result.records
    if (drillState && columns.state) recs = recs.filter((r) => matchesColumnValue(r, columns.state, drillState))
    if (drillLga && columns.lga) recs = recs.filter((r) => matchesColumnValue(r, columns.lga, drillLga))
    if (drillWard && columns.ward) recs = recs.filter((r) => matchesColumnValue(r, columns.ward, drillWard))
    return recs
  }, [result, columns, drillState, drillLga, drillWard])

  const filteredRecords = useMemo(() => {
    if (!filter) return scopedRecords
    switch (filter.kind) {
      case 'issue':
        return scopedRecords.filter((r) => isPresent(r[filter.key]))
      case 'status':
        return scopedRecords.filter((r) => r.validation_status === filter.status)
      case 'proximity':
        return scopedRecords.filter((r) => String(r.proximity_issues ?? '').trim() === filter.bucket)
      default:
        return scopedRecords
    }
  }, [scopedRecords, filter])

  const groupLevel: DrillLevel = drillLga ? 'ward' : drillState ? 'lga' : 'state'
  const groupColumn = !columns ? null : groupLevel === 'state' ? columns.state : groupLevel === 'lga' ? columns.lga : columns.ward

  // Each chart's own dimension reads from scopedRecords (drill only) so it
  // stays fully interactive; every other dimension reads from
  // filteredRecords (drill + whatever category filter is active).
  const issueBase = filter?.kind === 'issue' ? scopedRecords : filteredRecords
  const statusBase = filter?.kind === 'status' ? scopedRecords : filteredRecords
  const proximityBase = filter?.kind === 'proximity' ? scopedRecords : filteredRecords

  const issueCounts = useMemo(() => computeIssueFlagCounts(issueBase, QC_ISSUE_FLAGS), [issueBase])
  const validationCounts = useMemo(() => computeValidationStatusCounts(statusBase), [statusBase])
  const proximityBreakdown = useMemo(() => computeProximityBreakdown(proximityBase), [proximityBase])
  // The breakdown chart doesn't own any filter kind itself (its own clicks
  // drive the drill, not `filter`), so it always reads the fully filtered
  // set.
  const groupBreakdown = useMemo(
    () => (groupColumn ? computeGroupFlagBreakdown(filteredRecords, groupColumn) : []),
    [filteredRecords, groupColumn],
  )

  // Title cards always describe "what's currently in view" — full drill +
  // filter scope — same convention as H2HTrackingPage's SummaryCards.
  const totalSettlements = filteredRecords.length
  const totalFlagged = useMemo(() => countFlagged(filteredRecords), [filteredRecords])
  const totalStates = columns?.state ? countUniqueValues(filteredRecords, columns.state) : 0
  const totalLgas = columns?.lga ? countUniqueValues(filteredRecords, columns.lga) : 0
  const totalWards = columns?.ward ? countUniqueValues(filteredRecords, columns.ward) : 0

  const filterDescription = useMemo(() => {
    if (!filter) return null
    switch (filter.kind) {
      case 'issue':
        return `issue: ${filter.label}`
      case 'status':
        return `status: ${filter.status}`
      case 'proximity':
        return `proximity: ${filter.bucket}`
      default:
        return null
    }
  }, [filter])

  // Toggle semantics for the category filter: clicking the already-active
  // source clears the filter instead of re-applying it, matching the
  // "click to clear" hint StatCard shows once a card is active.
  function toggleIssue(key: string) {
    const label = QC_ISSUE_FLAGS.find((f) => f.key === key)?.label ?? key
    setFilter((f) => (f?.kind === 'issue' && f.key === key ? null : { kind: 'issue', key, label }))
  }
  function toggleStatus(status: ValidationStatus) {
    setFilter((f) => (f?.kind === 'status' && f.status === status ? null : { kind: 'status', status }))
  }
  function toggleProximity(bucket: string) {
    setFilter((f) => (f?.kind === 'proximity' && f.bucket === bucket ? null : { kind: 'proximity', bucket }))
  }

  // Drill semantics: picking a new State clears LGA and Ward under it;
  // picking a new LGA clears Ward under it. Ward has nothing under it, so
  // setting it doesn't cascade further. Shared by the table's selects and
  // FlagBreakdownChart's bar clicks/back link — one set of handlers for
  // both entry points into the same state.
  function handleDrillStateChange(state: string | null) {
    setDrillState(state)
    setDrillLga(null)
    setDrillWard(null)
  }
  function handleDrillLgaChange(lga: string | null) {
    setDrillLga(lga)
    setDrillWard(null)
  }

  const breakdownTitle =
    groupLevel === 'state'
      ? 'Flagged settlements by state'
      : groupLevel === 'lga'
      ? `Flagged settlements by LGA — ${drillState}`
      : `Flagged settlements by ward — ${drillState} · ${drillLga}`
  const breakdownEmptyMessage =
    groupLevel === 'state'
      ? 'No state column detected in the result.'
      : groupLevel === 'lga'
      ? 'No LGA column detected in the result.'
      : 'No ward column detected in the result.'
  const breakdownOnSelect =
    groupLevel === 'state' ? handleDrillStateChange : groupLevel === 'lga' ? handleDrillLgaChange : undefined
  const breakdownOnDrillUp =
    groupLevel === 'lga' ? () => handleDrillStateChange(null) : groupLevel === 'ward' ? () => handleDrillLgaChange(null) : undefined
  const breakdownDrillUpLabel = groupLevel === 'lga' ? '← All states' : groupLevel === 'ward' ? `← All LGAs in ${drillState}` : undefined

  const downloadUrl = useMemo(() => (resultBlob ? URL.createObjectURL(resultBlob) : null), [resultBlob])
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    }
  }, [downloadUrl])

  return (
    <div>
      <QcForm onSubmit={handleSubmit} submitting={submitting} />

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
          Running QC &amp; validation — spatial and attribute checks can take a while on a large master list…
        </div>
      )}

      {result && columns && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={result.sourceFilename ?? 'mlos_qc.csv'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--color-primary)',
                  color: '#fff',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 14px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                ⬇ Download results (CSV)
              </a>
            )}
          </div>

          <QcSummaryCards
            totalSettlements={totalSettlements}
            totalStates={totalStates}
            totalLgas={totalLgas}
            totalWards={totalWards}
            totalFlagged={totalFlagged}
          />
          <IssueFlagCards
            counts={issueCounts}
            activeKey={filter?.kind === 'issue' ? filter.key : null}
            onSelect={toggleIssue}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
            <ValidationStatusPie
              counts={validationCounts}
              activeStatus={filter?.kind === 'status' ? filter.status : null}
              onSelect={toggleStatus}
            />
            <IssueFlagBarChart
              counts={issueCounts}
              activeKey={filter?.kind === 'issue' ? filter.key : null}
              onSelect={toggleIssue}
            />
          </div>

          <ProximityBreakdownChart
            data={proximityBreakdown}
            activeBucket={filter?.kind === 'proximity' ? filter.bucket : null}
            onSelect={toggleProximity}
          />

          <FlagBreakdownChart
            data={groupBreakdown}
            title={breakdownTitle}
            emptyMessage={breakdownEmptyMessage}
            onSelect={breakdownOnSelect}
            onDrillUp={breakdownOnDrillUp}
            drillUpLabel={breakdownDrillUpLabel}
          />

          <QcSettlementListTable
            records={filteredRecords}
            columns={columns}
            totalCount={scopedRecords.length}
            filterState={drillState}
            filterLga={drillLga}
            filterWard={drillWard}
            onFilterStateChange={handleDrillStateChange}
            onFilterLgaChange={handleDrillLgaChange}
            onFilterWardChange={setDrillWard}
            stateOptions={stateOptions}
            lgaOptions={lgaOptions}
            wardOptions={wardOptions}
            filterDescription={filterDescription}
            onClearFilter={() => setFilter(null)}
          />
        </>
      )}

      {!result && !submitting && !error && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Upload a settlement list above and run QC &amp; Validation to see results here.
        </div>
      )}
    </div>
  )
}
