// Mirrors toolbox/apps/db_access/uuid_checker.py — Exists enum values are the
// literal strings the backend serializes ('EXISTS' / 'NOT EXISTS'), not
// booleans.
export type ExistsStatus = 'EXISTS' | 'NOT EXISTS'

export interface UuidCheckResult {
  uuid: string
  exists: ExistsStatus
}

// Client-side only — a row from an uploaded/pasted batch that isn't shaped
// like a UUID, so it's held back rather than sent. POST /uuid_batch_checker
// takes `uuids: list[UUID]` as the *entire* request body (no per-item
// tolerance), so one malformed entry would 422 the whole batch if we didn't
// filter first.
export interface InvalidUuidEntry {
  raw: string
  row: number
}

export interface ParsedUuidBatch {
  uuids: string[]
  invalid: InvalidUuidEntry[]
  duplicateCount: number
}
