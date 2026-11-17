// Mirrors toolbox/models/db/access_models.py — the enum values are the literal
// strings the backend serializes, not booleans.
//
// 'Available' means the UUID can be assigned to a new settlement. 'Not Available'
// means it cannot, and `reason` says why: 'In MLOS' (a settlement already has it)
// or 'Reserved' (it was handed out by an earlier check and has not reached the
// MLoS yet). `reason` is null whenever the UUID is available.
export type AvailabilityStatus = 'Available' | 'Not Available'
export type UnavailableReason = 'In MLOS' | 'Reserved'

export interface UuidCheckResult {
  uuid: string
  is_available: AvailabilityStatus
  reason: UnavailableReason | null
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
