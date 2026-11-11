import type { CheckoutSummary } from '../types/checkout'

/**
 * Whether the page insists on the new-takeoff-points file. The route declares it File(None), so it is optional:
 * the sync only needs it when the MLoS has takeoff points the checkout does not have yet (the backend then
 * answers "There are new Takeoff Points in the MLoS and No New Takeoff Points was provided").
 */
export const TAKEOFF_FILE_REQUIRED = false

/**
 * Reads the X-Checkout-Summary header, JSON like
 * {"updated": 4, "added": 7, "removed": 2, "settlements_mlos": 105, "settlements_checkout": 98,
 *  "settlements_after": 103, "takeoff_mlos": 12, "takeoff_checkout": 11}.
 * `updated`, `added` and `removed` are required; each other count may be missing or null. Anything else,
 * including a missing header, gives null so the page shows no numbers rather than wrong ones.
 */
export function parseCheckoutSummary(header: string | null): CheckoutSummary | null {
  if (!header) return null
  try {
    const body: unknown = JSON.parse(header)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    const record = body as Record<string, unknown>
    const count = (key: string): number | null => {
      const value = record[key]
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
    }
    const updated = count('updated')
    const added = count('added')
    const removed = count('removed')
    if (updated === null || added === null || removed === null) return null
    return {
      updated,
      added,
      removed,
      settlementsMlos: count('settlements_mlos'),
      settlementsCheckout: count('settlements_checkout'),
      settlementsAfter: count('settlements_after'),
      takeoffMlos: count('takeoff_mlos'),
      takeoffCheckout: count('takeoff_checkout'),
    }
  } catch {
    return null
  }
}

/** A count for display: thousands separators, or a dash when it is not known. */
export function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
}

/** "12 more than the checkout", "3 fewer than the checkout", "same as the checkout"; null when either is unknown. */
export function compareText(value: number | null, other: number | null, otherName: string): string | null {
  if (value === null || other === null) return null
  const diff = value - other
  if (diff === 0) return `Same as the ${otherName}`
  return `${Math.abs(diff).toLocaleString('en-US')} ${diff > 0 ? 'more' : 'fewer'} than the ${otherName}`
}

/** Name for the downloaded copy: the checkout's own name plus "_updated", so it never overwrites the original. */
export function updatedCheckoutName(originalName: string): string {
  const trimmed = originalName.trim()
  const dot = trimmed.lastIndexOf('.')
  const hasExtension = dot > 0 && dot < trimmed.length - 1
  const base = hasExtension ? trimmed.slice(0, dot) : trimmed
  const extension = hasExtension ? trimmed.slice(dot) : '.sqlite'
  return `${base || 'checkout'}_updated${extension}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
