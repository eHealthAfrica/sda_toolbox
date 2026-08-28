import { useState } from 'react'
import { submitDipMapMerger } from '../../api/client'
import { buildAnalysis, computePreflight, parseMergedZip } from '../../utils/dipMapMergerParse'
import type { DipMapMergerAnalysis } from '../../types/dipMapMerger'
import type { StateName } from '../../types/h2h'
import { useJobTracker } from '../../state/jobTracker'
import DipMergerForm from './DipMergerForm'
import PreflightNoteCard from './PreflightNoteCard'
import DipMergerTitleCards from './DipMergerTitleCards'
import DipMergerLgaChart from './DipMergerLgaChart'
import MapBookPreview from './MapBookPreview'
import DipMergerTable from './DipMergerTable'

// Microplan · DIP + Map Merger. POST /dip/merger is a genuine match for
// this page — same reasoning as Validate DIP — so this page calls the real
// endpoint and parses its actual response rather than recomputing the merge
// client-side. The one thing the response can't provide (what got silently
// dropped during matching) is computed separately, client-side, from the
// raw files before they're even uploaded — see
// utils/dipMapMergerParse.ts::computePreflight and the top-of-file comment
// in types/dipMapMerger.ts for why that split is necessary.
export default function DipMergerPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<DipMapMergerAnalysis | null>(null)
  const [responseBlob, setResponseBlob] = useState<Blob | null>(null)
  const [selectedLga, setSelectedLga] = useState<string | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(mapsFile: File, dipFile: File, lgas: string, state: StateName | null) {
    setSubmitting(true)
    setError(null)
    const jobId = startJob('microplan-merger', dipFile.name)
    try {
      // Preflight runs against the raw files the user picked, independent of
      // (and before) the network call — it stays accurate even if the
      // upload itself fails.
      const [preflight, blob] = await Promise.all([
        computePreflight(mapsFile, dipFile),
        submitDipMapMerger(mapsFile, dipFile, lgas, state),
      ])
      const books = await parseMergedZip(blob)
      if (books.length === 0) {
        setError('No map books came back in the response — check that the LGA(s)/state match what the two zips actually contain.')
        setAnalysis(null)
        setResponseBlob(null)
        failJob(jobId)
        return
      }
      const result = buildAnalysis(preflight, books)
      setAnalysis(result)
      setResponseBlob(blob)
      setSelectedLga(result.books[0]?.lga ?? null)
      completeJob(jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge these files — check both zips and try again.')
      setAnalysis(null)
      setResponseBlob(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  function handleDownload() {
    if (!responseBlob) return
    const url = URL.createObjectURL(responseBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'DIP LGA Mapbook.zip'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <DipMergerForm onSubmit={handleSubmit} submitting={submitting} />

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

      {analysis && (
        <>
          <PreflightNoteCard preflight={analysis.preflight} />
          <DipMergerTitleCards analysis={analysis} />
          <DipMergerLgaChart analysis={analysis} />
          <MapBookPreview books={analysis.books} selectedLga={selectedLga} onSelect={setSelectedLga} />
          <DipMergerTable analysis={analysis} selectedLga={selectedLga} onSelect={setSelectedLga} onDownload={handleDownload} />
        </>
      )}

      {!analysis && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload the Team Guide Maps and DIP zips above, with either specific LGAs or a state, to generate map books.
        </div>
      )}
    </div>
  )
}
