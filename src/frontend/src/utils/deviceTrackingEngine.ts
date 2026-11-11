import { DEVICE_TYPES, FLAG_SETS, MISSED_BUCKETS, SELECTION_NAMES } from '../types/deviceTracking'
import type { DeviceKind, FlagSetDef, Selection, SelectionDim } from '../types/deviceTracking'
import { diagnoseTeamCode, fmt, k1 } from './deviceTrackingAggregate'
import type { DayInfo, NormalizedDeviceData } from './deviceTrackingAggregate'

// The calculation core of the Team & Device Tracking dashboard. It is a plain
// TypeScript port of the design's logic, with no React in it:
//
//   - the result is turned into TEAM-DEVICES (one team code on one device in
//     one ward), each with a cell per day it sent tracks;
//   - the area (state > LGA > ward), the date range and the page-wide cross
//     filter (a click on any chart part) narrow those team-devices into a
//     VIEW; every chart asks for the view WITHOUT its own filter, so the chart
//     you clicked keeps all its categories (the pick highlighted, the others
//     faded) and can take a second pick;
//   - buildModel() turns the views into the numbers each section draws.

export type Level = 'state' | 'lga' | 'ward'

export interface Scope {
  state: string | null
  lga: string | null
  ward: string | null
}

// What one team-device sent on one day.
export interface DayCell {
  tracks: number
  device: string | null // device-flag category key
  work: string | null // work-rate-flag category key
  sharedCode: boolean
  multiCode: boolean
}

export interface TeamDevice {
  state: string
  lga: string
  ward: string
  code: string | null
  imei: string | null
  kind: DeviceKind
  invalid: boolean
  // One entry per day of the result; null = sent nothing that day.
  days: Array<DayCell | null>
}

export interface ViewRow {
  td: TeamDevice
  i: number // day index
  d: DayCell
}

export interface View {
  tds: TeamDevice[]
  rows: ViewRow[]
  idx: number[] // the day indices in play
  // How many of `idx` this team code sent nothing on; null for a team-device
  // that is not a valid team (an invalid or missing code is not a team).
  missedOf: (td: TeamDevice) => number | null
}

export interface Group {
  name: string
  state: string
  lga: string
  ward: string
  tds: TeamDevice[]
  rows: ViewRow[]
}

// ---- building team-devices ------------------------------------------------------

function categoryOf(set: FlagSetDef, flags: Record<string, number>): string | null {
  for (const cat of set.cats) if (flags[cat.key]) return cat.key
  return null
}

export function buildTeamDevices(data: NormalizedDeviceData): TeamDevice[] {
  const deviceSet = FLAG_SETS.find((s) => s.id === 'device')!
  const workSet = FLAG_SETS.find((s) => s.id === 'work')!
  const nDays = data.days.length
  const byKey = new Map<string, TeamDevice>()
  for (const row of data.rows) {
    if (row.dayIndex < 0) continue
    const key = [row.state, row.lga, row.ward, row.teamCode ?? '', row.imei ?? ''].join('\u0001')
    let td = byKey.get(key)
    if (!td) {
      td = {
        state: row.state,
        lga: row.lga,
        ward: row.ward,
        code: row.teamCode,
        imei: row.imei,
        kind: row.kind,
        invalid: false,
        days: Array<DayCell | null>(nDays).fill(null),
      }
      byKey.set(key, td)
    }
    if (row.flags.invalidCode) td.invalid = true
    const device = categoryOf(deviceSet, row.flags)
    const work = categoryOf(workSet, row.flags)
    const cell = td.days[row.dayIndex]
    if (cell) {
      cell.tracks += row.tracks
      cell.device = cell.device ?? device
      cell.work = cell.work ?? work
      cell.sharedCode = cell.sharedCode || !!row.flags.sharedCode
      cell.multiCode = cell.multiCode || !!row.flags.multiCode
    } else {
      td.days[row.dayIndex] = { tracks: row.tracks, device, work, sharedCode: !!row.flags.sharedCode, multiCode: !!row.flags.multiCode }
    }
  }
  return Array.from(byKey.values())
}

export function toggleSelection(sel: Selection, dim: SelectionDim, value: Selection[SelectionDim]): Selection {
  const next: Selection = { ...sel }
  if (next[dim] === value) delete next[dim]
  else (next as Record<string, unknown>)[dim] = value
  return next
}

// ---- small metrics -------------------------------------------------------------------

function distinctOf<T>(list: T[], pick: (x: T) => string | null): number {
  const seen = new Set<string>()
  for (const x of list) {
    const v = pick(x)
    if (v !== null) seen.add(v)
  }
  return seen.size
}

// Teams = distinct VALID team codes: an invalid or missing code is not a team
// the campaign knows. Devices = distinct IMEIs.
export const teamCount = (tds: TeamDevice[]) => distinctOf(tds, (td) => (td.invalid ? null : td.code))
export const deviceCount = (tds: TeamDevice[]) => distinctOf(tds, (td) => td.imei)
export const tracksOf = (rows: ViewRow[]) => rows.reduce((s, r) => s + r.d.tracks, 0)
// Device-days: each device counted once on each day it reported.
export const deviceDays = (rows: ViewRow[]) => new Set(rows.map((r) => `${r.td.imei}|${r.i}`)).size
export const perDeviceDay = (rows: ViewRow[]) => tracksOf(rows) / Math.max(1, deviceDays(rows))

export function cellHas(setId: FlagSetDef['id'], r: ViewRow, key: string): boolean {
  if (setId === 'code') return r.td.invalid
  if (setId === 'device') return r.d.device === key
  if (setId === 'work') return r.d.work === key
  return key === 'sharedCode' ? r.d.sharedCode : r.d.multiCode
}

// ---- the engine ----------------------------------------------------------------------

export interface EngineParams {
  scope: Scope
  from: number
  to: number
  sel: Selection
  activityCode: string
}

export interface Engine {
  data: NormalizedDeviceData
  params: EngineParams
  level: Level
  scopeName: string
  range: number[]
  dayOn: boolean
  view: (...except: SelectionDim[]) => View
  groupBy: (v: View, level?: Level, byPath?: boolean) => Group[]
}

export function levelOf(scope: Scope): Level {
  return scope.lga ? 'ward' : scope.state ? 'lga' : 'state'
}

export function scopeNameOf(scope: Scope): string {
  return scope.ward ? `${scope.ward} ward` : scope.lga ? `${scope.lga} LGA` : scope.state ? `${scope.state} State` : 'all states'
}

export function createEngine(data: NormalizedDeviceData, tds: TeamDevice[], params: EngineParams): Engine {
  const { scope, sel } = params
  const a = Math.min(params.from, params.to)
  const b = Math.max(params.from, params.to)
  const range = data.days.map((_, i) => i).filter((i) => i >= a && i <= b)
  const level = levelOf(scope)
  const scoped = tds.filter((td) => (!scope.state || td.state === scope.state) && (!scope.lga || td.lga === scope.lga) && (!scope.ward || td.ward === scope.ward))
  const dayOn = sel.day !== undefined && sel.day >= a && sel.day <= b

  // The days each valid team code sent tracks on (from any of its devices):
  // a team is "missing" on a day when none of them reported.
  const presence = new Map<string, Set<number>>()
  for (const td of scoped) {
    if (td.invalid || !td.code) continue
    let set = presence.get(td.code)
    if (!set) {
      set = new Set()
      presence.set(td.code, set)
    }
    td.days.forEach((c, i) => c && set!.add(i))
  }

  const view = (...except: SelectionDim[]): View => {
    const x = new Set(except)
    const idx = !x.has('day') && dayOn ? [sel.day as number] : range
    const missedOf = (td: TeamDevice): number | null => {
      if (td.invalid || !td.code) return null
      const present = presence.get(td.code)
      return idx.filter((i) => !present?.has(i)).length
    }
    let tds2 = scoped.filter((td) => {
      if (!x.has('type') && sel.type !== undefined && td.kind !== sel.type) return false
      if (!x.has('code') && sel.code && !td.invalid) return false
      if (!x.has('missed') && sel.missed !== undefined) {
        const m = missedOf(td)
        if (m === null || Math.min(4, m) !== sel.missed) return false
      }
      return true
    })
    const rowOk = (d: DayCell) =>
      (x.has('device') || !sel.device || d.device === sel.device) &&
      (x.has('work') || !sel.work || d.work === sel.work) &&
      (x.has('assign') || !sel.assign || (sel.assign === 'sharedCode' ? d.sharedCode : d.multiCode))
    const rowFilter = (['device', 'work', 'assign'] as const).some((k) => !x.has(k) && sel[k])
    const rows: ViewRow[] = []
    for (const td of tds2) {
      for (const i of idx) {
        const d = td.days[i]
        if (d && rowOk(d)) rows.push({ td, i, d })
      }
    }
    if (rowFilter) {
      const keep = new Set(rows.map((r) => r.td))
      tds2 = tds2.filter((td) => keep.has(td))
    }
    return { tds: tds2, rows, idx, missedOf }
  }

  // Grouped by the name at the current level (the scope already narrows it to
  // one parent, so names are unique), or by the full path from the state down
  // (byPath) when a table spans several parents.
  const groupBy = (v: View, lv: Level = level, byPath = false): Group[] => {
    const m = new Map<string, Group>()
    const keyOf = (td: TeamDevice) => (byPath ? [td.state, lv !== 'state' ? td.lga : '', lv === 'ward' ? td.ward : ''].join('\u0001') : td[lv])
    const get = (td: TeamDevice) => {
      const k = keyOf(td)
      let g = m.get(k)
      if (!g) {
        g = { name: td[lv], state: td.state, lga: td.lga, ward: td.ward, tds: [], rows: [] }
        m.set(k, g)
      }
      return g
    }
    v.tds.forEach((td) => get(td).tds.push(td))
    v.rows.forEach((r) => get(r.td).rows.push(r))
    return Array.from(m.values())
  }

  return { data, params, level, scopeName: scopeNameOf(scope), range, dayOn, view, groupBy }
}

// ---- the model each section draws ----------------------------------------------------

export interface Kpi {
  label: string
  value: string
  sub: string
  accent?: boolean
  spark?: { points: string; text: string }
}

export interface ThresholdInfo {
  average: number
  tolerance: number
  threshold: number
  below: number
  of: number
}

export interface TeamsDevicesRow {
  name: string
  teams: number
  devices: number
}

export interface TypeRow {
  name: string
  phones: number
  vbs: number
}

export interface ReportingRow {
  name: string
  devices: number
  reporting: number[] // per day in `dayIdx`
}

export interface TracksRow {
  name: string
  tracks: number[]
}

export interface ComboRow {
  name: string
  devices: number
  tracks: number
  perDeviceDay: number
  low: boolean
}

export interface MissedRow {
  name: string
  teams: number
  buckets: number[]
}

export interface FlagAreaRow {
  name: string
  values: number[] // one per category of the set
  total: number
}

export interface FlagSetModel {
  set: FlagSetDef
  area: FlagAreaRow[]
  byDay: Array<{ dayIndex: number; values: number[]; total: number }>
  selected: string | null
}

export interface InvalidLine {
  state: string
  lga: string
  ward: string
  code: string
  imei: string
  problem: string
  days: number
  tracks: number
}

export interface ConflictLine {
  state: string
  lga: string
  ward: string
  kind: 'Team code on several devices' | 'Device under several team codes'
  codes: string[]
  imeis: string[]
  days: number
}

export interface Chip {
  dim: SelectionDim
  value: Selection[SelectionDim]
  label: string
}

export interface DashboardModel {
  level: Level
  scopeName: string
  rangeText: string
  nDays: number
  // Day indices drawn by the by-date charts (the whole range, even when one
  // day is picked, so the grids keep their columns).
  dayIdx: number[]
  kpis: Kpi[]
  threshold: ThresholdInfo
  teamsDevices: TeamsDevicesRow[]
  types: { rows: TypeRow[]; legend: Array<{ key: DeviceKind; name: string; color: string; count: number }>; byDay: Array<{ dayIndex: number; phones: number; vbs: number }> }
  reporting: ReportingRow[]
  tracks: { rows: TracksRow[]; totals: number[] }
  combo: { rows: ComboRow[]; maxDevices: number; maxTracks: number }
  missed: { rows: MissedRow[]; totals: number[]; totalTeams: number }
  flags: FlagSetModel[]
  invalid: InvalidLine[]
  conflicts: ConflictLine[]
  chips: Chip[]
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

export function rangeTextOf(days: DayInfo[], range: number[], dayOn: boolean, selDay: number | undefined): string {
  if (days.length === 0 || range.length === 0) return ''
  if (dayOn && selDay !== undefined) return days[selDay].long
  if (range.length === days.length) return `all ${days.length} ${days.length === 1 ? 'day' : 'days'}`
  const lo = days[range[0]]
  const hi = days[range[range.length - 1]]
  return range.length === 1 ? lo.long : `${lo.long} – ${hi.long}`
}

function catName(dim: SelectionDim, v: Selection[SelectionDim], days: DayInfo[]): string {
  if (dim === 'day') return days[v as number]?.long ?? ''
  if (dim === 'type') return DEVICE_TYPES.find((t) => t.key === v)?.name ?? ''
  if (dim === 'missed') return MISSED_BUCKETS[v as number]?.name ?? ''
  const set = FLAG_SETS.find((s) => s.id === dim)
  return set?.cats.find((c) => c.key === v)?.name ?? String(v)
}

export function buildModel(engine: Engine): DashboardModel {
  const { data, params, level, scopeName, dayOn } = engine
  const { sel } = params
  const days = data.days

  // ---- the main view and the area tally ----
  const all = engine.view()
  const byTeams = (p: Group, q: Group) => teamCount(q.tds) - teamCount(p.tds) || p.name.localeCompare(q.name)
  const groups = engine.groupBy(all).sort(byTeams)
  const nDays = all.idx.length
  const totalTracks = tracksOf(all.rows)
  const totalDevices = deviceCount(all.tds)
  const totalTeams = teamCount(all.tds)
  const vbDevices = deviceCount(all.tds.filter((td) => td.kind === 'vb'))

  // ---- the calculated threshold ----
  // The area in view's own tracks per device-day, less a tolerance of one
  // standard deviation of its sub-areas' values. Both move as you drill down
  // and as the round winds down, because the devices and tracks behind them do.
  const average = perDeviceDay(all.rows)
  const vals = groups.map((g) => perDeviceDay(g.rows))
  const meanV = sum(vals) / Math.max(1, vals.length)
  const tolerance = vals.length > 1 ? Math.sqrt(sum(vals.map((x) => (x - meanV) * (x - meanV))) / (vals.length - 1)) : 0
  const threshold = Math.max(0, average - tolerance)
  const below = groups.filter((g) => perDeviceDay(g.rows) < threshold).length
  const levelPlural = level === 'state' ? 'states' : level === 'lga' ? 'LGAs' : 'wards'

  const dailyRatio = all.idx.map((i) => perDeviceDay(all.rows.filter((r) => r.i === i)))
  const maxDR = Math.max(1, ...dailyRatio)
  const minDR = Math.min(...dailyRatio)
  const sparkPoints = dailyRatio
    .map((v, j) => `${(dailyRatio.length > 1 ? (j / (dailyRatio.length - 1)) * 100 : 50).toFixed(1)},${(22 - (maxDR > minDR ? (v - minDR) / (maxDR - minDR) : 0.5) * 20).toFixed(1)}`)
    .join(' ')
  const sparkText =
    dailyRatio.length > 1 ? `${days[all.idx[0]].label} ${fmt(dailyRatio[0])} → ${days[all.idx[all.idx.length - 1]].label} ${fmt(dailyRatio[dailyRatio.length - 1])}` : ''

  const reportingDays = sum(all.idx.map((i) => distinctOf(all.rows.filter((r) => r.i === i), (r) => r.td.imei)))
  const countRows = (pred: (d: DayCell) => boolean) => all.rows.filter((r) => pred(r.d)).length
  const validCodes = new Set(all.tds.filter((td) => !td.invalid && td.code).map((td) => td.code as string))
  const missedCodes = new Set(all.tds.filter((td) => (all.missedOf(td) ?? 0) > 0).map((td) => td.code as string))

  const kpis: Kpi[] = [
    { label: 'Teams', value: fmt(totalTeams), sub: 'distinct valid team codes' },
    { label: 'Devices', value: fmt(totalDevices), sub: `${fmt(vbDevices)} vaccine-buddy ${vbDevices === 1 ? 'device' : 'devices'}` },
    { label: 'Tracks', value: k1(totalTracks), sub: `cleaned GPS points, ${nDays} ${nDays === 1 ? 'day' : 'days'}` },
    {
      label: 'Tracks per device-day',
      value: fmt(average),
      sub: `threshold ${fmt(threshold)} = ${fmt(average)} − tolerance ${fmt(tolerance)} · ${below} of ${groups.length} ${levelPlural} below`,
      accent: below > 0,
      spark: dailyRatio.length > 1 ? { points: sparkPoints, text: sparkText } : undefined,
    },
    { label: 'Devices reporting', value: `${Math.round((reportingDays / Math.max(1, totalDevices * nDays)) * 100)}%`, sub: 'of device-days' },
    { label: 'Teams with missed days', value: fmt(missedCodes.size), sub: `of ${fmt(validCodes.size)} teams missed 1 or more days` },
    { label: 'Device flags', value: fmt(countRows((d) => !!d.device)), sub: 'flagged device-days' },
    { label: 'Work-rate flags', value: fmt(countRows((d) => !!d.work)), sub: 'flagged team-days' },
    { label: 'Code–device conflicts', value: fmt(countRows((d) => d.sharedCode || d.multiCode)), sub: 'shared codes + multi-code devices, per day' },
  ]

  // ---- teams vs devices ----
  const teamsDevices = groups.map((g) => ({ name: g.name, teams: teamCount(g.tds), devices: deviceCount(g.tds) }))

  // ---- phones vs vaccine buddies (owns the "type" filter) ----
  const vType = engine.view('type')
  const kindCount = (tds: TeamDevice[], kind: DeviceKind) => deviceCount(tds.filter((td) => td.kind === kind))
  const typeRows = engine
    .groupBy(vType)
    .map((g) => ({ name: g.name, phones: kindCount(g.tds, 'phone'), vbs: kindCount(g.tds, 'vb') }))
    .sort((p, q) => q.vbs - p.vbs || q.phones - p.phones || p.name.localeCompare(q.name))
  const vTypeDay = engine.view('type', 'day')
  const typeByDay = vTypeDay.idx.map((i) => {
    const onDay = vTypeDay.rows.filter((r) => r.i === i)
    return {
      dayIndex: i,
      phones: distinctOf(onDay.filter((r) => r.td.kind === 'phone'), (r) => r.td.imei),
      vbs: distinctOf(onDay.filter((r) => r.td.kind === 'vb'), (r) => r.td.imei),
    }
  })
  const typeLegend = DEVICE_TYPES.map((t) => ({ ...t, count: kindCount(vType.tds, t.key) }))

  // ---- by-day grids (own the "day" filter) ----
  const vDay = engine.view('day')
  const dayGroups = engine.groupBy(vDay).sort(byTeams)
  const reporting = dayGroups
    .map((g) => {
      const devices = deviceCount(g.tds)
      return { name: g.name, devices, reporting: vDay.idx.map((i) => distinctOf(g.rows.filter((r) => r.i === i), (r) => r.td.imei)) }
    })
    .sort((p, q) => {
      const avg = (x: ReportingRow) => sum(x.reporting.map((n) => n / Math.max(1, x.devices)))
      return avg(p) - avg(q) || p.name.localeCompare(q.name)
    })
  const tracksRows = dayGroups.map((g) => ({ name: g.name, tracks: vDay.idx.map((i) => tracksOf(g.rows.filter((r) => r.i === i))) }))
  const trackTotals = vDay.idx.map((i) => tracksOf(vDay.rows.filter((r) => r.i === i)))

  // ---- devices deployed and tracks ----
  const comboRows = groups.map((g) => {
    const per = perDeviceDay(g.rows)
    return { name: g.name, devices: deviceCount(g.tds), tracks: tracksOf(g.rows), perDeviceDay: per, low: per < threshold }
  })

  // ---- missed work days (owns the "missed" filter) ----
  const vMiss = engine.view('missed')
  const bucketsOf = (tds: TeamDevice[]) => {
    const bk = [0, 0, 0, 0, 0]
    const seen = new Set<string>()
    for (const td of tds) {
      const m = vMiss.missedOf(td)
      if (m === null || !td.code || seen.has(td.code)) continue
      seen.add(td.code)
      bk[Math.min(4, m)] += 1
    }
    return bk
  }
  const missedRows = engine
    .groupBy(vMiss)
    .map((g) => {
      const buckets = bucketsOf(g.tds)
      return { name: g.name, teams: sum(buckets), buckets }
    })
    .sort((p, q) => q.teams - q.buckets[0] - (p.teams - p.buckets[0]) || p.name.localeCompare(q.name))
  const missedTotals = bucketsOf(vMiss.tds)

  // ---- flags (each set owns its filter) ----
  const flags: FlagSetModel[] = FLAG_SETS.map((set) => {
    const selected = (sel[set.id] as string | undefined) ?? null
    const vF = engine.view(set.id)
    const vFD = engine.view(set.id, 'day')
    const area = engine
      .groupBy(vF)
      .map((g) => {
        const values = set.cats.map((c) => g.rows.filter((r) => cellHas(set.id, r, c.key)).length)
        return { name: g.name, values, total: sum(values) }
      })
      .sort((p, q) => q.total - p.total || p.name.localeCompare(q.name))
    const byDay = vFD.idx.map((i) => {
      const values = set.cats.map((c) => vFD.rows.filter((r) => r.i === i && cellHas(set.id, r, c.key)).length)
      return { dayIndex: i, values, total: sum(values) }
    })
    return { set, area, byDay, selected }
  })

  // ---- line lists: everything filtered ----
  const rowsByTd = new Map<TeamDevice, ViewRow[]>()
  for (const r of all.rows) {
    const list = rowsByTd.get(r.td)
    if (list) list.push(r)
    else rowsByTd.set(r.td, [r])
  }
  const invalid: InvalidLine[] = []
  for (const td of all.tds) {
    if (!td.invalid) continue
    const seen = rowsByTd.get(td)
    if (!seen || seen.length === 0) continue
    invalid.push({
      state: td.state,
      lga: td.lga,
      ward: td.ward,
      code: td.code ?? '(blank)',
      imei: td.imei ?? '(none)',
      problem: diagnoseTeamCode(td.code, params.activityCode),
      days: new Set(seen.map((r) => r.i)).size,
      tracks: tracksOf(seen),
    })
  }
  invalid.sort((p, q) => p.state.localeCompare(q.state) || p.lga.localeCompare(q.lga) || p.ward.localeCompare(q.ward) || p.code.localeCompare(q.code))

  const conflictMap = new Map<string, { line: ConflictLine; days: Set<number>; codes: Set<string>; imeis: Set<string> }>()
  const addConflict = (r: ViewRow, kind: ConflictLine['kind'], entity: string, codes: Iterable<string>, imeis: Iterable<string>) => {
    const key = [kind, r.td.state, r.td.lga, r.td.ward, entity].join('\u0001')
    let entry = conflictMap.get(key)
    if (!entry) {
      entry = { line: { state: r.td.state, lga: r.td.lga, ward: r.td.ward, kind, codes: [], imeis: [], days: 0 }, days: new Set(), codes: new Set(), imeis: new Set() }
      conflictMap.set(key, entry)
    }
    entry.days.add(r.i)
    for (const c of codes) entry.codes.add(c)
    for (const i of imeis) entry.imeis.add(i)
  }
  for (const r of all.rows) {
    const date = days[r.i].key
    if (r.d.sharedCode && r.td.code) {
      addConflict(r, 'Team code on several devices', r.td.code, [r.td.code], data.sharedCodeImeis.get(`${date}|${r.td.code}`) ?? (r.td.imei ? [r.td.imei] : []))
    }
    if (r.d.multiCode && r.td.imei) {
      addConflict(r, 'Device under several team codes', r.td.imei, data.multiCodeCodes.get(`${date}|${r.td.imei}`) ?? (r.td.code ? [r.td.code] : []), [r.td.imei])
    }
  }
  const conflicts: ConflictLine[] = Array.from(conflictMap.values()).map(({ line, days: d, codes, imeis }) => ({
    ...line,
    days: d.size,
    codes: Array.from(codes).sort(),
    imeis: Array.from(imeis).sort(),
  }))
  conflicts.sort((p, q) => p.state.localeCompare(q.state) || p.lga.localeCompare(q.lga) || p.ward.localeCompare(q.ward) || p.kind.localeCompare(q.kind))

  const chips: Chip[] = (Object.keys(sel) as SelectionDim[])
    .filter((dim) => sel[dim] !== undefined)
    .map((dim) => ({ dim, value: sel[dim], label: `${SELECTION_NAMES[dim]}: ${catName(dim, sel[dim], days)}` }))

  return {
    level,
    scopeName,
    rangeText: rangeTextOf(days, all.idx, dayOn, sel.day),
    nDays,
    dayIdx: vDay.idx,
    kpis,
    threshold: { average, tolerance, threshold, below, of: groups.length },
    teamsDevices,
    types: { rows: typeRows, legend: typeLegend, byDay: typeByDay },
    reporting,
    tracks: { rows: tracksRows, totals: trackTotals },
    combo: { rows: comboRows, maxDevices: Math.max(1, ...comboRows.map((c) => c.devices)), maxTracks: Math.max(1, ...comboRows.map((c) => c.tracks)) },
    missed: { rows: missedRows, totals: missedTotals, totalTeams: sum(missedTotals) },
    flags,
    invalid,
    conflicts,
    chips,
  }
}

// ---- Excel summary sheets ------------------------------------------------------------

// One row per state / LGA / ward inside the area in view, for the current
// date range and filters. Grouped by the full path, since ward names repeat.
export function levelSummaryRows(engine: Engine, lv: Level): Array<Record<string, string | number>> {
  const v = engine.view()
  const groups = engine.groupBy(v, lv, true).sort((p, q) => p.state.localeCompare(q.state) || p.lga.localeCompare(q.lga) || p.ward.localeCompare(q.ward))
  const setIds = ['device', 'work', 'assign'] as const
  return groups.map((g) => {
    const buckets = [0, 0, 0, 0, 0]
    const seen = new Set<string>()
    for (const td of g.tds) {
      const m = v.missedOf(td)
      if (m === null || !td.code || seen.has(td.code)) continue
      seen.add(td.code)
      buckets[Math.min(4, m)] += 1
    }
    const teams = teamCount(g.tds)
    const devices = deviceCount(g.tds)
    const row: Record<string, string | number> = {}
    row.State = g.state
    if (lv !== 'state') row.LGA = g.lga
    if (lv === 'ward') row.Ward = g.ward
    row.Teams = teams
    row.Devices = devices
    row.Phones = kindCountOf(g.tds, 'phone')
    row['Vaccine buddies'] = kindCountOf(g.tds, 'vb')
    row.Tracks = tracksOf(g.rows)
    row['Tracks per device-day'] = Math.round(perDeviceDay(g.rows))
    const reportingDays = sum(v.idx.map((i) => distinctOf(g.rows.filter((r) => r.i === i), (r) => r.td.imei)))
    row['Devices reporting (% of device-days)'] = Math.round((reportingDays / Math.max(1, devices * v.idx.length)) * 100)
    row['Teams missing 1+ days'] = teams ? sum(buckets.slice(1)) : 0
    MISSED_BUCKETS.forEach((bkt, i) => {
      row[`Teams · ${bkt.name}`] = buckets[i]
    })
    for (const id of setIds) {
      const set = FLAG_SETS.find((s) => s.id === id)!
      for (const c of set.cats) row[c.name] = g.rows.filter((r) => cellHas(id, r, c.key)).length
    }
    row['Invalid-code device-days'] = g.rows.filter((r) => r.td.invalid).length
    return row
  })
}

function kindCountOf(tds: TeamDevice[], kind: DeviceKind): number {
  return deviceCount(tds.filter((td) => td.kind === kind))
}
