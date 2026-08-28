import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { CombineAnalysis, SettlementRecord, SpecialPlaceRecord } from '../../types/microplan'
import Pager from '../common/Pager'

interface MicroplanRecordsTableProps {
  analysis: CombineAnalysis
  onDownload: () => void
}

type Tab = 'settlements' | 'specialPlaces'

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
const selectStyle: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 10px',
  fontSize: 12.5,
  background: '#fbfbfc',
  minWidth: 140,
}

const ACCESSIBILITY_COLOR: Record<string, string> = {
  'Fully Accessible': 'var(--color-good)',
  'Partially Accessible': 'var(--color-warning)',
  Inaccessible: 'var(--color-critical)',
}
const CATEGORY_COLOR: Record<string, string> = {
  rural: '#e7f0fa',
  scattered: '#fdeee0',
  urban: '#eae5fb',
}
const CATEGORY_TEXT: Record<string, string> = {
  rural: 'var(--color-primary)',
  scattered: '#a15c1d',
  urban: '#5b3ea6',
}

function Badge({ label, background, color }: { label: string; background: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 600, background, color }}>
      {label}
    </span>
  )
}

// Tabbed Settlements / Special Places table — 20 rows per page (matches the
// approved design's pagination limit for both sheets). Filters cascade
// LGA → Ward; the third filter is Category for Settlements, Type for
// Special Places.
export default function MicroplanRecordsTable({ analysis, onDownload }: MicroplanRecordsTableProps) {
  const [tab, setTab] = useState<Tab>('settlements')
  const [lgaFilter, setLgaFilter] = useState('')
  const [wardFilter, setWardFilter] = useState('')
  const [thirdFilter, setThirdFilter] = useState('')
  const [page, setPage] = useState(0)

  const lgaOptions = useMemo(() => Array.from(new Set(analysis.settlements.map((s) => s.lga))).sort(), [analysis.settlements])
  const wardOptions = useMemo(
    () =>
      Array.from(
        new Set(analysis.settlements.filter((s) => !lgaFilter || s.lga === lgaFilter).map((s) => s.ward)),
      ).sort(),
    [analysis.settlements, lgaFilter],
  )
  const categoryOptions = useMemo(() => analysis.categoryBreakdown.map((b) => b.label), [analysis.categoryBreakdown])
  const typeOptions = useMemo(() => analysis.specialPlaceTypeBreakdown.map((b) => b.label), [analysis.specialPlaceTypeBreakdown])

  function resetFiltersOnTabChange(nextTab: Tab) {
    setTab(nextTab)
    setLgaFilter('')
    setWardFilter('')
    setThirdFilter('')
    setPage(0)
  }

  function updateFilter(setter: (v: string) => void, value: string) {
    setter(value)
    setPage(0)
  }

  const filteredSettlements = useMemo<SettlementRecord[]>(
    () =>
      analysis.settlements.filter(
        (s) => (!lgaFilter || s.lga === lgaFilter) && (!wardFilter || s.ward === wardFilter) && (!thirdFilter || s.category === thirdFilter),
      ),
    [analysis.settlements, lgaFilter, wardFilter, thirdFilter],
  )
  const filteredSpecialPlaces = useMemo<SpecialPlaceRecord[]>(
    () =>
      analysis.specialPlaces.filter(
        (s) => (!lgaFilter || s.lga === lgaFilter) && (!wardFilter || s.ward === wardFilter) && (!thirdFilter || s.type === thirdFilter),
      ),
    [analysis.specialPlaces, lgaFilter, wardFilter, thirdFilter],
  )

  const totalCount = tab === 'settlements' ? filteredSettlements.length : filteredSpecialPlaces.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageSettlements = filteredSettlements.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)
  const pageSpecialPlaces = filteredSpecialPlaces.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)

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
        {(['settlements', 'specialPlaces'] as Tab[]).map((t) => (
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
            {t === 'settlements' ? `Settlements (${analysis.settlementCount.toLocaleString()})` : `Special Places (${analysis.specialPlaceCount.toLocaleString()})`}
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
        <select style={selectStyle} value={thirdFilter} onChange={(e) => updateFilter(setThirdFilter, e.target.value)}>
          <option value="">{tab === 'settlements' ? 'Category: All' : 'Type: All'}</option>
          {(tab === 'settlements' ? categoryOptions : typeOptions).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
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
          ⬇ Download combined workbook (.xlsx)
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        {tab === 'settlements' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['LGA', 'Ward', 'Settlement Name', 'Habitation', 'Accessibility', 'Category', 'Population', 'Team', 'Days'].map((h) => (
                  <th key={h} style={thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageSettlements.map((s) => (
                <tr key={s.settlementGuid}>
                  <td style={tdStyle}>{s.lga}</td>
                  <td style={tdStyle}>{s.ward}</td>
                  <td style={tdStyle}>{s.settlementName}</td>
                  <td style={tdStyle}>{s.habitation}</td>
                  <td style={tdStyle}>
                    <Badge label={s.accessibility} background="transparent" color={ACCESSIBILITY_COLOR[s.accessibility] ?? 'var(--color-text)'} />
                  </td>
                  <td style={tdStyle}>
                    <Badge label={s.category} background={CATEGORY_COLOR[s.category] ?? '#eef1f4'} color={CATEGORY_TEXT[s.category] ?? 'var(--color-text-muted)'} />
                  </td>
                  <td style={tdStyle}>{s.population.toLocaleString()}</td>
                  <td style={tdStyle}>{s.team}</td>
                  <td style={tdStyle}>{s.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['LGA', 'Ward', 'Special Place', 'Type'].map((h) => (
                  <th key={h} style={thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageSpecialPlaces.map((sp, i) => (
                <tr key={`${sp.source}-${sp.specialPlace}-${i}`}>
                  <td style={tdStyle}>{sp.lga}</td>
                  <td style={tdStyle}>{sp.ward}</td>
                  <td style={tdStyle}>{sp.specialPlace}</td>
                  <td style={tdStyle}>{sp.type}</td>
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
        pageCount={tab === 'settlements' ? pageSettlements.length : pageSpecialPlaces.length}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
      />
    </div>
  )
}
