// POST /campaign/checkout (toolbox/apps/planfeld/checkout.py): update a versioned SpatiaLite checkout with a
// new MLoS. The request carries three files; the response body is the updated checkout database.

export interface CheckoutFormInput {
  /** The new MLoS (settlement list) to bring the checkout up to date with. */
  settlementFile: File
  /** The checkout database as it is now (.sqlite / .gpkg), holding the settlements and takeoff point tables. */
  checkoutFile: File
  /** Coordinates for takeoff points that are new in the MLoS. */
  takeoffFile: File | null
}

/**
 * The numbers the Checkout page shows, from the X-Checkout-Summary response header (built by
 * synchronize_checkout_datasets). The three change counts are always there; each of the others is null when the
 * backend could not count it.
 */
export interface CheckoutSummary {
  /** Settlements in the checkout whose attributes changed. */
  updated: number
  /** Settlements in the MLoS that the checkout did not have, now added. */
  added: number
  /** Settlements in the checkout that are not in the MLoS, now removed. */
  removed: number
  settlementsMlos: number | null
  /** Settlements in the checkout as uploaded. */
  settlementsCheckout: number | null
  /** Settlements in the updated checkout. */
  settlementsAfter: number | null
  takeoffMlos: number | null
  takeoffCheckout: number | null
}

export interface CheckoutResponse {
  /** The updated checkout database. */
  blob: Blob
  /** Null when the backend did not send the summary header. */
  summary: CheckoutSummary | null
  /** Set by the backend (X-Data-Warning) when it finished but the data looked wrong. */
  warning: string | null
}
