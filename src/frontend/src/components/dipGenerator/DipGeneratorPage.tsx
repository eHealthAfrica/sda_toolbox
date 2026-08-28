import { useRef, useState } from 'react'
import { submitDipGenerator } from '../../api/client'
import {
  buildAnalysis,
  buildFinalZip,
  buildIngestNote,
  extractGeneratorZipEntries,
  makeBatchId,
  parseFileRows,
  splitDipFileByLga,
} from '../../utils/dipGeneratorParse'
import type { DipBatch, DipGeneratorAnalysis, IngestNote } from '../../types/dipGenerator'
import type { AppView } from '../layout/AppShell'
import { useJobTracker } from '../../state/jobTracker'
import DipGeneratorForm from './DipGeneratorForm'
import GenerationProgressCard from './GenerationProgressCard'
import IngestNoteCard from './IngestNoteCard'
import DipGeneratorTitleCards from './DipGeneratorTitleCards'
import DipGeneratorLgaChart from './DipGeneratorLgaChart'
import TeamDipPreview from './TeamDipPreview'
import TeamDipTable from './TeamDipTable'

interface DipGeneratorPageProps {
  onNavigate: (view: AppView) => void
}

// Microplan · DIP Generator. POST /dip/generator is a genuine match — see
// the top-of-file comment in types/dipGenerator.ts — but this page adds two
// things the raw endpoint doesn't offer on its own: an ingest note computed
// from the raw upload (mirroring prepare_dip_data's drop condition), and
// client-side batching + a real progress bar, since the route has no
// lgas/state param and generates every team's PDF in one blocking call.
// Batches run sequentially (not in parallel) so progress reads as real
// incremental work rather than a burst of concurrent requests hitting the
// backend at once.
//
// validate_dip=True note (code-traced, not live-reproduced — the sandbox
// used to verify this couldn't run the real toolbox package): when
// validate_daily_implementation_plan(..., referred=True) is called from
// generate_team_dips (template_generator.py, lines 188-195), it returns a
// (review_datasets, fields) tuple where review_datasets is a dict, not the
// enriched DataFrame prepare_dip_data returns on the non-validate path
// (mp_validator.py, lines 189-215). DIPTemplateGenerator then does
// self.df['unique_team_code'] on that dict, which raises KeyError on every
// batch. So switching validation on doesn't silently no-op — it crashes
// every batch. The caveat card below only shows once that's confirmed to
// have happened (every batch failed while validation was on), and points to
// the actually-working /dip/validator page for real validation review
// tables instead.
export default function DipGeneratorPage({ onNavigate }: DipGeneratorPageProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ingestNote, setIngestNote] = useState<IngestNote | null>(null)
  const [batches, setBatches] = useState<DipBatch[]>([])
  const [analysis, setAnalysis] = useState<DipGeneratorAnalysis | null>(null)
  const [validateDipUsed, setValidateDipUsed] = useState(false)
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null)
  const [lgaFilter, setLgaFilter] = useState('')

  const cancelRef = useRef(false)
  const accumulatedTeamPdfs = useRef<{ name: string; bytes: Uint8Array }[]>([])
  const accumulatedCsvRows = useRef<Record<string, unknown>[]>([])
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(dipFile: File, validateDip: boolean, teamAllocationFile: File | null, batchSize: number) {
    setSubmitting(true)
    setError(null)
    setAnalysis(null)
    setSelectedPreview(null)
    setLgaFilter('')
    setValidateDipUsed(validateDip)
    cancelRef.current = false
    accumulatedTeamPdfs.current = []
    accumulatedCsvRows.current = []
    // One job per run, not per batch — a run can be several sequential
    // submitDipGenerator calls (see the class comment above), but from the
    // analyst's point of view it's one operation, so it should show as one
    // row on the Dashboard.
    const jobId = startJob('microplan-generator', dipFile.name)

    try {
      const parsed = await parseFileRows(dipFile)
      setIngestNote(buildIngestNote(parsed))

      const { batches: splitBatches } = splitDipFileByLga(parsed, batchSize)
      const initialBatches: DipBatch[] = splitBatches.map((b, i) => ({
        id: makeBatchId(i),
        lgas: b.lgas,
        rowCount: b.rowCount,
        status: 'pending',
        teamsGenerated: 0,
        error: null,
      }))
      setBatches(initialBatches)

      for (let i = 0; i < splitBatches.length; i++) {
        if (cancelRef.current) break

        setBatches((prev) => prev.map((b, idx) => (idx === i ? { ...b, status: 'active' } : b)))

        try {
          const blob = await submitDipGenerator(splitBatches[i].file, validateDip, teamAllocationFile)
          const { teamPdfs, csvRows } = await extractGeneratorZipEntries(blob)
          accumulatedTeamPdfs.current.push(...teamPdfs)
          accumulatedCsvRows.current.push(...csvRows)

          setBatches((prev) =>
            prev.map((b, idx) => (idx === i ? { ...b, status: 'done', teamsGenerated: teamPdfs.length } : b))
          )
          // Update the visible analysis after every batch, not just at the
          // end, so the chart/table/preview fill in incrementally too.
          setAnalysis(buildAnalysis(accumulatedTeamPdfs.current, accumulatedCsvRows.current))
        } catch (batchErr) {
          const message = batchErr instanceof Error ? batchErr.message : 'This batch failed.'
          setBatches((prev) => prev.map((b, idx) => (idx === i ? { ...b, status: 'error', error: message } : b)))
        }
      }

      if (accumulatedTeamPdfs.current.length === 0) {
        setError('No team DIPs came back — check the uploaded file and try again.')
        failJob(jobId)
      } else {
        completeJob(jobId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process this file — check it and try again.')
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  function handleCancel() {
    cancelRef.current = true
  }

  async function handleDownload() {
    if (accumulatedTeamPdfs.current.length === 0) return
    const blob = await buildFinalZip(accumulatedTeamPdfs.current, accumulatedCsvRows.current)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'DIP Output.zip'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const running = submitting
  const doneBatches = batches.filter((b) => b.status === 'done').length

  return (
    <div>
      <DipGeneratorForm onSubmit={handleSubmit} submitting={submitting} />

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

      <GenerationProgressCard
        batches={batches}
        running={running}
        onCancel={handleCancel}
        onDownloadPartial={handleDownload}
        canDownloadPartial={!running && doneBatches > 0 && doneBatches < batches.length}
      />

      {!running && validateDipUsed && batches.length > 0 && doneBatches === 0 && (
        <div
          style={{
            background: '#fbe6e6',
            border: '1px solid #f0b8b8',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            fontSize: 12,
            color: 'var(--color-critical)',
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          ⚠ <b>Every batch failed because "Validate against Team Allocation" was switched on.</b> Traced through the
          real source: when <code>validate_dip=True</code>, <code>generate_team_dips</code> calls{' '}
          <code>validate_daily_implementation_plan(..., referred=True)</code>, which hands back a dict of review
          tables instead of the DataFrame the PDF generator expects — so it crashes on{' '}
          <code>self.df['unique_team_code']</code> for every single batch (<code>KeyError</code>). This isn't a
          silent no-op, it's a hard failure — every batch above should show an error. For a real validation
          review of this DIP against its Team Allocation, use{' '}
          <button
            type="button"
            onClick={() => onNavigate('microplan-validate')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--color-critical)',
              fontWeight: 700,
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 'inherit',
            }}
          >
            Microplan · Validate DIP
          </button>{' '}
          instead, then come back here with validation switched off to generate the PDFs.
        </div>
      )}

      {ingestNote && <IngestNoteCard note={ingestNote} />}

      {analysis && analysis.totalTeams > 0 && (
        <>
          <DipGeneratorTitleCards analysis={analysis} />
          <DipGeneratorLgaChart analysis={analysis} activeLga={lgaFilter || null} onSelect={(lga) => setLgaFilter((f) => (f === lga ? '' : lga))} />
          <TeamDipPreview teamDips={analysis.teamDips} selectedFilename={selectedPreview} onSelect={setSelectedPreview} />
          <TeamDipTable
            analysis={analysis}
            onPreview={setSelectedPreview}
            onDownload={handleDownload}
            selectedFilename={selectedPreview}
            lgaFilter={lgaFilter}
            onLgaFilterChange={setLgaFilter}
          />
        </>
      )}

      {!ingestNote && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a compiled DIP above to generate one PDF per field team.
        </div>
      )}
    </div>
  )
}
