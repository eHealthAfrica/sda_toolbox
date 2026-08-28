import { useEffect, useMemo, useState } from 'react'
import { submitDisaggregateMlos } from '../../api/client'
import { analyzeOriginalMlos, parseDisaggregateWorkbook } from '../../utils/compilerDisaggregateParse'
import type { DisaggregateFormInput, DisaggregateResult } from '../../types/compilerDisaggregate'
import { useJobTracker } from '../../state/jobTracker'
import DisaggregateForm from './DisaggregateForm'
import DisaggregateTitleCards from './DisaggregateTitleCards'
import DisaggregateChart from './DisaggregateChart'

// Compiler · Disaggregate MLoS. POST /compiler/disaggregate returns a single
// .xlsx workbook (one sheet per LGA or Ward) — parsed directly with the
// `xlsx` package, no zip involved. The "total records in original data"
// title card and the missing-admin-value caveat both come from analyzing
// the RAW upload client-side first (utils/compilerDisaggregateParse.ts),
// since the response workbook alone can't answer either question.
export default function DisaggregatePage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DisaggregateResult | null>(null)
  // The raw .xlsx blob POST /compiler/disaggregate returned — kept alongside
  // the parsed sheets purely so "Download results" hands back the server's
  // actual workbook rather than reconstructing one from the parsed data.
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [sourceName, setSourceName] = useState<string | null>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: DisaggregateFormInput) {
    setSubmitting(true)
    setError(null)
    setResult(null)
    setResultBlob(null)
    const jobId = startJob('compiler-disaggregate', input.mlosFile?.name ?? 'Disaggregate MLoS run')
    try {
      const [{ totalRecordsOriginal, rowsMissingAdminValue }, blob] = await Promise.all([
        analyzeOriginalMlos(input.mlosFile as File, input.level),
        submitDisaggregateMlos(input.mlosFile as File, input.level),
      ])
      const sheets = await parseDisaggregateWorkbook(blob)
      setResult({ sheets, totalRecordsOriginal, rowsMissingAdminValue, level: input.level })
      setResultBlob(blob)
      setSourceName(input.mlosFile?.name.split('.')[0] ?? 'mlos')
      completeJob(jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disaggregate this file — check it and try again.')
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  const downloadUrl = useMemo(() => (resultBlob ? URL.createObjectURL(resultBlob) : null), [resultBlob])
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    }
  }, [downloadUrl])

  return (
    <div>
      <DisaggregateForm onSubmit={handleSubmit} submitting={submitting} />

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
          Disaggregating…
        </div>
      )}

      {result && result.sheets.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={`${sourceName ?? 'mlos'}_disaggregated_by_${result.level}.xlsx`}
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
                ⬇ Download results (.xlsx)
              </a>
            )}
          </div>
          <DisaggregateTitleCards result={result} />
          <DisaggregateChart sheets={result.sheets} />
        </>
      )}

      {result && result.sheets.length === 0 && !submitting && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          The server returned no sheets for this run.
        </div>
      )}

      {!result && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload a Master List of Settlements above to split it by LGA or Ward.
        </div>
      )}
    </div>
  )
}
