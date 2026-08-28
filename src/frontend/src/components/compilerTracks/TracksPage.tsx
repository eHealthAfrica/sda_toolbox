import { useEffect, useMemo, useState } from 'react'
import { submitCombineTracks } from '../../api/client'
import { parseTracksGpkg } from '../../api/parseResult'
import { countOriginalTrackRows } from '../../utils/compilerTracksOriginalCount'
import { checkTracksMemoryRisk } from '../../utils/browserMemory'
import type { TracksMemoryCheck } from '../../utils/browserMemory'
import { detectColumns } from '../../utils/columns'
import { computeStateBreakdown } from '../../utils/aggregate'
import type { TracksFormInput, TrackPoint, TracksOriginalCount } from '../../types/compilerTracks'
import { useJobTracker } from '../../state/jobTracker'
import TracksForm from './TracksForm'
import TracksMap from './TracksMap'
import TracksTitleCards from './TracksTitleCards'
import TracksMemoryWarning from './TracksMemoryWarning'
import TracksStateChart from './TracksStateChart'

// Compiler · Tracks. POST /compiler/tracks returns a single un-zipped
// GeoPackage — parseTracksGpkg (api/parseResult.ts) reads it via sql.js the
// same way utils/gpkg.ts already reads Target Area's layers, then this page
// renders every compiled point on a Leaflet map. This page now shows a
// "Dropped Tracks" count alongside "Tracks compiled" — confirmed with the
// user that the filter criteria (speed > 1 m/s or after 4pm, on top of the
// unconditional coordinate-pattern check) is accurate as implemented, even
// though the route's own docstring/docs haven't been updated to say so yet.
// The count is computed by diffing the raw upload (parsed client-side,
// before the request is sent — utils/compilerTracksOriginalCount.ts) against
// what the server actually returned, not by re-implementing the filter's
// pandas/regex logic here. See types/compilerTracks.ts for the full
// reasoning and the original after-4pm finding.
//
// Large compiled results are a separate risk from any of that: parsing the
// response GeoPackage with sql.js and rendering every point as a Leaflet
// marker both happen entirely in this tab's own memory, and a big enough
// result can freeze or crash it well before either step reports an error.
// Before ever calling parseTracksGpkg, the raw response size is checked
// against an estimated memory budget for this browser (see
// utils/browserMemory.ts::checkTracksMemoryRisk) — if it's within 80% of
// that budget, parsing and rendering are skipped entirely and
// TracksMemoryWarning offers the file as a direct download instead.
export default function TracksPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState<TrackPoint[] | null>(null)
  // Full attribute-column list off the parsed result (parseTracksGpkg),
  // kept alongside `points` purely to fuzzy-detect a state column for the
  // chart below — see TracksStateChart.tsx for why this is a best-effort
  // detection rather than a true spatial join.
  const [columns, setColumns] = useState<string[] | null>(null)
  const [originalCount, setOriginalCount] = useState<TracksOriginalCount | null>(null)
  // The raw .gpkg blob POST /compiler/tracks returned (a single un-zipped
  // GeoPackage, not a zip — see api/client.ts::submitCombineTracks) — kept
  // alongside the parsed points purely so "Download results" hands back the
  // server's actual file rather than reconstructing one from parsed points.
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [sourceName, setSourceName] = useState<string | null>(null)
  // Set as soon as a result comes back, before any parsing is attempted —
  // its `isRisky` flag is what decides whether parseTracksGpkg even runs
  // this time. Null only before the first successful run.
  const [memoryRisk, setMemoryRisk] = useState<TracksMemoryCheck | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: TracksFormInput) {
    if (!input.tracksFile) return
    setSubmitting(true)
    setError(null)
    setPoints(null)
    setColumns(null)
    setOriginalCount(null)
    setResultBlob(null)
    setMemoryRisk(null)
    const jobId = startJob('compiler-tracks', input.tracksFile.name)
    try {
      const [blob, originalCountResult] = await Promise.all([
        submitCombineTracks(input),
        countOriginalTrackRows(input.tracksFile, input.tracksExtension),
      ])
      const risk = checkTracksMemoryRisk(blob.size)
      setMemoryRisk(risk)
      setOriginalCount(originalCountResult)
      setResultBlob(blob)
      setSourceName(input.tracksFile.name.split('.')[0] ?? 'tracks')
      if (risk.isRisky) {
        // Deliberately skip parseTracksGpkg here — loading the whole result
        // into sql.js's WASM heap is itself part of the risk this check
        // exists to avoid, not just the marker rendering after it.
        setPoints([])
      } else {
        const parsed = await parseTracksGpkg(blob)
        setPoints(parsed.points)
        setColumns(parsed.columns)
      }
      completeJob(jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compile these tracks — check the file and try again.')
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  // Best-effort state grouping for the chart below — detectColumns() runs
  // the same fuzzy matcher used elsewhere in the app (H2H/REACH/MLoS's own
  // state/LGA charts) against whatever raw attribute columns this track
  // file's own records carry. When no state column is present, stateColumn
  // is null and TracksStateChart shows its own empty state rather than this
  // page guessing or attempting a spatial join.
  const stateColumn = useMemo(() => (columns ? detectColumns(columns).state : null), [columns])
  const stateBreakdown = useMemo(
    () => (points && stateColumn ? computeStateBreakdown(points.map((p) => p.raw), stateColumn) : []),
    [points, stateColumn],
  )

  const downloadUrl = useMemo(() => (resultBlob ? URL.createObjectURL(resultBlob) : null), [resultBlob])
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    }
  }, [downloadUrl])

  return (
    <div>
      <TracksForm onSubmit={handleSubmit} submitting={submitting} />

      {error && (
        <div
          style={{
            background: '#fbe6e6',
            border: '1px solid #f0b8b8',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 12.5,
            color: 'var(--color-critical)',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {submitting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Combining tracks…
        </div>
      )}

      {!submitting && memoryRisk?.isRisky && resultBlob && (
        <TracksMemoryWarning
          check={memoryRisk}
          downloadUrl={downloadUrl}
          filename={`${sourceName ?? 'tracks'}_combined.gpkg`}
          originalCount={originalCount ?? { supported: false, count: 0 }}
        />
      )}

      {!memoryRisk?.isRisky && points && points.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={`${sourceName ?? 'tracks'}_combined.gpkg`}
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
                ⬇ Download results (.gpkg)
              </a>
            )}
          </div>
          <TracksTitleCards count={points.length} originalCount={originalCount ?? { supported: false, count: 0 }} />
          <TracksStateChart data={stateBreakdown} />
          <TracksMap points={points} />
        </>
      )}

      {!memoryRisk?.isRisky && points && points.length === 0 && !submitting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          The server returned no track points for this run.
        </div>
      )}

      {!resultBlob && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a tracks file above to combine it into one dataset and view it on the map.
        </div>
      )}
    </div>
  )
}
