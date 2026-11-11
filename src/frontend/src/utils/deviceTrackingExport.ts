import * as XLSX from 'xlsx'
import { DEVICE_TYPES, MISSED_BUCKETS } from '../types/deviceTracking'
import type { DayInfo } from './deviceTrackingAggregate'
import type { ConflictLine, DashboardModel, FlagSetModel, InvalidLine } from './deviceTrackingEngine'

// Row builders for every CSV / Excel download on the Team & Device Tracking
// page. Each returns plain objects (one per table row) built from the same
// model the charts are drawn from, so what is downloaded is always exactly
// what is on screen — narrowed by the area, dates and filters in force.

export type ExportRow = Record<string, string | number>

export interface ExportContext {
  model: DashboardModel
  // Every day of the result (the model's day indices point into it).
  days: DayInfo[]
  // "State" | "LGA" | "Ward" — the column heading for the area name.
  levelLabel: string
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0)

export function teamsDevicesRows(ctx: ExportContext): ExportRow[] {
  return ctx.model.teamsDevices.map((r) => ({ [ctx.levelLabel]: r.name, Teams: r.teams, Devices: r.devices, 'Devices minus teams': r.devices - r.teams }))
}

export function reportingRows(ctx: ExportContext): ExportRow[] {
  const { model, days } = ctx
  return model.reporting.map((r) => ({
    [ctx.levelLabel]: r.name,
    Devices: r.devices,
    ...Object.fromEntries(model.dayIdx.map((i, j) => [`${days[i].long} · devices reporting`, r.reporting[j]])),
    ...Object.fromEntries(model.dayIdx.map((i, j) => [`${days[i].long} · % of devices`, pct(r.reporting[j], r.devices)])),
  }))
}

export function tracksRows(ctx: ExportContext): ExportRow[] {
  const { model, days } = ctx
  const rows: ExportRow[] = model.tracks.rows.map((r) => ({ [ctx.levelLabel]: r.name, ...Object.fromEntries(model.dayIdx.map((i, j) => [days[i].long, r.tracks[j]])) }))
  rows.push({ [ctx.levelLabel]: 'Total', ...Object.fromEntries(model.dayIdx.map((i, j) => [days[i].long, model.tracks.totals[j]])) })
  return rows
}

export function devicesTracksRows(ctx: ExportContext): ExportRow[] {
  const { threshold } = ctx.model
  return ctx.model.combo.rows.map((r) => ({
    [ctx.levelLabel]: r.name,
    'Devices deployed': r.devices,
    Tracks: r.tracks,
    'Tracks per device-day': Math.round(r.perDeviceDay),
    'Threshold (tracks per device-day)': Math.round(threshold.threshold),
    'Below threshold': r.low ? 'Yes' : 'No',
  }))
}

export function typesAreaRows(ctx: ExportContext): ExportRow[] {
  return ctx.model.types.rows.map((r) => ({
    [ctx.levelLabel]: r.name,
    [DEVICE_TYPES[0].name]: r.phones,
    [DEVICE_TYPES[1].name]: r.vbs,
    'Vaccine buddies (%)': pct(r.vbs, r.phones + r.vbs),
  }))
}

export function typesDateRows(ctx: ExportContext): ExportRow[] {
  return ctx.model.types.byDay.map((d) => ({
    Date: ctx.days[d.dayIndex].long,
    [`${DEVICE_TYPES[0].name} reporting`]: d.phones,
    [`${DEVICE_TYPES[1].name} reporting`]: d.vbs,
  }))
}

export function missedAreaRows(ctx: ExportContext): ExportRow[] {
  return ctx.model.missed.rows.map((r) => ({
    [ctx.levelLabel]: r.name,
    Teams: r.teams,
    ...Object.fromEntries(MISSED_BUCKETS.map((b, i) => [`Teams · ${b.name}`, r.buckets[i]])),
  }))
}

export function missedDistributionRows(ctx: ExportContext): ExportRow[] {
  const { totals, totalTeams } = ctx.model.missed
  return MISSED_BUCKETS.map((b, i) => ({ 'Missed days': b.name, Teams: totals[i], '% of teams': pct(totals[i], totalTeams) }))
}

export function flagAreaRows(ctx: ExportContext, fm: FlagSetModel): ExportRow[] {
  return fm.area.map((r) => ({
    [ctx.levelLabel]: r.name,
    ...Object.fromEntries(fm.set.cats.map((c, ci) => [c.name, r.values[ci]])),
    Total: r.total,
  }))
}

export function flagDateRows(ctx: ExportContext, fm: FlagSetModel): ExportRow[] {
  return fm.byDay.map((d) => ({
    Date: ctx.days[d.dayIndex].long,
    ...Object.fromEntries(fm.set.cats.map((c, ci) => [c.name, d.values[ci]])),
    Total: d.total,
  }))
}

export function invalidCodeRows(lines: InvalidLine[]): ExportRow[] {
  return lines.map((r) => ({
    State: r.state,
    LGA: r.lga,
    Ward: r.ward,
    'Team code (as recorded)': r.code,
    IMEI: r.imei,
    Problem: r.problem,
    'Days seen': r.days,
    Tracks: r.tracks,
  }))
}

export function conflictRowsForExport(lines: ConflictLine[]): ExportRow[] {
  return lines.map((r) => ({
    State: r.state,
    LGA: r.lga,
    Ward: r.ward,
    Conflict: r.kind,
    'Team code(s)': r.codes.join('; '),
    'IMEI(s)': r.imeis.join('; '),
    Days: r.days,
  }))
}

export interface SummarySheet {
  name: string
  rows: ExportRow[]
}

// The workbook: the chosen state / LGA / ward summary sheets first, then the
// tables that are always included. Sheet names are Excel's 31-character
// maximum or less, and unique.
export function downloadWorkbook(filename: string, ctx: ExportContext, summaries: SummarySheet[]): void {
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()
  const add = (name: string, rows: ExportRow[]) => {
    let sheetName = name.slice(0, 31)
    for (let n = 2; used.has(sheetName.toLowerCase()); n += 1) sheetName = `${name.slice(0, 28)} ${n}`
    used.add(sheetName.toLowerCase())
    // An empty sheet still needs a header row to be a valid, openable sheet.
    const sheet = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['No rows for the current selection']])
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  }
  for (const s of summaries) add(s.name, s.rows)
  add('Daily tracks', tracksRows(ctx))
  add('Device reporting', reportingRows(ctx))
  add('Device types by area', typesAreaRows(ctx))
  add('Device types by date', typesDateRows(ctx))
  add('Missed days by area', missedAreaRows(ctx))
  add('Missed days distribution', missedDistributionRows(ctx))
  const sheetNames: Record<string, string> = { device: 'Device flags', work: 'Work-rate flags', assign: 'Assignment flags', code: 'Team code flags' }
  for (const fm of ctx.model.flags) add(`${sheetNames[fm.set.id] ?? fm.set.title} by date`, flagDateRows(ctx, fm))
  add('Invalid team codes', invalidCodeRows(ctx.model.invalid))
  add('Code-device conflicts', conflictRowsForExport(ctx.model.conflicts))
  XLSX.writeFile(workbook, filename)
}
