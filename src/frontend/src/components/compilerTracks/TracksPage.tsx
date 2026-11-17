import { useEffect, useMemo, useState } from 'react'
import { submitCombineTracks } from '../../api/client'
import { formatBytes } from '../../utils/checkout'
import type { TracksFormInput } from '../../types/compilerTracks'
import { useJobTracker } from '../../state/jobTracker'
import TracksForm from './TracksForm'

// Compiler · Tracks. POST /compiler/tracks returns a single un-zipped GeoPackage. This page only hands that
// file back as a download: it is not parsed, counted or drawn in the browser. Reading the GeoPackage with sql.js
// and putting every point on a map cost far more time and memory than they were worth for large track sets, and
// the compiled file is opened in GIS software anyway.
//
// Switched off, not deleted: TracksMap, TracksTitleCards, TracksStateChart, TracksMemoryWarning,
// api/parseResult.ts::parseTracksGpkg and utils/compilerTracksOriginalCount.ts are untouched and unused, so the
// preview can be restored by reverting this file.
interface CompiledTracks {
  blob: Blob
  fileName: string
}

export default function TracksPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompiledTracks | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: TracksFormInput) {
    if (!input.tracksFile) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    const jobId = startJob('compiler-tracks', input.tracksFile.name)
    try {
      const blob = await submitCombineTracks(input)
      if (blob.size === 0) {
        throw new Error('The server returned an empty file for this run.')
      }
      setResult({ blob, fileName: `${input.tracksFile.name.split('.')[0] || 'tracks'}_combined.gpkg` })
      completeJob(jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compile these tracks — check the file and try again.')
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  const downloadUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result])
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

      {!submitting && result && downloadUrl && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Combined tracks are ready</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
              📄 {result.fileName} — {formatBytes(result.blob.size)}
            </div>
          </div>
          <a
            href={downloadUrl}
            download={result.fileName}
            style={{
              background: 'var(--color-primary)',
              color: '#fff',
              borderRadius: 'var(--radius-md)',
              padding: '9px 20px',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            ⬇ Download combined tracks (.gpkg)
          </a>
        </div>
      )}

      {!result && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a tracks file above to combine it into one GeoPackage you can download.
        </div>
      )}
    </div>
  )
}
