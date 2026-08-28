import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { CountEntry } from '../../utils/aggregate'
import { VALIDATION_STATUS_COLORS } from '../../utils/colors'
import type { ValidationStatus } from '../../types/mlos'

interface ValidationStatusPieProps {
  counts: CountEntry<ValidationStatus>[]
  activeStatus?: ValidationStatus | null
  onSelect?: (status: ValidationStatus) => void
}

// toolbox/mlos/validation/review/run_validate.py's validation_status column:
// Validated / Validation Ongoing / Validated Unknown / Not Validated.
export default function ValidationStatusPie({ counts, activeStatus, onSelect }: ValidationStatusPieProps) {
  const total = counts.reduce((sum, c) => sum + c.count, 0)
  const data = counts.filter((c) => c.count > 0)

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
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Validation status</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {total.toLocaleString()} settlements{onSelect ? ' — click a slice to filter the table below' : ''}
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No validation_status column found in the result.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="category"
              innerRadius={60}
              outerRadius={95}
              paddingAngle={2}
              onClick={(entry: CountEntry<ValidationStatus>) => onSelect?.(entry.category)}
              cursor={onSelect ? 'pointer' : undefined}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.category}
                  fill={VALIDATION_STATUS_COLORS[entry.category]}
                  fillOpacity={!activeStatus || activeStatus === entry.category ? 1 : 0.35}
                  stroke={activeStatus === entry.category ? VALIDATION_STATUS_COLORS[entry.category] : undefined}
                  strokeWidth={activeStatus === entry.category ? 2 : 0}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [
                `${value.toLocaleString()} (${((value / total) * 100).toFixed(1)}%)`,
                name,
              ]}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
