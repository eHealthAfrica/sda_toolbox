// Live pipeline logs: the browser makes up a job id before it sends a tool's
// request, sends it in a request header, and then polls GET /jobs/{id}/logs
// while the request is still running. The id has to come from the client
// because a tool endpoint is one long request: its response (and with it any
// id the server would choose) only arrives once the pipeline has finished.
//
// Switched off unless VITE_JOB_LOGS=true is set at build time. A custom
// request header turns the tools' plain form posts into requests the browser
// must pre-check with the server, so sending it to a backend that has not been
// upgraded would risk breaking working pages. With the flag off nothing about
// the existing requests changes.

export const JOB_LOGS_ENABLED = import.meta.env.VITE_JOB_LOGS === 'true'

// Not 'X-Job-Id': that name is already the H2H tool's response header (see
// submitH2HTracking in api/client.ts), and the two ids mean different things.
export const JOB_ID_HEADER = 'X-Client-Job-Id'

// A v4 UUID. crypto.randomUUID needs a secure context (https or localhost);
// the fallback covers a plain-http deployment on a LAN address.
export function newClientJobId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Headers to add to a tool request: the job id when the feature is on,
// nothing otherwise.
export function jobIdHeaders(jobId: string | undefined): Record<string, string> {
  return JOB_LOGS_ENABLED && jobId ? { [JOB_ID_HEADER]: jobId } : {}
}

export const MAX_LOG_LINES = 2000

// Appends newly received lines, skipping any already held (by seq) and
// keeping only the newest MAX_LOG_LINES.
export function mergeLogLines<T extends { seq: number }>(existing: T[], incoming: T[], max: number = MAX_LOG_LINES): T[] {
  if (incoming.length === 0) return existing
  const lastSeq = existing.length > 0 ? existing[existing.length - 1].seq : -1
  const fresh = incoming.filter((line) => line.seq > lastSeq)
  if (fresh.length === 0) return existing
  const merged = existing.concat(fresh)
  return merged.length > max ? merged.slice(merged.length - max) : merged
}
