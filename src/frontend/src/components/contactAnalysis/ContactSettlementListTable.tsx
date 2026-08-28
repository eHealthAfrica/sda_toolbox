import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ContactRecord } from '../../types/contactAnalysis'
import type { DetectedColumns } from '../../utils/columns'
import { cellText } from '../../utils/contactAggregate'
import { COVERAGE_COLORS, UNKNOWN_COLOR, getContactCountColor } from '../../utils/colors'
import type { SettlementCoverageCategory } from '../../types/contactAnalysis'
import Pager from '../common/Pager'

interface ContactSettlementListTableProps {
  records: ContactRecord[]
  columns: DetectedColumns
  maxContact: number
  contactColumn?: string
  contactProportionColumn?: string
  coverageColumn?: string
  // When true, skip this component's own outer card (background/border/
  // shadow/padding) — used when a parent (TabbedPanel) already supplies one
  // shared frame for this and a sibling view (see ContactAnalysisPage.tsx).
  bare?: boolean
}

const PAGE_SIZE = 20

function cellValue(record: ContactRecord, column: string | null): string {
  if (!column) return '—'
  const raw = record[column]
  if (raw === null || raw === undefined || raw === '') return '—'
  return String(raw)
}

function Dot({ color }: { color: string }) {
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6 }} />
}

function uniqueSorted(records: ContactRecord[], column: string | null): string[] {
  if (!column) return []
  const values = new Set<string>()
  for (const record of records) {
    const value = cellText(record, column)
    if (value) values.add(value)
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

const selectStyle: CSSProperties = {
  padding: '5px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
}
const filterLabelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
  marginBottom: 3,
  display: 'block',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--color-text-muted)',
  fontWeight: 600,
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}
const tdStyle: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 12.5,
}

// Row-level companion to the cards/charts above — independent of those
// charts' shared state -> LGA -> ward drill selection (see
// ContactAnalysisPage.tsx), this table owns its own State/LGA/Ward/Contacts
// filter row so it can be narrowed directly without needing to click through
// the drill-down charts first. LGA options narrow to whichever State is
// selected, and Ward options narrow to whichever State+LGA is selected —
// picking a new State clears any LGA/Ward selection that no longer applies.
export default function ContactSettlementListTable({
  records,
  columns,
  maxContact,
  contactColumn = 'contact',
  contactProportionColumn = 'contact_proportion',
  coverageColumn = 'coverage',
  bare,
}: ContactSettlementListTableProps) {
  const [page, setPage] = useState(0)
  const [filterState, setFilterState] = useState<string | null>(null)
  const [filterLga, setFilterLga] = useState<string | null>(null)
  const [filterWard, setFilterWard] = useState<string | null>(null)
  const [filterContact, setFilterContact] = useState<number | null>(null)

  const stateOptions = useMemo(() => uniqueSorted(records, columns.state), [records, columns.state])

  const recordsInState = useMemo(
    () => (filterState ? records.filter((r) => cellText(r, columns.state) === filterState) : records),
    [records, columns.state, filterState],
  )
  const lgaOptions = useMemo(() => uniqueSorted(recordsInState, columns.lga), [recordsInState, columns.lga])

  const recordsInLga = useMemo(
    () => (filterLga ? recordsInState.filter((r) => cellText(r, columns.lga) === filterLga) : recordsInState),
    [recordsInState, columns.lga, filterLga],
  )
  const wardOptions = useMemo(() => uniqueSorted(recordsInLga, columns.ward), [recordsInLga, columns.ward])

  const contactOptions = useMemo(() => {
    const values = new Set<number>()
    for (const record of records) {
      const raw = record[contactColumn]
      if (typeof raw === 'number' && Number.isFinite(raw)) values.add(raw)
    }
    return Array.from(values).sort((a, b) => a - b)
  }, [records, contactColumn])

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (filterState && cellText(record, columns.state) !== filterState) return false
      if (filterLga && cellText(record, columns.lga) !== filterLga) return false
      if (filterWard && cellText(record, columns.ward) !== filterWard) return false
      if (filterContact !== null) {
        const raw = record[contactColumn]
        if (typeof raw !== 'number' || raw !== filterContact) return false
      }
      return true
    })
  }, [records, columns, filterState, filterLga, filterWard, filterContact, contactColumn])

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageRecords = useMemo(
    () => filteredRecords.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [filteredRecords, clampedPage],
  )

  const hasActiveFilter = filterState || filterLga || filterWard || filterContact !== null

  function handleStateChange(value: string) {
    setFilterState(value || null)
    setFilterLga(null)
    setFilterWard(null)
    setPage(0)
  }
  function handleLgaChange(value: string) {
    setFilterLga(value || null)
    setFilterWard(null)
    setPage(0)
  }
  function handleWardChange(value: string) {
    setFilterWard(value || null)
    setPage(0)
  }
  function handleContactChange(value: string) {
    setFilterContact(value === '' ? null : Number(value))
    setPage(0)
  }
  function clearFilters() {
    setFilterState(null)
    setFilterLga(null)
    setFilterWard(null)
    setFilterContact(null)
    setPage(0)
  }

  return (
    <div
      style={
        bare
          ? undefined
          : {
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-sm)',
              padding: 16,
              marginBottom: 24,
            }
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14 }}>Settlement list</h3>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {filteredRecords.length.toLocaleString()} of {records.length.toLocaleString()} settlements
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <label style={filterLabelStyle}>State</label>
          <select style={selectStyle} value={filterState ?? ''} onChange={(e) => handleStateChange(e.target.value)}>
            <option value="">All states</option>
            {stateOptions.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>LGA</label>
          <select style={selectStyle} value={filterLga ?? ''} onChange={(e) => handleLgaChange(e.target.value)}>
            <option value="">All LGAs</option>
            {lgaOptions.map((lga) => (
              <option key={lga} value={lga}>
                {lga}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>Ward</label>
          <select style={selectStyle} value={filterWard ?? ''} onChange={(e) => handleWardChange(e.target.value)}>
            <option value="">All wards</option>
            {wardOptions.map((ward) => (
              <option key={ward} value={ward}>
                {ward}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>Contacts</label>
          <select style={selectStyle} value={filterContact ?? ''} onChange={(e) => handleContactChange(e.target.value)}>
            <option value="">All</option>
            {contactOptions.map((contact) => (
              <option key={contact} value={contact}>
                {contact} of {maxContact}
              </option>
            ))}
          </select>
        </div>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={clearFilters}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '6px 0',
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {filteredRecords.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No settlements match the current filters.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>State</th>
                  <th style={thStyle}>LGA</th>
                  <th style={thStyle}>Ward</th>
                  <th style={thStyle}>Settlement</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Contact Proportion</th>
                  <th style={thStyle}>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {pageRecords.map((record, i) => {
                  const contactRaw = record[contactColumn]
                  const contact = typeof contactRaw === 'number' ? contactRaw : null
                  const proportionRaw = record[contactProportionColumn]
                  const proportion = typeof proportionRaw === 'number' ? proportionRaw : null
                  const coverage = cellValue(record, coverageColumn)
                  const coverageColor = COVERAGE_COLORS[coverage as SettlementCoverageCategory]
                  return (
                    <tr key={clampedPage * PAGE_SIZE + i}>
                      <td style={tdStyle}>{cellValue(record, columns.state)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.lga)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.ward)}</td>
                      <td style={tdStyle}>{cellValue(record, columns.settlement)}</td>
                      <td style={tdStyle}>
                        {contact !== null && <Dot color={getContactCountColor(contact, maxContact)} />}
                        {contact !== null ? `${contact} of ${maxContact}` : '—'}
                      </td>
                      <td style={tdStyle}>{proportion !== null ? `${(proportion * 100).toFixed(0)}%` : '—'}</td>
                      <td style={tdStyle}>
                        {coverage !== '—' && <Dot color={coverageColor ?? UNKNOWN_COLOR} />}
                        {coverage}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager
            page={clampedPage}
            totalPages={totalPages}
            totalCount={filteredRecords.length}
            pageCount={pageRecords.length}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />
        </>
      )}
    </div>
  )
}
