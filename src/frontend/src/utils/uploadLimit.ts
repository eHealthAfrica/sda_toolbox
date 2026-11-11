// Helpers for refusing an upload that is bigger than the API accepts, before it is sent.
//
// The backend (toolbox/utils/upload_limit.py) answers a request over MAX_UPLOAD_MB with a 413 and
// { msg: 'Upload too large', detail }. The browser often never shows that answer: the server closes the
// connection while the file is still being sent, and fetch() then fails with a bare "Failed to fetch".
// So the same message is produced here, from the same limit (GET /upload-limit), and shown without
// sending anything. All of this is currently switched off (UPLOAD_LIMIT_CHECK_ENABLED below).

const MB = 1024 * 1024

/**
 * Master switch for everything in this file's callers: the size lookup, the check before sending, and the
 * large-file hint after a network failure. OFF: uploads go straight to the server with no size check.
 * Set to true (and set UPLOAD_LIMIT_ENABLED=1 on the backend) to bring the limit back.
 */
export const UPLOAD_LIMIT_CHECK_ENABLED: boolean = false

/** Uploads at least this big that fail with a network error get a hint about large files. */
export const LARGE_UPLOAD_BYTES = 100 * MB

export interface UploadLimitInfo {
  max_upload_bytes: number | null
  max_upload_mb: number | null
}

/** The limit in bytes from a GET /upload-limit body, or null when the body has none (limit off or unknown). */
export function limitFromBody(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const bytes = (body as Partial<UploadLimitInfo>).max_upload_bytes
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : null
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / MB).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
}

/** Total size in bytes of everything in a form: every file counts, so several files are added together. */
export function formDataBytes(form: FormData): number {
  let total = 0
  for (const value of form.values()) {
    total += typeof value === 'string' ? new Blob([value]).size : value.size
  }
  return total
}

/** Same wording and shape as the backend's 413 body, so it reads the same wherever it appears. */
export function uploadTooLargeBody(limitBytes: number, sizeBytes: number) {
  return {
    msg: 'Upload too large',
    detail:
      `This upload is ${formatMegabytes(sizeBytes)}, which is over the ${formatMegabytes(limitBytes)} limit for a single request. ` +
      'Split it into smaller files, or remove columns and rows you do not need, and try again.',
    status_code: 413,
  }
}

/** Shown when a large upload fails with a network error and the limit is unknown, so it cannot be named. */
export function largeUploadFailedMessage(sizeBytes: number): string {
  return (
    `The upload of ${formatMegabytes(sizeBytes)} did not go through. The connection may have dropped, or the file ` +
    'may be larger than the server accepts. Check your connection, or split the file into smaller ones, and try again.'
  )
}
