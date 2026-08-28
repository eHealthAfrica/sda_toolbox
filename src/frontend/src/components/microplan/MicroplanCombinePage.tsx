import { useState } from 'react'
import type { CombineAnalysis, DipExpansion } from '../../types/microplan'
import { parseDmpArchive } from '../../utils/microplanCombine'
import { buildAndDownloadWorkbook } from '../../utils/microplanWorkbook'
import DmpCombineForm from './DmpCombineForm'
import IngestManifestPanel from './IngestManifestPanel'
import MicroplanTitleCards from './MicroplanTitleCards'
import CompositionBreakdown from './CompositionBreakdown'
import TeamCoverageDrilldown from './TeamCoverageDrilldown'
import MicroplanRecordsTable from './MicroplanRecordsTable'

// Microplan · Combine DMP Files. See the long comment at the top of
// types/microplan.ts for why the analysis below is computed entirely
// client-side (parseDmpArchive) rather than by calling
// POST /aggregator/dmp/combine and reading its response — the route as
// currently written in the repo doesn't produce the Settlements/Special
// Places shape this page (and the sample output_example.xlsx) use.
export default function MicroplanCombinePage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<CombineAnalysis | null>(null)
  const [dip, setDip] = useState<DipExpansion>('keep')

  async function handleSubmit(file: File, dipSetting: DipExpansion) {
    setSubmitting(true)
    setError(null)
    setDip(dipSetting)
    try {
      const result = await parseDmpArchive(file, dipSetting)
      if (result.settlementCount === 0) {
        setError('No settlement rows were found in this archive — check that it\'s a zip of zipped LGA folders containing ward-level CSVs.')
        setAnalysis(null)
        return
      }
      setAnalysis(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this archive — is it a valid .zip file?')
      setAnalysis(null)
    } finally {
      setSubmitting(false)
    }
  }

  function handleDownload() {
    if (!analysis) return
    buildAndDownloadWorkbook(analysis, dip)
  }

  return (
    <div>
      <DmpCombineForm onSubmit={handleSubmit} submitting={submitting} />

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
          <IngestManifestPanel manifest={analysis.manifest} />
          <MicroplanTitleCards analysis={analysis} />
          <CompositionBreakdown analysis={analysis} />
          <TeamCoverageDrilldown teamsByLga={analysis.teamsByLga} />
          <MicroplanRecordsTable analysis={analysis} onDownload={handleDownload} />
        </>
      )}

      {!analysis && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a zipped DMP folder above to see the combined Settlements and Special Places breakdown.
        </div>
      )}
    </div>
  )
}
