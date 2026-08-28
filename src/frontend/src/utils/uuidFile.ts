import Papa from 'papaparse'
import type { ParsedUuidBatch } from '../types/uuidChecker'

// Loose 8-4-4-4-12 hex-with-dashes shape. Python's uuid.UUID(str) — the type
// POST /uuid_batch_checker validates against — doesn't enforce an RFC
// version/variant nibble, so this matches the same bar the backend applies
// rather than a stricter "must be v1-v5" regex that could reject something
// the backend would accept.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Common header labels we shouldn't flag as "invalid" rows when they show up
// in an uploaded CSV — eha_guid is the actual DB column name (see
// uuid_checker.py's record_exists({'eha_guid': ...})).
const HEADER_ALIASES = new Set(['uuid', 'uuids', 'eha_guid', 'guid', 'id'])

export function isUuidShaped(value: string): boolean {
  return UUID_SHAPE.test(value.trim())
}

interface RawCandidate {
  raw: string
  row: number
}

function extractCandidates(text: string, isCsv: boolean): RawCandidate[] {
  const candidates: RawCandidate[] = []
  if (isCsv) {
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
    parsed.data.forEach((cells, i) => {
      for (const cell of cells) {
        const raw = String(cell ?? '').trim()
        if (raw) candidates.push({ raw, row: i + 1 })
      }
    })
  } else {
    text.split(/\r?\n/).forEach((line, i) => {
      const raw = line.trim()
      if (raw) candidates.push({ raw, row: i + 1 })
    })
  }
  return candidates
}

function buildBatch(candidates: RawCandidate[]): ParsedUuidBatch {
  const seen = new Set<string>()
  const uuids: string[] = []
  const invalid: ParsedUuidBatch['invalid'] = []
  let duplicateCount = 0

  for (const { raw, row } of candidates) {
    if (!isUuidShaped(raw)) {
      if (!HEADER_ALIASES.has(raw.toLowerCase())) invalid.push({ raw, row })
      continue
    }
    const normalized = raw.toLowerCase()
    if (seen.has(normalized)) {
      duplicateCount += 1
      continue
    }
    seen.add(normalized)
    uuids.push(normalized)
  }

  return { uuids, invalid, duplicateCount }
}

// Accepts a .csv (any cell that's UUID-shaped counts — no fixed column name
// required, since exports of eha_guid come from many different sources) or a
// .txt (one UUID per line).
export async function parseUuidFile(file: File): Promise<ParsedUuidBatch> {
  const text = await file.text()
  const isCsv = file.name.toLowerCase().endsWith('.csv')
  return buildBatch(extractCandidates(text, isCsv))
}

// Same parsing rules for the paste-in textarea (one UUID per line, or
// comma/whitespace separated).
export function parseUuidText(text: string): ParsedUuidBatch {
  const candidates: RawCandidate[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    line
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((raw) => candidates.push({ raw, row: i + 1 }))
  })
  return buildBatch(candidates)
}
