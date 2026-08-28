import { useMemo, useState } from 'react'
import { ApiError, submitFixer, submitStandardizeMlos, submitUpdateValidation } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import { parseCsvText } from '../../api/parseResult'
import type {
  FixerFormInput,
  MlosOperationMode,
  ParsedMlosOpsDataset,
  StandardizeFormInput,
  UpdateValidationFormInput,
} from '../../types/mlosOps'
import { diffDatasets } from '../../utils/datasetDiff'
import type { DatasetDiffResult } from '../../utils/datasetDiff'
import { downloadCsv } from '../../utils/csvExport'
import OperationModeSwitcher from './OperationModeSwitcher'
import StandardizeForm from './StandardizeForm'
import FixerForm from './FixerForm'
import UpdateValidationForm from './UpdateValidationForm'
import MlosChangeCards from './MlosChangeCards'
import MlosChangesTable from './MlosChangesTable'

const OUTPUT_NAME_BY_MODE: Record<MlosOperationMode, string> = {
  standardize: 'mlos_standardized.csv',
  fixer: 'mlos_fixed.csv',
  update: 'mlos_updated.csv',
}

export default function MlosOpsPage() {
  const [mode, setMode] = useState<MlosOperationMode>('standardize')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputDataset, setInputDataset] = useState<ParsedMlosOpsDataset | null>(null)
  const [inputSkippedReason, setInputSkippedReason] = useState<string | null>(null)
  const [outputDataset, setOutputDataset] = useState<ParsedMlosOpsDataset | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  function resetResults() {
    setError(null)
    setInputDataset(null)
    setInputSkippedReason(null)
    setOutputDataset(null)
  }

  function handleModeChange(nextMode: MlosOperationMode) {
    setMode(nextMode)
    resetResults()
  }

  // Shared post-run step for all three endpoints: parse the output CSV, and
  // — only when the ORIGINAL upload was itself a .csv — parse that too, so
  // utils/datasetDiff.ts has both sides to compare. A non-CSV input (xlsx/
  // gpkg/sqlite/kml/kmz, all of which these endpoints' read_dataset accepts)
  // can't be parsed client-side without a new parsing dependency, so the
  // diff/cards/table are skipped with an explicit reason rather than
  // silently omitted — the run itself still succeeded and its output is
  // still shown.
  async function processResult(inputFile: File, outputBlob: Blob) {
    const outputText = await outputBlob.text()
    const output = parseCsvText(outputText)
    setOutputDataset(output)

    if (inputFile.name.toLowerCase().endsWith('.csv')) {
      const inputText = await inputFile.text()
      setInputDataset(parseCsvText(inputText))
      setInputSkippedReason(null)
    } else {
      setInputDataset(null)
      setInputSkippedReason(
        `The uploaded file was "${inputFile.name}", not a .csv — the before/after comparison below needs both the input and output parsed as CSV client-side, so it isn't available for this run. The run itself completed normally; download the output above to see the full result.`,
      )
    }
  }

  async function runOperation(inputFile: File, label: string, submit: () => Promise<Blob>) {
    setSubmitting(true)
    setError(null)
    setInputDataset(null)
    setInputSkippedReason(null)
    setOutputDataset(null)
    const jobId = startJob('mlos-ops', label)
    try {
      const blob = await submit()
      await processResult(inputFile, blob)
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while running this operation.')
      }
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStandardize(input: StandardizeFormInput) {
    if (!input.mlosFile) return
    const inputFile = input.mlosFile
    await runOperation(inputFile, `Standardize · ${inputFile.name}`, () => submitStandardizeMlos(input))
  }

  async function handleFixer(input: FixerFormInput) {
    if (!input.settlementFile) return
    const inputFile = input.settlementFile
    await runOperation(inputFile, `Fixer · ${inputFile.name}`, () => submitFixer(input))
  }

  async function handleUpdate(input: UpdateValidationFormInput) {
    if (!input.mlosFile) return
    const inputFile = input.mlosFile
    await runOperation(inputFile, `Update · ${inputFile.name}`, () => submitUpdateValidation(input))
  }

  const diff = useMemo<DatasetDiffResult | null>(() => {
    if (!inputDataset || !outputDataset) return null
    return diffDatasets(inputDataset.records, inputDataset.columns, outputDataset.records, outputDataset.columns)
  }, [inputDataset, outputDataset])

  return (
    <div>
      <OperationModeSwitcher mode={mode} onChange={handleModeChange} />

      {mode === 'standardize' && <StandardizeForm onSubmit={handleStandardize} submitting={submitting} />}
      {mode === 'fixer' && <FixerForm onSubmit={handleFixer} submitting={submitting} />}
      {mode === 'update' && <UpdateValidationForm onSubmit={handleUpdate} submitting={submitting} />}

      {error && (
        <div
          style={{
            background: '#fdecea',
            border: '1px solid var(--color-critical)',
            color: '#7a2020',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {submitting && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 20 }}>
          Running {mode === 'standardize' ? 'standardization' : mode === 'fixer' ? 'the fixer' : 'the update'} — this can
          take a while on a large master list…
        </div>
      )}

      {outputDataset && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => downloadCsv(OUTPUT_NAME_BY_MODE[mode], outputDataset.records)}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '7px 14px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ⬇ Download output CSV ({outputDataset.records.length.toLocaleString()} records)
            </button>
          </div>

          {inputSkippedReason && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 20 }}>{inputSkippedReason}</div>
          )}

          {diff && (
            <>
              <MlosChangeCards diff={diff} />
              <MlosChangesTable diff={diff} />
            </>
          )}
        </>
      )}

      {!outputDataset && !submitting && !error && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Upload a settlement list above and run {mode === 'standardize' ? 'standardization' : mode === 'fixer' ? 'the fixer' : 'the update'} to
          see the before/after comparison here.
        </div>
      )}
    </div>
  )
}
