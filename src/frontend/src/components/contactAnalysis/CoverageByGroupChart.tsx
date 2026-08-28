import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GroupCoverageEntry } from '../../utils/contactAggregate'
import { COVERAGE_COLORS } from '../../utils/colors'
import { SETTLEMENT_COVERAGE_CATEGORIES } from '../../types/contactAnalysis'
import type { SettlementCoverageCategory } from '../../types/contactAnalysis'

interface CoverageByGroupChartProps {
  data: GroupCoverageEntry[]
  title: string
  groupLabel: string
  emptyMessage: string
  // Present at every drill level except the deepest (ward) — see
  // ContactByGroupChart.tsx's identical prop for the shared drill contract.
  onSelect?: (group: string) => void
}

const ROW_HEIGHT = 26

// Coverage breakdown, one row per group at the page's current drill level —
// same stacked-bar shape as REACH's AccessibilityByStateChart, using the
// campaign's own COVERAGE_COLORS/SETTLEMENT_COVERAGE_CATEGORIES (harmonize_coverage
// — the single best coverage value across every compared round).
export default function CoverageByGroupChart({ data, title, groupLabel, emptyMessage, onSelect }: CoverageByGroupChartProps) {
  const chartHeight = Math.max(180, data.length * ROW_HEIGHT)

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14 }}>{title}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(SETTLEMENT_COVERAGE_CATEGORIES as readonly SettlementCoverageCategory[]).map((category) => (
            <span key={category} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: COVERAGE_COLORS[category], display: 'inline-block' }} />
              {category}
            </span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {data.length.toLocaleString()} {groupLabel}
        {onSelect && data.length > 0 ? ' · click a bar to drill down' : ''}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="group" width={110} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip />
              {(SETTLEMENT_COVERAGE_CATEGORIES as readonly SettlementCoverageCategory[]).map((category) => (
                <Bar
                  key={category}
                  dataKey={category}
                  stackId="coverage"
                  fill={COVERAGE_COLORS[category]}
                  barSize={14}
                  cursor={onSelect ? 'pointer' : undefined}
                  onClick={onSelect ? (entry: GroupCoverageEntry) => onSelect(entry.group) : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
