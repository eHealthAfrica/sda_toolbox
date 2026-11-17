import { useEffect, useMemo, useState } from 'react'
import { ApiError, submitCheckoutUpdate } from '../../api/client'
import { useJobTracker } from '../../state/jobTracker'
import type { CheckoutFormInput, CheckoutResponse } from '../../types/checkout'
import { updatedCheckoutName } from '../../utils/checkout'
import CheckoutForm from './CheckoutForm'
import CheckoutResultCard from './CheckoutResultCard'

// Campaign · Checkout Update (POST /campaign/checkout). The endpoint answers with the updated database itself,
// so there is nothing to parse in the browser: the page keeps the returned blob, offers it as a download under
// "<checkout name>_updated.<ext>", and shows the change counts when the backend sends them.
export default function CheckoutPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckoutResponse | null>(null)
  const [downloadName, setDownloadName] = useState('checkout_updated.sqlite')
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: CheckoutFormInput) {
    setSubmitting(true)
    setError(null)
    setResult(null)
    const jobId = startJob('campaign-checkout', input.checkoutFile.name)
    try {
      const response = await submitCheckoutUpdate(input)
      setDownloadName(updatedCheckoutName(input.checkoutFile.name))
      setResult(response)
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while updating the checkout.')
      }
      setResult(null)
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
      <CheckoutForm onSubmit={handleSubmit} submitting={submitting} />

      {error && (
        <div
          role="alert"
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
        <div role="status" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '12px 0' }}>
          Updating the checkout — this can take a while for a large database. Keep this page open.
        </div>
      )}

      {result && downloadUrl && (
        <CheckoutResultCard
          fileName={downloadName}
          sizeBytes={result.blob.size}
          downloadUrl={downloadUrl}
          summary={result.summary}
          warning={result.warning}
        />
      )}

      {!result && !submitting && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          Upload the new MLoS, the current checkout database and the new takeoff points to produce an updated checkout.
        </div>
      )}
    </div>
  )
}
