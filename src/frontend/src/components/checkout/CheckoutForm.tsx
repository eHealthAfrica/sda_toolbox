import { useState } from 'react'
import type { FormEvent } from 'react'
import type { CheckoutFormInput } from '../../types/checkout'
import { TAKEOFF_FILE_REQUIRED } from '../../utils/checkout'
import FileDropzone from '../common/FileDropzone'

interface CheckoutFormProps {
  onSubmit: (input: CheckoutFormInput) => void
  submitting: boolean
}

// Reserved label height so the three dropzone boxes line up even when one label wraps — see the matching
// note on FileDropzone's labelMinHeight prop.
const ROW_LABEL_HEIGHT = 56

export default function CheckoutForm({ onSubmit, submitting }: CheckoutFormProps) {
  const [settlementFile, setSettlementFile] = useState<File | null>(null)
  const [checkoutFile, setCheckoutFile] = useState<File | null>(null)
  const [takeoffFile, setTakeoffFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!settlementFile) {
      setFormError('The new MLoS (settlement list) is required.')
      return
    }
    if (!checkoutFile) {
      setFormError('The current checkout database is required.')
      return
    }
    if (TAKEOFF_FILE_REQUIRED && !takeoffFile) {
      setFormError('The new takeoff points file is required.')
      return
    }
    setFormError(null)
    onSubmit({ settlementFile, checkoutFile, takeoffFile })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '28px 40px' }}>
        <FileDropzone
          label="New MLoS (settlement list) *"
          hint="The updated master list to bring the checkout up to date with."
          accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
          file={settlementFile}
          onChange={setSettlementFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
          fillWidth
        />
        <FileDropzone
          label="Current checkout database *"
          hint="The versioned SpatiaLite checkout with the settlements and takeoff point tables."
          accept=".sqlite,.db,.gpkg"
          file={checkoutFile}
          onChange={setCheckoutFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
          fillWidth
        />
        <FileDropzone
          label={`New takeoff points${TAKEOFF_FILE_REQUIRED ? ' *' : ''}`}
          hint={TAKEOFF_FILE_REQUIRED ? 'Coordinates for takeoff points that are new in the MLoS.' : 'Optional. Needed only if the MLoS has takeoff points that are not in the checkout yet.'}
          accept=".csv,.xlsx,.xls,.gpkg,.sqlite,.kml,.kmz"
          file={takeoffFile}
          onChange={setTakeoffFile}
          labelMinHeight={ROW_LABEL_HEIGHT}
          fillWidth
        />
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
          Settlements that changed are updated, new ones are added and ones missing from the MLoS are removed from the
          checkout. You get an updated copy to download — the file you upload here is not changed.
        </div>
        <button
          type="submit"
          disabled={submitting}
          style={{
            background: submitting ? 'var(--color-text-muted)' : 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '9px 20px',
            fontSize: 13,
            fontWeight: 600,
            cursor: submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? 'Updating…' : 'Update Checkout'}
        </button>
      </div>

      {formError && <div style={{ color: 'var(--color-critical)', fontSize: 12 }}>{formError}</div>}
    </form>
  )
}
