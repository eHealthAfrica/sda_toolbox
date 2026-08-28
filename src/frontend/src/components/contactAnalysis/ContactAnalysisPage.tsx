import { useEffect, useMemo, useState } from 'react'
import { ApiError, submitContactAnalysis } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { parseContactAnalysisCsv } from '../../api/parseResult'
import type { ContactAnalysisFormInput, ContactRecord, ParsedContactAnalysisResult } from '../../types/contactAnalysis'
import { detectColumns } from '../../utils/columns'
import type { DetectedColumns } from '../../utils/columns'
import {
  cellText,
  computeAverageContactProportion,
  computeContactByGroup,
  computeContactCounts,
  computeCoverageByGroup,
  computeCoverageCounts,
  countUniqueColumn,
  countUniqueKeys,
  detectRoundColumns,
  lgaKey,
  wardKey,
} from '../../utils/contactAggregate'
import type {
  ContactCountEntry,
  CoverageCountEntry,
  GroupContactEntry,
  GroupCoverageEntry,
} from '../../utils/contactAggregate'
import ContactAnalysisForm from './ContactAnalysisForm'
import ContactSummaryCards from './ContactSummaryCards'
import ContactCountCards from './ContactCountCards'
import ContactCoverageCards from './ContactCoverageCards'
import ContactByGroupChart from './ContactByGroupChart'
import CoverageByGroupChart from './CoverageByGroupChart'
import ContactMap from './ContactMap'
import ContactSettlementListTable from './ContactSettlementListTable'
import TabbedPanel from '../common/TabbedPanel'

// The shared state -> LGA -> ward drill-down the charts and map participate
// in — same convention as REACH's ReachAnalysisPage.tsx. The settlement
// table (inside the same TabbedPanel as the map) is deliberately NOT scoped
// by this — it owns its own independent State/LGA/Ward/Contacts filter row
// instead, so it can be narrowed directly without clicking through the
// drill-down charts first.
type DrillLevel = 'state' | 'lga' | 'ward'

// Whole-result figures that don't change as the drill selection moves.
interface ContactAnalysis {
  columns: DetectedColumns
  totalSettlements: number
  totalStates: number
  totalLgas: number
  totalWards: number
  // Which columns in this particular response are previous-campaign round
  // columns, recovered from the response itself (see
  // utils/contactAggregate.ts::detectRoundColumns) rather than assumed —
  // the count IS "how many rounds were used," per the input workbook's own
  // sheet count.
  roundColumns: string[]
  totalRounds: number
  records: ContactRecord[]
}

// Everything that DOES change with the drill selection — cards and the two
// by-group charts read from this instead of `analysis` directly.
interface ContactScopedView {
  records: ContactRecord[]
  groupColumn: string | null
  contactCounts: ContactCountEntry[]
  contactByGroup: GroupContactEntry[]
  coverageCounts: CoverageCountEntry[]
  coverageByGroup: GroupCoverageEntry[]
  averageContactProportion: number | null
}

export default function ContactAnalysisPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedContactAnalysisResult | null>(null)
  // The raw CSV response, kept alongside the parsed records purely so the
  // download button can hand back exactly what /contact_analysis produced —
  // same resultBlob convention as ReachAnalysisPage.
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [drillState, setDrillState] = useState<string | null>(null)
  const [drillLga, setDrillLga] = useState<string | null>(null)
  // Which of the map/list views is showing inside the shared TabbedPanel
  // frame below — same convention as H2H/REACH's settlementView, including
  // defaulting to the table (the map is still one click away via the tab).
  const [settlementView, setSettlementView] = useState<'map' | 'list'>('list')
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: ContactAnalysisFormInput) {
    setSubmitting(true)
    setError(null)
    setDrillState(null)
    setDrillLga(null)
    const jobId = startJob('contact-analysis', input.baseFile?.name ?? 'Contact analysis run')
    try {
      const csvBlob = await submitContactAnalysis(input)
      const parsed = await parseContactAnalysisCsv(csvBlob, `${input.baseFile?.name.split('.')[0] ?? 'contact'}_analysis.csv`)
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
        setError('Something went wrong while running the contact analysis.')
      }
      setResult(null)
      setResultBlob(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  // POST /contact_analysis's response is the raw CSV itself (see
  // api/client.ts::submitContactAnalysis) — same download convention as
  // REACH's handleDownloadCsv.
  function handleDownloadCsv() {
    if (!resultBlob) return
    const baseName = (result?.sourceFilename ?? 'contact_analysis').replace(/\.[^./]+$/, '')
    const url = URL.createObjectURL(resultBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${baseName}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const analysis = useMemo<ContactAnalysis | null>(() => {
    if (!result) return null

    const columns = detectColumns(result.columns)
    const records = result.records
    const roundColumns = detectRoundColumns(records, result.columns, [
      columns.state,
      columns.lga,
      columns.ward,
      columns.settlement,
      columns.latitude,
      columns.longitude,
      columns.population,
      columns.accessibility,
    ])

    return {
      columns,
      totalSettlements: records.length,
      totalStates: countUniqueColumn(records, columns.state),
      totalLgas: countUniqueKeys(records, (r) => lgaKey(r, columns.state, columns.lga)),
      totalWards: countUniqueKeys(records, (r) => wardKey(r, columns.state, columns.lga, columns.ward)),
      roundColumns,
      totalRounds: roundColumns.length,
      records,
    }
  }, [result])

  // If a fresh run's data no longer has the previously-selected state (a
  // second, different upload in the same session), fall back to the top
  // level rather than showing an empty scope with a stale breadcrumb — same
  // "clamp on new data" idea as REACH's ReachAnalysisPage.
  useEffect(() => {
    if (!analysis || !drillState) return
    const stillPresent = analysis.records.some((r) => cellText(r, analysis.columns.state) === drillState)
    if (!stillPresent) {
      setDrillState(null)
      setDrillLga(null)
    }
  }, [analysis, drillState])

  const drillLevel: DrillLevel = drillLga ? 'ward' : drillState ? 'lga' : 'state'

  const scoped = useMemo<ContactScopedView | null>(() => {
    if (!analysis) return null
    const { columns, records } = analysis

    let scopedRecords = records
    if (drillState) scopedRecords = scopedRecords.filter((r) => cellText(r, columns.state) === drillState)
    if (drillLga) scopedRecords = scopedRecords.filter((r) => cellText(r, columns.lga) === drillLga)

    const groupColumn = drillLevel === 'state' ? columns.state : drillLevel === 'lga' ? columns.lga : columns.ward

    return {
      records: scopedRecords,
      groupColumn,
      contactCounts: computeContactCounts(scopedRecords),
      contactByGroup: computeContactByGroup(scopedRecords, groupColumn),
      coverageCounts: computeCoverageCounts(scopedRecords),
      coverageByGroup: computeCoverageByGroup(scopedRecords, groupColumn),
      averageContactProportion: computeAverageContactProportion(scopedRecords),
    }
  }, [analysis, drillState, drillLga, drillLevel])

  const groupNoun = drillLevel === 'state' ? 'state' : drillLevel === 'lga' ? 'LGA' : 'ward'
  const groupNounPlural = drillLevel === 'state' ? 'states' : drillLevel === 'lga' ? 'LGAs' : 'wards'
  const scopeSuffix = drillLga ? ` in ${drillState} → ${drillLga}` : drillState ? ` in ${drillState}` : ''

  function handleDrillSelect(group: string) {
    if (drillLevel === 'state') setDrillState(group)
    else if (drillLevel === 'lga') setDrillLga(group)
    // Ward is the deepest level this page drills to — its charts never get
    // an onSelect handler in the first place (see the JSX below).
  }

  return (
    <div>
      <ContactAnalysisForm onSubmit={handleSubmit} submitting={submitting} />

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
          Running contact analysis — triangulating against every previous campaign round can take a while for large
          uploads…
        </div>
      )}

      {analysis && scoped && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <button
                type="button"
                onClick={() => {
                  setDrillState(null)
                  setDrillLga(null)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: drillState ? 'pointer' : 'default',
                  color: drillState ? 'var(--color-primary)' : 'var(--color-text)',
                  fontWeight: drillState ? 400 : 600,
                  textDecoration: drillState ? 'underline' : 'none',
                }}
              >
                All states
              </button>
              {drillState && (
                <>
                  <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                  <button
                    type="button"
                    onClick={() => setDrillLga(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: drillLga ? 'pointer' : 'default',
                      color: drillLga ? 'var(--color-primary)' : 'var(--color-text)',
                      fontWeight: drillLga ? 400 : 600,
                      textDecoration: drillLga ? 'underline' : 'none',
                    }}
                  >
                    {drillState}
                  </button>
                </>
              )}
              {drillLga && (
                <>
                  <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                  <span style={{ fontWeight: 600 }}>{drillLga}</span>
                </>
              )}
            </div>

            {resultBlob && (
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
                ⬇ Download results CSV
              </button>
            )}
          </div>

          <ContactSummaryCards
            totalSettlements={analysis.totalSettlements}
            totalStates={analysis.totalStates}
            totalLgas={analysis.totalLgas}
            totalWards={analysis.totalWards}
            totalRounds={analysis.totalRounds}
          />
          <ContactCountCards
            counts={scoped.contactCounts}
            maxContact={analysis.totalRounds}
            averageContactProportion={scoped.averageContactProportion}
          />
          <ContactCoverageCards counts={scoped.coverageCounts} />

          <ContactByGroupChart
            data={scoped.contactByGroup}
            title={`Average contact by ${groupNoun}${scopeSuffix}`}
            groupLabel={groupNounPlural}
            emptyMessage={`No ${groupNoun} column detected in the result.`}
            maxContact={analysis.totalRounds}
            onSelect={drillLevel !== 'ward' ? handleDrillSelect : undefined}
          />
          <CoverageByGroupChart
            data={scoped.coverageByGroup}
            title={`Coverage by ${groupNoun}${scopeSuffix}`}
            groupLabel={groupNounPlural}
            emptyMessage={`No ${groupNoun} column detected in the result.`}
            onSelect={drillLevel !== 'ward' ? handleDrillSelect : undefined}
          />

          <TabbedPanel
            activeKey={settlementView}
            onChange={(key) => setSettlementView(key as 'map' | 'list')}
            tabs={[
              {
                key: 'map',
                label: 'Map',
                content: (
                  <ContactMap records={scoped.records} columns={analysis.columns} maxContact={analysis.totalRounds} bare />
                ),
              },
              {
                key: 'list',
                label: 'List',
                content: (
                  <ContactSettlementListTable
                    records={analysis.records}
                    columns={analysis.columns}
                    maxContact={analysis.totalRounds}
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
          Upload a baseline settlement list and a previous campaigns workbook above and run the analysis to see
          results here.
        </div>
      )}
    </div>
  )
}
