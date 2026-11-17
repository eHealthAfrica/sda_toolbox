import type { CSSProperties } from 'react'
import type { CheckoutSummary } from '../../types/checkout'
import { compareText, formatCount } from '../../utils/checkout'
import StatCard from '../common/StatCard'

interface CheckoutIndicatorsProps {
  summary: CheckoutSummary
}

const headingStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
  marginBottom: 8,
}

const rowStyle: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap' }

// The Checkout page's dashboard: what the MLoS and the checkout each hold, and what the update did about the
// difference between them. Every number comes from the backend's X-Checkout-Summary header.
export default function CheckoutIndicators({ summary }: CheckoutIndicatorsProps) {
  const { settlementsMlos, settlementsCheckout, settlementsAfter, takeoffMlos, takeoffCheckout } = summary

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={headingStyle}>MLoS and checkout</div>
        <div style={rowStyle}>
          <StatCard
            label="Settlements in the MLoS"
            value={formatCount(settlementsMlos)}
            accentColor="var(--color-primary)"
            hint={compareText(settlementsMlos, settlementsCheckout, 'checkout') ?? undefined}
          />
          <StatCard
            label="Settlements in the checkout"
            value={formatCount(settlementsCheckout)}
            accentColor="var(--color-primary-dark)"
            hint={settlementsAfter === null ? undefined : `${formatCount(settlementsAfter)} after this update`}
          />
          <StatCard
            label="Takeoff points in the MLoS"
            value={formatCount(takeoffMlos)}
            accentColor="var(--color-primary)"
            hint={compareText(takeoffMlos, takeoffCheckout, 'checkout') ?? undefined}
          />
          <StatCard
            label="Takeoff points in the checkout"
            value={formatCount(takeoffCheckout)}
            accentColor="var(--color-primary-dark)"
          />
        </div>
      </div>

      <div>
        <div style={headingStyle}>Changes made to the checkout</div>
        <div style={rowStyle}>
          <StatCard label="Settlements added" value={formatCount(summary.added)} accentColor="var(--color-good)" hint="In the MLoS, not in the checkout" />
          <StatCard label="Settlements removed" value={formatCount(summary.removed)} accentColor="var(--color-critical)" hint="In the checkout, not in the MLoS" />
          <StatCard label="Settlements updated" value={formatCount(summary.updated)} accentColor="var(--color-warning)" hint="In both, with changed attributes" />
        </div>
      </div>
    </div>
  )
}
