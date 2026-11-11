// Turns the backend's error bodies into a sentence a person can act on, instead
// of showing the raw JSON. Three body shapes are recognised:
//
//   1. A data check failure (toolbox/errors.py, toolbox/dataops):
//        { error: { code, message, details } }
//      `details.problems[]` may carry hints such as the columns the file does
//      have (`columns_found`) or the values that would have been accepted
//      (`valid_examples`); those are appended as a second sentence.
//   2. A tool exception (toolbox/exceptions): { msg, detail, status_code }
//   3. Anything else returns null so the caller keeps its own fallback.

const MAX_LIST_ITEMS = 25

export interface ReadableError {
  /** One or two sentences: what is wrong. */
  summary: string
  /** What the user can compare against (columns found, valid values); empty when there is nothing to add. */
  hint: string
  /** The machine name of the problem (e.g. "missing_columns"), when the body has one. */
  code: string | null
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function listText(label: string, items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return ''
  const names = items.map((item) => String(item))
  const shown = names.slice(0, MAX_LIST_ITEMS).join(', ')
  const more = names.length > MAX_LIST_ITEMS ? ` (and ${names.length - MAX_LIST_ITEMS} more)` : ''
  return `${label}: ${shown}${more}.`
}

function hintsFrom(details: unknown): string {
  if (!isObject(details)) return ''
  const problems = Array.isArray(details.problems) ? details.problems : [details]
  const hints: string[] = []
  for (const problem of problems) {
    const own = isObject(problem) ? (isObject(problem.details) ? problem.details : problem) : null
    if (!own) continue
    for (const text of [listText('Columns in your file', own.columns_found), listText('Accepted values include', own.valid_examples)]) {
      if (text && !hints.includes(text)) hints.push(text)
    }
  }
  return hints.join(' ')
}

/** Readable text for a parsed response body, or null when the shape is not one we know. */
export function readableBody(body: unknown): ReadableError | null {
  if (!isObject(body)) return null

  if (isObject(body.error)) {
    const message = asText(body.error.message)
    if (!message) return null
    return { summary: message, hint: hintsFrom(body.error.details), code: asText(body.error.code) || null }
  }

  const msg = asText(body.msg)
  if (msg) {
    const detail = asText(body.detail)
    return { summary: detail ? `${msg}: ${detail}` : msg, hint: '', code: null }
  }
  return null
}

/**
 * Readable text for a stored error string (the job table keeps the first 2000
 * characters of the response body, so the JSON may be cut off). Returns the
 * input unchanged when it is not a recognised body.
 */
export function readableErrorString(text: string | null | undefined): ReadableError | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    return readableBody(JSON.parse(trimmed))
  } catch {
    // Cut off mid-way: pull the first "message" (or "msg") out of the fragment.
    const match = /"(?:message|msg)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(trimmed)
    if (!match) return null
    try {
      return { summary: String(JSON.parse(`"${match[1]}"`)), hint: '', code: null }
    } catch {
      return { summary: match[1], hint: '', code: null }
    }
  }
}

/** Summary and hint as one string, for the error box on a tool page. */
export function readableMessage(error: ReadableError): string {
  return error.hint ? `${error.summary} ${error.hint}` : error.summary
}
