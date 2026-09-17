import { useMemo, useState } from 'react'
import Plotly from 'plotly.js-basic-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
import type { DailyPostReport, DailyReportQualifier } from '../../types/dailyReport'
import { reportQualifier } from '../../types/dailyReport'
import { filterReports } from '../../utils/dailyReportAggregate'
import { downloadReportsAsZip } from '../../utils/plotlyExport'

// plotly.js-basic-dist-min covers exactly the trace types this page needs
// (bar + pie) at a fraction of full plotly.js's bundle size — same import
// as components/postImplementation/PostImplementationGallery.tsx; see
// types/plotly-modules.d.ts for why this needs its own ambient module
// declarations.
const Plot = createPlotlyComponent(Plotly)

interface DailyReportGalleryProps {
  reports: DailyPostReport[]
  filterState: string | null
  filterQualifier: DailyReportQualifier | null
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 10,
}

function qualifierLabel(qualifier: DailyReportQualifier): string {
  return qualifier === 'day' ? 'Day' : 'Cumulative'
}

/**
 * Renders the actual Plotly charts for whatever the page's shared
 * State/Qualifier selection currently scopes to — mirrors
 * components/postImplementation/PostImplementationGallery.tsx's live-chart
 * rendering exactly (each `figure` is a raw `{data, layout}` spec straight
 * from the backend, the built-in modebar already offers a "Download plot as
 * a png" button named after the report's own `save_name`), grouped by STATE
 * rather than by state+LGA — DailyReport has no per-LGA report to group by
 * (see types/dailyReport.ts). Nothing renders until a State is selected —
 * a full unfiltered response can carry many reports across every state in
 * the file, and rendering all of them at once by default would be more
 * scroll than gallery.
 */
export default function DailyReportGallery({ reports, filterState, filterQualifier }: DailyReportGalleryProps) {
  const [zipping, setZipping] = useState(false)
  const scoped = useMemo(() => filterReports(reports, filterState, filterQualifier), [reports, filterState, filterQualifier])

  const groupedByState = useMemo(() => {
    const groups = new Map<string, { state: string; reports: DailyPostReport[] }>()
    for (const report of scoped) {
      if (!groups.has(report.state)) groups.set(report.state, { state: report.state, reports: [] })
      groups.get(report.state)!.reports.push(report)
    }
    return Array.from(groups.values()).sort((a, b) => a.state.localeCompare(b.state))
  }, [scoped])

  const zipName = filterState
    ? `${filterState} State${filterQualifier ? ` ${qualifierLabel(filterQualifier)}` : ''} Charts.zip`
    : 'Daily Report Charts.zip'

  async function handleDownloadAll() {
    setZipping(true)
    try {
      await downloadReportsAsZip(scoped, zipName)
    } finally {
      setZipping(false)
    }
  }

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 16, marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Chart gallery</h3>

      {!filterState ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          Select a state above (via a table's filters, a table row, or a "by state" bar) to view its charts.
        </div>
      ) : scoped.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No charts found for {filterState} State{filterQualifier ? ` (${qualifierLabel(filterQualifier)})` : ''}.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Showing {scoped.length.toLocaleString()} chart{scoped.length === 1 ? '' : 's'} across {groupedByState.length.toLocaleString()} state
              {groupedByState.length === 1 ? '' : 's'}.
            </div>
            <button
              type="button"
              disabled={zipping}
              onClick={() => void handleDownloadAll()}
              style={{
                background: zipping ? 'var(--color-text-muted)' : 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '6px 14px',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: zipping ? 'default' : 'pointer',
              }}
            >
              {zipping ? 'Zipping…' : `⬇ Download all ${scoped.length.toLocaleString()} as PNGs (.zip)`}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groupedByState.map((group) => (
              <div key={group.state}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>{group.state} State</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
                  {group.reports.map((report) => (
                    <div key={`${report.state}__${report.level}__${report.save_name}`} style={cardStyle}>
                      <Plot
                        data={report.figure.data}
                        layout={{ ...report.figure.layout, autosize: true, margin: { t: 32, b: 32, l: 32, r: 16 } }}
                        style={{ width: '100%', height: 320 }}
                        useResizeHandler
                        config={{
                          responsive: true,
                          displaylogo: false,
                          toImageButtonOptions: { filename: report.save_name.replace(/\.png$/i, '') },
                        }}
                      />
                      <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 6 }}>
                        {qualifierLabel(reportQualifier(report))} · {report.level === 'state' ? 'State summary pie chart' : 'LGA-breakdown bar chart'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
