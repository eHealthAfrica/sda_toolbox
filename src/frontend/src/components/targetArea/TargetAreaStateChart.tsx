import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TargetAreaStateEntry } from '../../utils/targetAreaAggregate'

interface TargetAreaStateChartProps {
  title: string
  data: TargetAreaStateEntry[]
  primaryLabel: string
  subsetLabel: string
  primaryColor: string
  subsetColor: string
  /** Whether to render the subset series at all — false when no planned list was uploaded, matching how the removed map disabled its planned-list layers. */
  hasSubset: boolean
  activeState: string | null
  onSelect: (state: string) => void
  emptyMessage?: string
}

const ROW_HEIGHT = 26

// Two-series version of h2h/StateCoverageChart.tsx's click-to-select
// pattern: each state's bar(s) are clickable, calling onSelect with that
// state; the parent (TargetAreaPage.tsx) owns the actual selection state
// and toggles it off on a repeat click of the same state, filtering the
// summary cards above by whichever state is active. Non-active bars are
// dimmed rather than hidden, so the full picture stays visible while one
// state is highlighted.
export default function TargetAreaStateChart({
  title,
  data,
  primaryLabel,
  subsetLabel,
  primaryColor,
  subsetColor,
  hasSubset,
  activeState,
  onSelect,
  emptyMessage = 'No state column detected in the response.',
}: TargetAreaStateChartProps) {
  const chartHeight = Math.max(200, data.length * ROW_HEIGHT)

  function handleBarClick(payload?: { state?: string }) {
    if (payload?.state) onSelect(payload.state)
  }

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
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: primaryColor, display: 'inline-block' }} />
            {primaryLabel}
          </span>
          {hasSubset && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: subsetColor, display: 'inline-block' }} />
              {subsetLabel}
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
        {activeState
          ? `Filtering the summary above to ${activeState} — click its bar again, or "Clear" above, to reset.`
          : 'Click a state to filter the summary above to it.'}
      </div>

      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>{emptyMessage}</div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="state" width={130} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip />
              <Bar
                dataKey="primary"
                name={primaryLabel}
                fill={primaryColor}
                barSize={hasSubset ? 10 : 14}
                cursor="pointer"
                onClick={(barData: { payload?: TargetAreaStateEntry }) => handleBarClick(barData?.payload)}
              >
                {data.map((entry) => (
                  <Cell key={entry.state} fillOpacity={activeState && activeState !== entry.state ? 0.35 : 1} />
                ))}
              </Bar>
              {hasSubset && (
                <Bar
                  dataKey="subset"
                  name={subsetLabel}
                  fill={subsetColor}
                  barSize={10}
                  cursor="pointer"
                  onClick={(barData: { payload?: TargetAreaStateEntry }) => handleBarClick(barData?.payload)}
                >
                  {data.map((entry) => (
                    <Cell key={entry.state} fillOpacity={activeState && activeState !== entry.state ? 0.35 : 1} />
                  ))}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
