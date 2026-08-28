import { useMemo, useState } from 'react'
import Plotly from 'plotly.js-basic-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
import type { PostReport } from '../../types/postImplementation'
import { filterReports } from '../../utils/postImplementationAggregate'
import { downloadReportsAsZip } from '../../utils/plotlyExport'

// plotly.js-basic-dist-min covers exactly the trace types this page needs
// (bar + pie) at a fraction of full plotly.js's bundle size — see
// types/plotly-modules.d.ts for why this needs its own ambient module
// declarations.
const Plot = createPlotlyComponent(Plotly)

interface PostImplementationGalleryProps {
  reports: PostReport[]
  filterState: string | null
  filterLga: string | null
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 10,
}

/**
 * Renders the actual Plotly charts for whatever the page's shared State/LGA
 * selection currently scopes to — the payoff of "selecting an lga on the
 * table should display all corresponding charts relating to the lga" (same
 * for a state): both levels for every in-scope LGA show up here, grouped by
 * LGA so a summary pie chart and its matching breakdown bar chart always sit
 * side by side. Charts are live Plotly components (each `figure` is a raw
 * `{data, layout}` spec straight from the backend, see
 * types/postImplementation.ts), so the built-in modebar already offers a
 * "Download plot as a png" button — no custom image-export code needed here,
 * just naming that download after the report's own `save_name` via
 * `config.toImageButtonOptions`. Nothing renders until a State or LGA is
 * selected — a full unfiltered response can carry hundreds of reports across
 * every LGA in the file, and rendering all of them at once by default would
 * be more scroll than gallery.
 */
export default function PostImplementationGallery({ reports, filterState, filterLga }: PostImplementationGalleryProps) {
  const [zipping, setZipping] = useState(false)
  const scoped = useMemo(() => filterReports(reports, filterState, filterLga), [reports, filterState, filterLga])

  const groupedByLga = useMemo(() => {
    const groups = new Map<string, { state: string; lga: string; reports: PostReport[] }>()
    for (const report of scoped) {
      const key = `${report.state}__${report.lga}`
      if (!groups.has(key)) groups.set(key, { state: report.state, lga: report.lga, reports: [] })
      groups.get(key)!.reports.push(report)
    }
    return Array.from(groups.values()).sort((a, b) => a.state.localeCompare(b.state) || a.lga.localeCompare(b.lga))
  }, [scoped])

  const zipName = filterLga
    ? `${filterState} State, ${filterLga} LGA Charts.zip`
    : `${filterState} State Charts.zip`

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

      {!filterState && !filterLga ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          Select a state or LGA above (via a table's filters, a table row, or a "by state" bar) to view its charts.
        </div>
      ) : scoped.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No charts found for {filterLga ? `${filterLga} LGA` : `${filterState} State`}.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Showing {scoped.length.toLocaleString()} chart{scoped.length === 1 ? '' : 's'} across {groupedByLga.length.toLocaleString()} LGA
              {groupedByLga.length === 1 ? '' : 's'}.
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
            {groupedByLga.map((group) => (
              <div key={`${group.state}__${group.lga}`}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
                  {group.state} State, {group.lga} LGA
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
                  {group.reports.map((report) => (
                    <div key={`${report.state}__${report.lga}__${report.level}`} style={cardStyle}>
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
                        {report.level === 'lga' ? 'LGA summary pie chart' : 'Ward breakdown bar chart'}
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
