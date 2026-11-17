import type { DeviceKind, DeviceTrackingRecord } from '../types/deviceTracking'
import { FLAG_SETS, REQUIRED_DEVICE_COLUMNS } from '../types/deviceTracking'

// ---- row normalisation -------------------------------------------------------
//
// POST /tracking/devices returns one row per team code + IMEI + day. This
// file turns those rows into typed DayRows (every flag as a 0/1 counter) plus
// the formatting helpers the Team & Device Tracking page shares. Everything
// the dashboard computes from them — cross filters, by state / LGA / ward,
// by day, line lists — lives in deviceTrackingEngine.ts. Nothing here talks
// to the backend; it is plain data in, plain data out.

export const UNPLACED = 'Unplaced'

const FLAG_KEYS = FLAG_SETS.flatMap((set) => set.cats.map((c) => c.key))

export interface DayRow {
  state: string
  lga: string
  ward: string
  teamCode: string | null
  imei: string | null
  kind: DeviceKind
  date: string // YYYY-MM-DD
  dayIndex: number // index into NormalizedDeviceData.days
  tracks: number
  flags: Record<string, number>
}

export interface DayInfo {
  key: string
  label: string // "Sat 27"
  long: string // "Sat 27 Jun"
}

export interface NormalizedDeviceData {
  rows: DayRow[]
  days: DayInfo[]
  missingColumns: string[]
  // Same-day conflicts, kept so the conflict line list can name every code /
  // IMEI involved: "date|teamCode" -> IMEIs, "date|imei" -> team codes.
  sharedCodeImeis: Map<string, Set<string>>
  multiCodeCodes: Map<string, Set<string>>
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function text(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' || s.toLowerCase() === 'nan' ? null : s
}

function num(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

export function dayInfo(key: string): DayInfo {
  // Parsed as UTC so the weekday never shifts with the viewer's time zone.
  const d = new Date(`${key}T00:00:00Z`)
  const weekday = WEEKDAYS[d.getUTCDay()]
  const day = d.getUTCDate()
  return { key, label: `${weekday} ${day}`, long: `${weekday} ${day} ${MONTHS[d.getUTCMonth()]}` }
}

export function deviceKind(imei: string | null): DeviceKind {
  return imei && /^vbu/i.test(imei) ? 'vb' : 'phone'
}

export function normalizeDeviceRecords(records: DeviceTrackingRecord[], columns: string[]): NormalizedDeviceData {
  const missingColumns = REQUIRED_DEVICE_COLUMNS.filter((c) => !columns.includes(c))

  const flagLookup = new Map<string, Map<string, string>>() // column -> backend value -> category key
  for (const set of FLAG_SETS) {
    if (set.source === 'derived') continue
    const byValue = flagLookup.get(set.source) ?? new Map<string, string>()
    for (const cat of set.cats) for (const v of cat.backendValues) byValue.set(v, cat.key)
    flagLookup.set(set.source, byValue)
  }

  const rows: DayRow[] = []
  for (const record of records) {
    const date = text(record.analysis_date)?.slice(0, 10)
    if (!date) continue
    const flags: Record<string, number> = {}
    for (const key of FLAG_KEYS) flags[key] = 0
    for (const [column, byValue] of flagLookup) {
      const raw = text(record[column])
      const key = raw ? byValue.get(raw.toLowerCase()) : undefined
      if (key) flags[key] = 1
    }
    const imei = text(record.imei)
    rows.push({
      state: text(record.statename) ?? UNPLACED,
      lga: text(record.lganame) ?? UNPLACED,
      ward: text(record.wardname) ?? UNPLACED,
      teamCode: text(record.team_code),
      imei,
      kind: deviceKind(imei),
      date,
      dayIndex: -1,
      tracks: num(record.track_count),
      flags,
    })
  }

  const dayKeys = Array.from(new Set(rows.map((r) => r.date))).sort()
  const dayOf = new Map(dayKeys.map((k, i) => [k, i]))
  for (const row of rows) row.dayIndex = dayOf.get(row.date) ?? -1

  // The assignment flags have no backend column: a team code sending from two
  // devices (or one device under two team codes) on the same day is worked
  // out here, and every team-device-day involved carries the flag.
  const codeDay = new Map<string, DayRow[]>()
  const imeiDay = new Map<string, DayRow[]>()
  for (const row of rows) {
    if (row.teamCode) {
      const k = `${row.date}|${row.teamCode}`
      const list = codeDay.get(k)
      if (list) list.push(row)
      else codeDay.set(k, [row])
    }
    if (row.imei) {
      const k = `${row.date}|${row.imei}`
      const list = imeiDay.get(k)
      if (list) list.push(row)
      else imeiDay.set(k, [row])
    }
  }
  const sharedCodeImeis = new Map<string, Set<string>>()
  for (const [k, list] of codeDay) {
    const imeis = new Set(list.map((r) => r.imei).filter((x): x is string => !!x))
    if (imeis.size >= 2) {
      sharedCodeImeis.set(k, imeis)
      for (const r of list) r.flags.sharedCode = 1
    }
  }
  const multiCodeCodes = new Map<string, Set<string>>()
  for (const [k, list] of imeiDay) {
    const codes = new Set(list.map((r) => r.teamCode).filter((x): x is string => !!x))
    if (codes.size >= 2) {
      multiCodeCodes.set(k, codes)
      for (const r of list) r.flags.multiCode = 1
    }
  }

  return { rows, days: dayKeys.map(dayInfo), missingColumns, sharedCodeImeis, multiCodeCodes }
}

// ---- team code diagnosis ---------------------------------------------------------

// The backend only says "Invalid Team Code"; this says what is wrong with the
// code, using the same pattern it checks (team_code_review): two-letter state,
// 3-character LGA, 3-4 character ward, the campaign code, a 3-digit team
// number, joined by "-".
export function diagnoseTeamCode(code: string | null, activityCode: string): string {
  if (!code || code === '(blank)') return 'Code missing'
  const parts = code.split('-')
  const campaign = activityCode.trim().toUpperCase()
  if (parts.length < 5) {
    if (campaign && parts[parts.length - 1].toUpperCase() === campaign) return 'Team number missing'
    if (parts.length <= 3) return 'Admin parts not separated, or missing'
    return 'A section of the code is missing'
  }
  if (parts.length > 5) return 'Too many sections'
  const [state, lga, ward, campaignPart, team] = parts
  if (campaign && campaignPart.toUpperCase() !== campaign) return `Campaign code is not ${activityCode.trim()}`
  if (!/^\d{3}$/.test(team)) return 'Team number is not 3 digits'
  if (!/^[A-Z]{2}$/i.test(state)) return 'State code is not 2 letters'
  if (!/^[A-Z0-9]{3}$/i.test(lga)) return 'LGA code is not 3 characters'
  if (!/^[A-Z0-9]{3,4}$/i.test(ward)) return 'Ward code is not 3 to 4 characters'
  return 'Does not match the campaign pattern'
}

// ---- small formatting helpers --------------------------------------------------------

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

// 1234 -> "1.2k"
export function k1(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

// Heat-grid cell colour, t in 0..1 (light blue -> dark blue).
export function heatColor(t: number): string {
  const a = [234, 241, 251]
  const b = [21, 70, 135]
  const c = Math.max(0, Math.min(1, t))
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * c)).join(',')})`
}
