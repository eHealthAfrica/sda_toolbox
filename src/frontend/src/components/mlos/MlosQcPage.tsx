import { useEffect, useMemo, useState } from 'react'
import { ApiError, submitMlosQC } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { parseMlosCsv } from '../../api/parseResult'
import type { MlosRecord, ParsedMlosResult, QcFormInput, ValidationStatus } from '../../types/mlos'
import { QC_ISSUE_FLAGS } from '../../types/mlos'
import { detectColumns } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import { countUniqueValues } from '../../utils/aggregate'
import type { CountEntry } from '../../utils/aggregate'
import {
  computeGroupFlagBreakdown,
  computeIssueFlagCounts,
  computeProximityBreakdown,
  computeValidationStatusCounts,
  countFlagged,
} from '../../utils/mlosAggregate'
import type { GroupFlagBreakdownEntry, IssueFlagCount, ProximityBreakdownEntry } from '../../utils/mlosAggregate'
import QcForm from './QcForm'
import QcSummaryCards from './QcSummaryCards'
import IssueFlagCards from './IssueFlagCards'
import ValidationStatusPie from './ValidationStatusPie'
import IssueFlagBarChart from './IssueFlagBarChart'
import ProximityBreakdownChart from './ProximityBreakdownChart'
import LgaFlagBreakdownChart from './LgaFlagBreakdownChart'
import QcSettlementListTable from './QcSettlementListTable'

interface QcAnalysisResult {
  columns: DetectedColumns
  totalSettlements: number
  totalFlagged: number
  totalLgas: number
  issueCounts: IssueFlagCount[]
  validationCounts: CountEntry<ValidationStatus>[]
  lgaBreakdown: GroupFlagBreakdownEntry[]
  proximityBreakdown: ProximityBreakdownEntry[]
  records: MlosRecord[]
}

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

  // One filter can be active at a time — set by clicking an issue-flag
  // card/bar, a validation-status pie slice, an LGA bar, or the "Flagged
  // settlements" summary card. All four drive the same settlement table
  // below; picking a new one replaces whichever was active.
  type QcFilter =
    | { kind: 'issue'; key: string; label: string }
    | { kind: 'status'; status: ValidationStatus }
    | { kind: 'lga'; group: string }
    | { kind: 'proximity'; bucket: string }
    | { kind: 'flaggedOnly' }
  const [filter, setFilter] = useState<QcFilter | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: QcFormInput) {
    setSubmitting(true)
    setError(null)
    setFilter(null)
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

  const analysis = useMemo<QcAnalysisResult | null>(() => {
    if (!result) return null

    const columns = detectColumns(result.columns)

    return {
      columns,
      totalSettlements: result.records.length,
      totalFlagged: countFlagged(result.records),
      // /qc/validation runs one state at a time, so a "total states" card
      // would always read 1 — LGA is the granularity that actually varies
      // within a single QC result.
      totalLgas: columns.lga ? countUniqueValues(result.records, columns.lga) : 0,
      issueCounts: computeIssueFlagCounts(result.records, QC_ISSUE_FLAGS),
      validationCounts: computeValidationStatusCounts(result.records),
      lgaBreakdown: columns.lga ? computeGroupFlagBreakdown(result.records, columns.lga) : [],
      proximityBreakdown: computeProximityBreakdown(result.records),
      records: result.records,
    }
  }, [result])

  const filteredRecords = useMemo(() => {
    if (!analysis || !filter) return analysis?.records ?? []
    switch (filter.kind) {
      case 'issue':
        return analysis.records.filter((r) => isPresent(r[filter.key]))
      case 'status':
        return analysis.records.filter((r) => r.validation_status === filter.status)
      case 'lga':
        return analysis.columns.lga
          ? analysis.records.filter((r) => String(r[analysis.columns.lga!] ?? '').trim() === filter.group)
          : analysis.records
      case 'proximity':
        return analysis.records.filter((r) => String(r.proximity_issues ?? '').trim() === filter.bucket)
      case 'flaggedOnly':
        return analysis.records.filter((r) => isPresent(r.is_flagged))
      default:
        return analysis.records
    }
  }, [analysis, filter])

  const filterDescription = useMemo(() => {
    if (!filter) return null
    switch (filter.kind) {
      case 'issue':
        return `issue: ${filter.label}`
      case 'status':
        return `status: ${filter.status}`
      case 'lga':
        return `LGA: ${filter.group}`
      case 'proximity':
        return `proximity: ${filter.bucket}`
      case 'flaggedOnly':
        return 'flagged settlements only'
      default:
        return null
    }
  }, [filter])

  // Toggle semantics throughout: clicking the already-active source clears
  // the filter instead of re-applying it, matching the "click to clear" hint
  // StatCard shows once a card is active.
  function toggleIssue(key: string) {
    const label = analysis?.issueCounts.find((c) => c.key === key)?.label ?? key
    setFilter((f) => (f?.kind === 'issue' && f.key === key ? null : { kind: 'issue', key, label }))
  }
  function toggleStatus(status: ValidationStatus) {
    setFilter((f) => (f?.kind === 'status' && f.status === status ? null : { kind: 'status', status }))
  }
  function toggleLga(group: string) {
    setFilter((f) => (f?.kind === 'lga' && f.group === group ? null : { kind: 'lga', group }))
  }
  function toggleProximity(bucket: string) {
    setFilter((f) => (f?.kind === 'proximity' && f.bucket === bucket ? null : { kind: 'proximity', bucket }))
  }
  function toggleFlaggedOnly() {
    setFilter((f) => (f?.kind === 'flaggedOnly' ? null : { kind: 'flaggedOnly' }))
  }

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

      {analysis && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={result?.sourceFilename ?? 'mlos_qc.csv'}
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
            totalSettlements={analysis.totalSettlements}
            totalFlagged={analysis.totalFlagged}
            totalLgas={analysis.totalLgas}
            flaggedOnlyActive={filter?.kind === 'flaggedOnly'}
            onToggleFlaggedOnly={toggleFlaggedOnly}
          />
          <IssueFlagCards
            counts={analysis.issueCounts}
            activeKey={filter?.kind === 'issue' ? filter.key : null}
            onSelect={toggleIssue}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
            <ValidationStatusPie
              counts={analysis.validationCounts}
              activeStatus={filter?.kind === 'status' ? filter.status : null}
              onSelect={toggleStatus}
            />
            <IssueFlagBarChart
              counts={analysis.issueCounts}
              activeKey={filter?.kind === 'issue' ? filter.key : null}
              onSelect={toggleIssue}
            />
          </div>

          <ProximityBreakdownChart
            data={analysis.proximityBreakdown}
            activeBucket={filter?.kind === 'proximity' ? filter.bucket : null}
            onSelect={toggleProximity}
          />

          <LgaFlagBreakdownChart
            data={analysis.lgaBreakdown}
            activeGroup={filter?.kind === 'lga' ? filter.group : null}
            onSelect={toggleLga}
          />
          <QcSettlementListTable
            records={filteredRecords}
            columns={analysis.columns}
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
