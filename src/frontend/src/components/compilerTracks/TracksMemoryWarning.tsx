import type { TracksMemoryCheck, MemoryBudgetSource } from '../../utils/browserMemory'
import { formatBytes } from '../../utils/browserMemory'
import type { TracksOriginalCount } from '../../types/compilerTracks'

interface TracksMemoryWarningProps {
  check: TracksMemoryCheck
  downloadUrl: string | null
  filename: string
  originalCount: TracksOriginalCount
}

const BUDGET_SOURCE_LABEL: Record<MemoryBudgetSource, string> = {
  jsHeapSizeLimit: "this browser tab's own reported memory ceiling",
  deviceMemory: "an estimate based on this device's reported memory",
  default: 'a conservative fallback estimate (this browser does not report memory info)',
}

// Shown instead of TracksTitleCards + TracksMap when
// utils/browserMemory.ts::checkTracksMemoryRisk flags the compiled result
// as too large to safely parse and render — thousands of Leaflet markers,
// on top of sql.js's own WASM heap for the parse itself, can freeze or
// crash a tab well before any error is ever thrown, so this skips that step
// entirely rather than finding out the hard way. The file itself is never
// lost — it's offered as a direct download of exactly what the server
// returned, never parsed client-side at all.
export default function TracksMemoryWarning({ check, downloadUrl, filename, originalCount }: TracksMemoryWarningProps) {
  const pct = (check.ratio * 100).toFixed(0)

  return (
    <div
      style={{
        background: '#fff4e5',
        border: '1px solid #f0c987',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
        marginBottom: 16,
        fontSize: 12.5,
        lineHeight: 1.65,
        color: '#7a5000',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#7a5000' }}>
        ⚠ Compiled tracks are too large to safely display on this page
      </div>
      <div style={{ marginBottom: 12 }}>
        The compiled result is {formatBytes(check.rawSizeBytes)}. Parsing and plotting a file this size would need
        roughly {formatBytes(check.estimatedFootprintBytes)} of memory — about {pct}% of {BUDGET_SOURCE_LABEL[check.budgetSource]}{' '}
        (~{formatBytes(check.budgetBytes)}). Rendering it anyway risks freezing or crashing this tab, so it hasn't
        been loaded onto the page.{' '}
        {originalCount.supported && (
          <>The uploaded file had {originalCount.count.toLocaleString()} rows before the server's own filtering. </>
        )}
        Download it instead and open it in GIS software (QGIS, ArcGIS) built to handle datasets this size.
      </div>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={filename}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--color-primary)',
            color: '#fff',
            borderRadius: 'var(--radius-md)',
            padding: '8px 14px',
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          ⬇ Download tracks (.gpkg) — {formatBytes(check.rawSizeBytes)}
        </a>
      )}
    </div>
  )
}
