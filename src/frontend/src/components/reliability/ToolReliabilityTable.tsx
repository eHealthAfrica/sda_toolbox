import type { ToolStats } from '../../types/reliability'
import { TONE_COLORS, formatMs, formatPct, rateTone, relativeTime } from '../../utils/reliability'
import { EmptyNote, thStyle, tdStyle } from './reliabilityShared'

interface ToolReliabilityTableProps {
  tools: ToolStats[]
  target: number
  selectedTool: string | null
  onSelectTool: (tool: string | null) => void
}

// One row per tool, worst first (the backend sorts by counted failures).
// Selecting a row filters the incident list, the crash causes and the recent
// failures below to that tool; selecting it again clears the filter.
export default function ToolReliabilityTable({ tools, target, selectedTool, onSelectTool }: ToolReliabilityTableProps) {
  if (tools.length === 0) return <EmptyNote>No jobs in this window yet.</EmptyNote>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
          <tr>
            <th style={thStyle}>Tool</th>
            <th style={thStyle}>Jobs</th>
            <th style={{ ...thStyle, minWidth: 150 }}>Success rate</th>
            <th style={thStyle}>Failed (counted)</th>
            <th style={thStyle}>Not counted</th>
            <th style={thStyle}>p95 time</th>
            <th style={thStyle}>Last failure</th>
            <th style={thStyle}>Incident</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => {
            const tone = rateTone(t.success_rate, target)
            const selected = selectedTool === t.tool
            return (
              <tr
                key={t.tool}
                aria-selected={selected}
                style={{ background: selected ? '#eaf1fb' : undefined }}
              >
                <td style={tdStyle}>
                  <button
                    type="button"
                    onClick={() => onSelectTool(selected ? null : t.tool)}
                    aria-pressed={selected}
                    title={selected ? 'Clear the tool filter' : 'Filter the sections below to this tool'}
                    style={{
                      background: 'transparent',
                      border: 0,
                      padding: 0,
                      textAlign: 'left',
                      font: 'inherit',
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: 'var(--color-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                </td>
                <td style={tdStyle} className="tabular">
                  {t.total}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 60, height: 6, background: '#EEF2F6', borderRadius: 3 }}>
                      {t.success_rate !== null && (
                        <div style={{ width: `${Math.max(0, Math.min(1, t.success_rate)) * 100}%`, height: '100%', borderRadius: 3, background: TONE_COLORS[tone] }} />
                      )}
                    </div>
                    <span className="tabular" style={{ minWidth: 46, textAlign: 'right', fontWeight: 600, color: TONE_COLORS[tone] }}>
                      {formatPct(t.success_rate)}
                    </span>
                  </div>
                </td>
                <td style={tdStyle} className="tabular">
                  {t.failed_counted}
                </td>
                <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }} className="tabular">
                  {t.failed_excluded}
                </td>
                <td style={tdStyle} className="tabular">
                  {formatMs(t.p95_ms)}
                </td>
                <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{relativeTime(t.last_failure_at)}</td>
                <td style={tdStyle}>
                  {t.open_incident_id ? (
                    <span style={{ color: 'var(--color-critical)', fontWeight: 600 }}>Open</span>
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)' }}>None</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
