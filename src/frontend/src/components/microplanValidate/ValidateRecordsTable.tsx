import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ValidateDipAnalysis } from '../../types/microplanValidate'
import Pager from '../common/Pager'

interface ValidateRecordsTableProps {
  analysis: ValidateDipAnalysis
  onDownload: () => void
}

type Tab = 'dip' | 'ward' | 'team'
type FlagFilter = 'all' | 'issues' | 'clean'

const PAGE_SIZE = 20

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
  fontSize: 12,
  whiteSpace: 'nowrap',
}
const tdWrapStyle: CSSProperties = { ...tdStyle, whiteSpace: 'normal', maxWidth: 280 }
const selectStyle: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 10px',
  fontSize: 12.5,
  background: '#fbfbfc',
  minWidth: 140,
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 20,
        fontSize: 10.5,
        fontWeight: 600,
        background: ok ? '#e6f6e6' : '#fbe6e6',
        color: ok ? 'var(--color-good)' : 'var(--color-critical)',
      }}
    >
      {label}
    </span>
  )
}

// Tabbed DIP Rows / Ward Review / Team Review — one tab per sheet in the
// real /dip/validator response, 20 rows/page, matching the approved design.
// The download button re-downloads the ACTUAL backend response blob
// (see ValidateDipPage) rather than rebuilding a workbook client-side —
// unlike Combine DMP, there's nothing to rebuild since the backend already
// returns the exact file.
export default function ValidateRecordsTable({ analysis, onDownload }: ValidateRecordsTableProps) {
  const [tab, setTab] = useState<Tab>('dip')
  const [lgaFilter, setLgaFilter] = useState('')
  const [wardFilter, setWardFilter] = useState('')
  const [flagFilter, setFlagFilter] = useState<FlagFilter>('all')
  const [page, setPage] = useState(0)

  const lgaOptions = useMemo(() => {
    const source = tab === 'dip' ? analysis.dipRows : tab === 'ward' ? analysis.wardReviews : analysis.teamReviews
    return Array.from(new Set(source.map((r) => r.lga))).sort()
  }, [analysis, tab])

  const wardOptions = useMemo(() => {
    const source = tab === 'dip' ? analysis.dipRows : tab === 'ward' ? analysis.wardReviews : analysis.teamReviews
    return Array.from(new Set(source.filter((r) => !lgaFilter || r.lga === lgaFilter).map((r) => r.ward))).sort()
  }, [analysis, tab, lgaFilter])

  function resetFiltersOnTabChange(nextTab: Tab) {
    setTab(nextTab)
    setLgaFilter('')
    setWardFilter('')
    setFlagFilter('all')
    setPage(0)
  }

  function updateFilter<T>(setter: (v: T) => void, value: T) {
    setter(value)
    setPage(0)
  }

  const filteredDip = useMemo(
    () =>
      analysis.dipRows.filter(
        (r) =>
          (!lgaFilter || r.lga === lgaFilter) &&
          (!wardFilter || r.ward === wardFilter) &&
          (flagFilter === 'all' || (flagFilter === 'issues' ? r.teamCodeValidation !== null : r.teamCodeValidation === null)),
      ),
    [analysis.dipRows, lgaFilter, wardFilter, flagFilter],
  )
  const filteredWard = useMemo(
    () =>
      analysis.wardReviews.filter(
        (r) =>
          (!lgaFilter || r.lga === lgaFilter) &&
          (!wardFilter || r.ward === wardFilter) &&
          (flagFilter === 'all' || (flagFilter === 'issues' ? r.teamCountValidation !== null : r.teamCountValidation === null)),
      ),
    [analysis.wardReviews, lgaFilter, wardFilter, flagFilter],
  )
  const filteredTeam = useMemo(
    () =>
      analysis.teamReviews.filter(
        (r) =>
          (!lgaFilter || r.lga === lgaFilter) &&
          (!wardFilter || r.ward === wardFilter) &&
          (flagFilter === 'all' || (flagFilter === 'issues' ? r.missingDays !== null : r.missingDays === null)),
      ),
    [analysis.teamReviews, lgaFilter, wardFilter, flagFilter],
  )

  const totalCount = tab === 'dip' ? filteredDip.length : tab === 'ward' ? filteredWard.length : filteredTeam.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageDip = filteredDip.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)
  const pageWard = filteredWard.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)
  const pageTeam = filteredTeam.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)
  const pageCount = tab === 'dip' ? pageDip.length : tab === 'ward' ? pageWard.length : pageTeam.length

  const flagFilterLabel =
    tab === 'dip' ? ['All', 'Flagged only', 'Clean only'] : tab === 'ward' ? ['All', 'Understaffed only', 'Fully staffed only'] : ['All', 'Missing a day only', 'Complete only']

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['dip', 'ward', 'team'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => resetFiltersOnTabChange(t)}
            style={{
              padding: '7px 16px',
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              background: tab === t ? 'var(--color-primary)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--color-text-muted)',
            }}
          >
            {t === 'dip'
              ? `DIP Rows (${analysis.dipRows.length.toLocaleString()})`
              : t === 'ward'
                ? `Ward Review (${analysis.wardReviews.length.toLocaleString()})`
                : `Team Review (${analysis.teamReviews.length.toLocaleString()})`}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <select style={selectStyle} value={lgaFilter} onChange={(e) => { updateFilter(setLgaFilter, e.target.value); setWardFilter('') }}>
          <option value="">LGA: All</option>
          {lgaOptions.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select style={selectStyle} value={wardFilter} onChange={(e) => updateFilter(setWardFilter, e.target.value)}>
          <option value="">Ward: All</option>
          {wardOptions.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <select style={selectStyle} value={flagFilter} onChange={(e) => updateFilter(setFlagFilter, e.target.value as FlagFilter)}>
          <option value="all">Flag: {flagFilterLabel[0]}</option>
          <option value="issues">{flagFilterLabel[1]}</option>
          <option value="clean">{flagFilterLabel[2]}</option>
        </select>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDownload}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-primary)',
            color: 'var(--color-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ⬇ Download DIP Review workbook (.xlsx)
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        {tab === 'dip' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['LGA', 'Ward', 'Settlement Name', 'Team Code', 'Day of Activity', 'Team Code Validation'].map((h) => (
                  <th key={h} style={thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageDip.map((r, i) => (
                <tr key={`${r.settlementId}-${r.teamCode}-${i}`}>
                  <td style={tdStyle}>{r.lga}</td>
                  <td style={tdStyle}>{r.ward}</td>
                  <td style={tdStyle}>{r.settlementName}</td>
                  <td style={tdStyle}>{r.teamCode}</td>
                  <td style={tdStyle}>{r.dayOfActivity}</td>
                  <td style={tdStyle}>
                    <Pill ok={r.teamCodeValidation === null} label={r.teamCodeValidation ?? 'OK'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'ward' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['LGA', 'Ward', 'Settlements', 'Team Allocation', 'Expected Teams', 'DIP Teams', 'Team Count Validation', 'Missing Teams'].map((h) => (
                  <th key={h} style={thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageWard.map((r, i) => (
                <tr key={`${r.lga}-${r.ward}-${i}`}>
                  <td style={tdStyle}>{r.lga}</td>
                  <td style={tdStyle}>{r.ward}</td>
                  <td style={tdStyle}>{r.settlements.toLocaleString()}</td>
                  <td style={tdStyle}>{r.teamAllocation ?? '—'}</td>
                  <td style={tdStyle}>{r.expectedTeams?.toLocaleString() ?? '—'}</td>
                  <td style={tdStyle}>{r.dipTeams.toLocaleString()}</td>
                  <td style={tdStyle}>
                    {r.teamCountValidation ? <Pill ok={false} label={r.teamCountValidation} /> : <Pill ok label="OK" />}
                  </td>
                  <td style={tdWrapStyle}>{r.missingTeams ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'team' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['LGA', 'Ward', 'Team Code', 'Settlements', 'Visit Days', 'Missing Days'].map((h) => (
                  <th key={h} style={thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageTeam.map((r, i) => (
                <tr key={`${r.lga}-${r.ward}-${r.teamCode}-${i}`}>
                  <td style={tdStyle}>{r.lga}</td>
                  <td style={tdStyle}>{r.ward}</td>
                  <td style={tdStyle}>{r.teamCode}</td>
                  <td style={tdStyle}>{r.settlements.toLocaleString()}</td>
                  <td style={tdStyle}>{r.visitDays}</td>
                  <td style={tdStyle}>
                    {r.missingDays ? <Pill ok={false} label={r.missingDays} /> : <Pill ok label="OK" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pager
        page={clampedPage}
        totalPages={totalPages}
        totalCount={totalCount}
        pageCount={pageCount}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
      />
    </div>
  )
}
