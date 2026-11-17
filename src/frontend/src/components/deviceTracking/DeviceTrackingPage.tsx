import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, submitDeviceTracking } from '../../api/client'
import { parseDeviceTrackingCsv } from '../../api/parseResult'
import { useJobTracker } from '../../state/jobTracker'
import type { DeviceTrackingFormInput, ParsedDeviceTrackingResult, Selection, SelectionDim } from '../../types/deviceTracking'
import { downloadCsv } from '../../utils/csvExport'
import { fmt, normalizeDeviceRecords } from '../../utils/deviceTrackingAggregate'
import { buildModel, buildTeamDevices, createEngine, levelSummaryRows, toggleSelection } from '../../utils/deviceTrackingEngine'
import type { Chip, Level, Scope } from '../../utils/deviceTrackingEngine'
import {
  conflictRowsForExport,
  devicesTracksRows,
  downloadWorkbook,
  flagAreaRows,
  flagDateRows,
  invalidCodeRows,
  missedAreaRows,
  missedDistributionRows,
  reportingRows,
  teamsDevicesRows,
  tracksRows,
  typesAreaRows,
  typesDateRows,
} from '../../utils/deviceTrackingExport'
import type { ExportContext, ExportRow } from '../../utils/deviceTrackingExport'
import JobProgress from '../jobLogs/JobProgress'
import { JOB_LOGS_ENABLED, newClientJobId } from '../../utils/jobLogs'
import { GTS_STEPS } from '../../utils/jobProgress'
import DayHeatGrid from './DayHeatGrid'
import DeviceFilterBar from './DeviceFilterBar'
import DeviceFilterChips from './DeviceFilterChips'
import DeviceFlagDefinitions from './DeviceFlagDefinitions'
import DeviceKpiGrid from './DeviceKpiGrid'
import DeviceLineListTable from './DeviceLineListTable'
import DeviceTrackingForm from './DeviceTrackingForm'
import DeviceTypeSection from './DeviceTypeSection'
import DevicesTracksCombo from './DevicesTracksCombo'
import ExcelDownloadMenu from './ExcelDownloadMenu'
import FlagSetSection from './FlagSetSection'
import MissedDaysSection from './MissedDaysSection'
import TeamsDevicesChart from './TeamsDevicesChart'
import { Pair, SectionHeading, monoStyle } from './deviceTrackingShared'

const LEVEL_NOUN: Record<Level, string> = { state: 'state', lga: 'LGA', ward: 'ward' }
const LEVEL_LABEL: Record<Level, string> = { state: 'State', lga: 'LGA', ward: 'Ward' }
const NO_SCOPE: Scope = { state: null, lga: null, ward: null }

// What the page remembers about the run behind the current result: the
// response is a bare CSV that doesn't echo its inputs, and the activity code
// is needed again to explain WHY a team code is invalid.
interface RunInfo {
  fileName: string
  activityCode: string
}

const noticeStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-sm)',
  padding: '16px 18px',
  marginBottom: 20,
} as const

const sortedUnique = (xs: string[]) => Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b))

// Team & Device Tracking dashboard for POST /tracking/devices: which teams
// and devices sent tracks, how many, on which days, and which of them look
// wrong (broken devices, short work days, invalid or shared team codes).
//
// Three things scope every number on the page at once:
//   - the AREA (state > LGA > ward), from the filter bar, the breadcrumbs, or
//     by selecting an area name in any chart;
//   - the DATE RANGE, from the calendar in the filter bar;
//   - the CROSS FILTER: a click on a coloured part of any chart, a legend
//     item or a day label narrows the whole page to it (see the chips).
// All the arithmetic is in utils/deviceTrackingEngine.ts; this file holds the
// state and lays the sections out.
export default function DeviceTrackingPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParsedDeviceTrackingResult | null>(null)
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null)
  // The id sent with the request so the pipeline progress bar can ask the backend
  // for this run's log lines while it is still going. Stays null (and the
  // bar renders nothing) unless VITE_JOB_LOGS=true.
  const [logJobId, setLogJobId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>(NO_SCOPE)
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(0)
  const [sel, setSel] = useState<Selection>({})
  const formRef = useRef<HTMLDivElement>(null)
  const { startJob, completeJob, failJob } = useJobTracker()

  async function handleSubmit(input: DeviceTrackingFormInput) {
    setSubmitting(true)
    setError(null)
    setScope(NO_SCOPE)
    setSel({})
    const jobId = startJob('device-tracking', input.tracksFile?.name ?? 'Team & device analysis run')
    const clientJobId = newClientJobId()
    setLogJobId(JOB_LOGS_ENABLED ? clientJobId : null)
    try {
      const csvBlob = await submitDeviceTracking(input, clientJobId)
      const baseName = input.tracksFile?.name.replace(/\.[^./]+$/, '') ?? 'device_tracking'
      const parsed = await parseDeviceTrackingCsv(csvBlob, `${baseName}_devices.csv`)
      setResult(parsed)
      setRunInfo({ fileName: input.tracksFile?.name ?? '', activityCode: input.activityCode })
      completeJob(jobId)
    } catch (err) {
      if (err instanceof ApiError) {
        const detailText = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
        setError(`${err.message}${detailText ? ` — ${detailText}` : ''}`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong while running the team and device analysis.')
      }
      setResult(null)
      failJob(jobId)
    } finally {
      setSubmitting(false)
    }
  }

  const data = useMemo(() => (result ? normalizeDeviceRecords(result.records, result.columns) : null), [result])
  const tds = useMemo(() => (data ? buildTeamDevices(data) : []), [data])

  // A new result starts on its full date range.
  useEffect(() => {
    if (!data) return
    setFrom(0)
    setTo(Math.max(0, data.days.length - 1))
  }, [data])

  // A new upload that no longer contains the area being looked at falls back
  // to the top level instead of an empty scope.
  useEffect(() => {
    if (!data || !scope.state) return
    const found = tds.some((td) => td.state === scope.state && (!scope.lga || td.lga === scope.lga) && (!scope.ward || td.ward === scope.ward))
    if (!found) setScope(NO_SCOPE)
  }, [data, tds, scope])

  const stateOptions = useMemo(() => sortedUnique(tds.map((td) => td.state)), [tds])
  const lgaOptions = useMemo(() => (scope.state ? sortedUnique(tds.filter((td) => td.state === scope.state).map((td) => td.lga)) : []), [tds, scope.state])
  const wardOptions = useMemo(
    () => (scope.state && scope.lga ? sortedUnique(tds.filter((td) => td.state === scope.state && td.lga === scope.lga).map((td) => td.ward)) : []),
    [tds, scope.state, scope.lga],
  )

  const a = Math.min(from, to)
  const b = Math.max(from, to)
  const activityCode = runInfo?.activityCode ?? ''

  const engine = useMemo(() => (data ? createEngine(data, tds, { scope, from, to, sel, activityCode }) : null), [data, tds, scope, from, to, sel, activityCode])
  const model = useMemo(() => (engine ? buildModel(engine) : null), [engine])

  const level: Level = model?.level ?? 'state'
  const levelNoun = LEVEL_NOUN[level]
  const leaf = level === 'ward'
  // Sends every by-area window back to its top 5 when the scope, range or
  // filter moves.
  const resetKey = JSON.stringify([scope, a, b, sel])

  function handleDrill(name: string) {
    if (level === 'state') setScope({ state: name, lga: null, ward: null })
    else if (level === 'lga') setScope((s) => ({ ...s, lga: name, ward: null }))
  }

  function handleToggle(dim: SelectionDim, value: Selection[SelectionDim]) {
    setSel((cur) => toggleSelection(cur, dim, value))
  }

  function removeChip(chip: Chip) {
    setSel((cur) => toggleSelection(cur, chip.dim, chip.value))
  }

  function resetFilters() {
    setScope(NO_SCOPE)
    setSel({})
    if (data) {
      setFrom(0)
      setTo(Math.max(0, data.days.length - 1))
    }
  }

  const ctx: ExportContext | null = model && data ? { model, days: data.days, levelLabel: LEVEL_LABEL[level] } : null
  const filtered = (model?.chips.length ?? 0) > 0
  const fileBase = `${(activityCode || 'device_tracking').replace(/[^A-Za-z0-9_-]+/g, '_')}_${(model?.scopeName ?? 'all_states').replace(/[^A-Za-z0-9]+/g, '_')}${filtered ? '_filtered' : ''}`
  const csv = (slug: string, rows: ExportRow[]) => downloadCsv(`${fileBase}_${slug}.csv`, rows)
  const filterText = model && model.chips.length ? ` filtered by ${model.chips.map((c) => c.label).join(' × ')}` : ''

  function downloadExcel(levels: Level[]) {
    if (!engine || !ctx) return
    const summaries = levels.map((lv) => ({ name: `${LEVEL_LABEL[lv]} summary`, rows: levelSummaryRows(engine, lv) }))
    downloadWorkbook(`${fileBase}_device_tracking.xlsx`, ctx, summaries)
  }

  const crumbButton = (current: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      disabled={current}
      style={{
        padding: '4px 10px',
        minHeight: 32,
        borderRadius: 6,
        border: 0,
        fontSize: 13,
        fontWeight: 600,
        background: current ? '#E4ECF5' : 'transparent',
        color: current ? 'var(--color-text)' : 'var(--color-primary)',
        cursor: current ? 'default' : 'pointer',
        textDecoration: current ? 'none' : 'underline',
      }}
    >
      {label}
    </button>
  )

  const hasRows = !!data && data.rows.length > 0
  const missingColumns = data?.missingColumns ?? []
  const showDashboard = hasRows && missingColumns.length === 0 && !!model && !!ctx && !!data && data.days.length > 0

  return (
    <div>
      <style>{`
        .dt-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
        @media (max-width: 900px) { .dt-pair { grid-template-columns: minmax(0, 1fr); } }
        .dt-seg:hover { filter: brightness(1.12); }
        .dt-areaname:hover:not(:disabled) { text-decoration: underline; }
        .dt-body button:focus-visible, .dt-body select:focus-visible { outline: 2px solid #1F5FA8; outline-offset: 2px; }
      `}</style>

      <div ref={formRef}>
        <DeviceTrackingForm onSubmit={handleSubmit} submitting={submitting} />
      </div>

      {error && (
        <div
          style={{
            background: '#fdecea',
            border: '1px solid var(--color-critical)',
            color: '#7a2020',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {submitting && (
        <div role="status" aria-live="polite" style={{ ...noticeStyle, borderLeft: '4px solid var(--color-primary)' }}>
          <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>Analysing teams and devices…</h3>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
            Cleaning the tracks, placing every team by its code or location, then checking each team-device-day. Large tracks files can take several
            minutes — the dashboard appears here when the run finishes.
          </div>
        </div>
      )}

      <JobProgress jobId={logJobId} running={submitting} steps={GTS_STEPS} />

      {!result && !submitting && !error && (
        <div style={{ ...noticeStyle, borderStyle: 'dashed' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>No team and device analysis yet</h3>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
            Upload a GTS tracks file and enter the activity code above, then run the analysis. The dashboard shows teams against devices, device
            reporting by day, phones against vaccine buddies, tracks per device-day against a calculated threshold, missed work days, device /
            work-rate / assignment / team-code flags, and line lists of invalid team codes and code–device conflicts. Select any chart part to filter
            the whole page.
          </div>
        </div>
      )}

      {result && !submitting && !hasRows && (
        <div role="status" style={{ ...noticeStyle, borderLeft: '4px solid var(--color-warning)' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>The analysis returned no team-device days</h3>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
            The run finished without an error, but the result has no rows
            {runInfo?.fileName ? (
              <>
                {' '}
                for <b style={{ color: 'var(--color-text)' }}>{runInfo.fileName}</b>
              </>
            ) : null}
            . Check that the tracks file covers the campaign period, then run it again.
          </div>
          <button
            type="button"
            onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            style={{
              marginTop: 12,
              background: 'none',
              border: '1px solid var(--color-primary)',
              color: 'var(--color-primary)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ↑ Back to the form
          </button>
        </div>
      )}

      {result && !submitting && hasRows && missingColumns.length > 0 && (
        <div style={{ background: '#fdecea', border: '1px solid var(--color-critical)', color: '#7a2020', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, marginBottom: 20 }}>
          The result is missing the column{missingColumns.length > 1 ? 's' : ''} <b>{missingColumns.join(', ')}</b>, so the dashboard can't be drawn. The
          backend response has changed shape — it returned: {result.columns.join(', ') || '(no columns)'}.
        </div>
      )}

      {showDashboard && data && model && ctx && (
        <div className="dt-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* header */}
          <header style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Team &amp; Device Tracking</div>
              <h2 style={{ margin: 0, fontSize: 22 }}>{runInfo?.fileName || 'Team & device tracking'}</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                <span style={{ background: '#E4ECF5', borderRadius: 6, padding: '3px 8px' }}>
                  Campaign code <b style={monoStyle}>{runInfo?.activityCode}</b>
                </span>
                <span style={{ background: '#E4ECF5', borderRadius: 6, padding: '3px 8px' }}>
                  {data.days[0].long} – {data.days[data.days.length - 1].long} · {data.days.length} {data.days.length === 1 ? 'day' : 'days'}
                </span>
                <span style={{ background: '#E4ECF5', borderRadius: 6, padding: '3px 8px' }}>{fmt(data.rows.length)} team-device-days</span>
              </div>
            </div>
            <ExcelDownloadMenu
              key={`${scope.state}|${scope.lga}|${scope.ward}`}
              scopeName={model.scopeName}
              scopeLine={`${model.rangeText}${filterText}`}
              hasState={!!scope.state}
              hasLga={!!scope.lga}
              onDownload={downloadExcel}
            />
          </header>

          <DeviceFilterBar
            stateOptions={stateOptions}
            lgaOptions={lgaOptions}
            wardOptions={wardOptions}
            scope={scope}
            onScopeChange={setScope}
            days={data.days}
            from={from}
            to={to}
            onRangeChange={(f, t) => {
              setFrom(f)
              setTo(t)
            }}
            onReset={resetFilters}
            rangeLabel={`Showing ${model.rangeText}${from > to ? ' (From and To swapped)' : ''}`}
          />

          <DeviceFilterChips chips={model.chips} onRemove={removeChip} onClearAll={() => setSel({})} />

          {/* scope bar */}
          <nav
            aria-label="Area drill-down"
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '8px 12px' }}
          >
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Showing</span>
            {crumbButton(!scope.state, () => setScope(NO_SCOPE), 'All states')}
            {scope.state && (
              <>
                <span aria-hidden style={{ color: 'var(--color-text-muted)' }}>›</span>
                {crumbButton(!scope.lga, () => setScope({ state: scope.state, lga: null, ward: null }), `${scope.state} State`)}
              </>
            )}
            {scope.lga && (
              <>
                <span aria-hidden style={{ color: 'var(--color-text-muted)' }}>›</span>
                {crumbButton(!scope.ward, () => setScope({ state: scope.state, lga: scope.lga, ward: null }), `${scope.lga} LGA`)}
              </>
            )}
            {scope.ward && (
              <>
                <span aria-hidden style={{ color: 'var(--color-text-muted)' }}>›</span>
                {crumbButton(true, () => undefined, `${scope.ward} ward`)}
              </>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              {leaf ? 'Ward level: names do not drill further' : `Select a ${levelNoun} name in any chart to drill down; the area filters follow`}
            </span>
          </nav>

          <DeviceKpiGrid kpis={model.kpis} />

          <SectionHeading>Deployment</SectionHeading>
          <Pair>
            <TeamsDevicesChart rows={model.teamsDevices} levelNoun={levelNoun} leaf={leaf} onDrill={handleDrill} resetKey={resetKey} onCsv={() => csv('teams_vs_devices', teamsDevicesRows(ctx))} />
            <DayHeatGrid
              title={`Device reporting by day, by ${levelNoun}`}
              blurb="Share of deployed devices that sent at least one track that day. Darker = more devices reporting. Select a day to filter the page to it."
              csvLabel="Download device reporting by day as CSV"
              onCsv={() => csv('device_reporting', reportingRows(ctx))}
              days={data.days}
              dayIdx={model.dayIdx}
              rows={model.reporting.map((r) => ({
                name: r.name,
                cells: model.dayIdx.map((i, j) => {
                  const p = r.devices ? r.reporting[j] / r.devices : 0
                  return { text: `${Math.round(p * 100)}%`, t: Math.max(0, (p - 0.3) / 0.7), title: `${r.name} · ${data.days[i].label}: ${r.reporting[j]} of ${r.devices} devices` }
                }),
              }))}
              selDay={sel.day}
              dayOn={!!engine?.dayOn}
              onPickDay={(i) => handleToggle('day', i)}
              levelNoun={levelNoun}
              leaf={leaf}
              onDrill={handleDrill}
              resetKey={resetKey}
            />
          </Pair>

          <DeviceTypeSection
            types={model.types}
            days={data.days}
            scopeName={model.scopeName}
            levelNoun={levelNoun}
            leaf={leaf}
            onDrill={handleDrill}
            resetKey={resetKey}
            sel={sel}
            onToggle={handleToggle}
            dayOn={!!engine?.dayOn}
            onCsvArea={() => csv('phones_vs_vaccine_buddies', typesAreaRows(ctx))}
            onCsvDate={() => csv('devices_reporting_by_type', typesDateRows(ctx))}
          />

          <SectionHeading>Tracks</SectionHeading>
          <Pair>
            <DayHeatGrid
              title={`Daily tracks by ${levelNoun}`}
              blurb={`GPS points per day, in thousands. Bottom row is the total for ${model.scopeName}.`}
              csvLabel="Download daily tracks as CSV"
              onCsv={() => csv('daily_tracks', tracksRows(ctx))}
              days={data.days}
              dayIdx={model.dayIdx}
              rows={(() => {
                const max = Math.max(1, ...model.tracks.rows.flatMap((r) => r.tracks))
                return model.tracks.rows.map((r) => ({
                  name: r.name,
                  cells: model.dayIdx.map((i, j) => ({ text: r.tracks[j] >= 1000 ? `${(r.tracks[j] / 1000).toFixed(1)}k` : String(r.tracks[j]), t: r.tracks[j] / max, title: `${r.name} · ${data.days[i].label}: ${fmt(r.tracks[j])} tracks` })),
                }))
              })()}
              totals={model.tracks.totals.map((t) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t)))}
              selDay={sel.day}
              dayOn={!!engine?.dayOn}
              onPickDay={(i) => handleToggle('day', i)}
              levelNoun={levelNoun}
              leaf={leaf}
              onDrill={handleDrill}
              resetKey={resetKey}
            />
            <DevicesTracksCombo
              rows={model.combo.rows}
              maxDevices={model.combo.maxDevices}
              maxTracks={model.combo.maxTracks}
              threshold={model.threshold}
              scopeName={model.scopeName}
              levelNoun={levelNoun}
              leaf={leaf}
              onDrill={handleDrill}
              resetKey={resetKey}
              onCsv={() => csv('devices_and_tracks', devicesTracksRows(ctx))}
            />
          </Pair>

          <SectionHeading>Work days</SectionHeading>
          <MissedDaysSection
            missed={model.missed}
            scopeName={model.scopeName}
            levelNoun={levelNoun}
            leaf={leaf}
            onDrill={handleDrill}
            resetKey={resetKey}
            sel={sel}
            onToggle={handleToggle}
            onCsvArea={() => csv('missed_days_by_area', missedAreaRows(ctx))}
            onCsvDistribution={() => csv('missed_days_distribution', missedDistributionRows(ctx))}
          />

          <SectionHeading>Flags</SectionHeading>
          <p style={{ margin: '-10px 0 0', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            Counted per team-device per day. A name drills down. A coloured part of a bar, a legend item or a day filters the whole page to it; the chart you
            clicked keeps its other parts, faded, so you can pick again.
          </p>
          {model.flags.map((fm) => (
            <FlagSetSection
              key={fm.set.id}
              model={fm}
              days={data.days}
              scopeName={model.scopeName}
              levelNoun={levelNoun}
              leaf={leaf}
              onDrill={handleDrill}
              resetKey={resetKey}
              sel={sel}
              onToggle={handleToggle}
              dayOn={!!engine?.dayOn}
              onCsvArea={() => csv(`${fm.set.id}_flags_by_area`, flagAreaRows(ctx, fm))}
              onCsvDate={() => csv(`${fm.set.id}_flags_by_date`, flagDateRows(ctx, fm))}
            />
          ))}

          <DeviceLineListTable
            title={`Invalid team codes in ${model.scopeName}`}
            blurb="One row per team code and device seen in the selected days. The area is where the device's tracks fell, since the code cannot place the team."
            summary={
              model.invalid.length
                ? `${model.invalid.length} code–device pairs, ${new Set(model.invalid.map((x) => x.code)).size} distinct codes.`
                : `No invalid team codes in ${model.scopeName} for the current filters.`
            }
            csvLabel="invalid team codes"
            onCsvPage={(rows, page) => csv(`invalid_team_codes_page_${page}`, invalidCodeRows(rows))}
            onCsvAll={() => csv('invalid_team_codes', invalidCodeRows(model.invalid))}
            rows={model.invalid}
            rowKey={(r, i) => `${r.state}|${r.lga}|${r.ward}|${r.code}|${r.imei}|${i}`}
            columns={[
              { label: 'State', render: (r) => r.state },
              { label: 'LGA', render: (r) => r.lga },
              { label: 'Ward', render: (r) => r.ward },
              { label: 'Team code (as recorded)', mono: true, render: (r) => <span style={{ color: '#9F1239', fontWeight: 500 }}>{r.code}</span> },
              { label: 'IMEI', mono: true, render: (r) => r.imei },
              { label: 'Problem', render: (r) => r.problem },
              { label: 'Days seen', align: 'right', mono: true, render: (r) => r.days },
              { label: 'Tracks', align: 'right', mono: true, render: (r) => fmt(r.tracks) },
            ]}
          />

          <DeviceLineListTable
            title={`Code–device conflicts in ${model.scopeName}`}
            blurb="A team code that sent tracks from several devices, or a device that sent tracks under several team codes, on the same day."
            summary={
              model.conflicts.length
                ? `${model.conflicts.filter((x) => x.kind.startsWith('Team')).length} team codes used on several devices, ${model.conflicts.filter((x) => x.kind.startsWith('Device')).length} devices used under several codes.`
                : `No code–device conflicts in ${model.scopeName} for the current filters.`
            }
            csvLabel="code–device conflicts"
            onCsvPage={(rows, page) => csv(`code_device_conflicts_page_${page}`, conflictRowsForExport(rows))}
            onCsvAll={() => csv('code_device_conflicts', conflictRowsForExport(model.conflicts))}
            rows={model.conflicts}
            rowKey={(r, i) => `${r.kind}|${r.codes.join(',')}|${r.imeis.join(',')}|${i}`}
            columns={[
              { label: 'State', render: (r) => r.state },
              { label: 'LGA', render: (r) => r.lga },
              { label: 'Ward', render: (r) => r.ward },
              {
                label: 'Conflict',
                render: (r) => (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      background: r.kind.startsWith('Team') ? '#D5EFEC' : '#E7F6F4',
                      color: r.kind.startsWith('Team') ? '#0B5E57' : '#155E57',
                    }}
                  >
                    {r.kind}
                  </span>
                ),
              },
              { label: 'Team code(s)', mono: true, render: (r) => r.codes.join('\n') },
              { label: 'IMEI(s)', mono: true, render: (r) => r.imeis.join('\n') },
              { label: 'Days', align: 'right', mono: true, render: (r) => r.days },
            ]}
          />

          <DeviceFlagDefinitions />
        </div>
      )}
    </div>
  )
}
