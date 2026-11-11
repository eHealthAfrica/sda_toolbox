// Types + constants for the Team & Device Tracking page (POST /tracking/devices,
// toolbox/apps/tracking/tracks_analysis.py::gts_device_tracking, built on
// toolbox/campaign/device_tracking.py::gts_device_team_analysis).

export interface DeviceTrackingFormInput {
  tracksFile: File | null
  // Campaign code the team codes are checked against, e.g. "IBRA1" — the
  // backend's team_code_review builds the pattern
  // SS-LLL-WWW(W)-<activity code>-NNN from it.
  activityCode: string
  // Optional vaccine-buddy device -> team mapping (the backend merges it on
  // `DEVICE ID` / `TEAM`).
  vaccineBuddyFile: File | null
}

// One row of the CSV POST /tracking/devices returns: one row per team code +
// IMEI + day, columns fixed by gts_device_team_analysis (so, unlike most
// other pages, no fuzzy column detection is needed). `coverage_area_sqm` is
// listed by process_tracks but is not guaranteed to be present, and nothing
// on this page reads it.
export type DeviceTrackingRecord = Record<string, string | number | null>

export interface ParsedDeviceTrackingResult {
  records: DeviceTrackingRecord[]
  columns: string[]
  sourceFilename: string
}

// Columns the page can't do anything useful without — checked once after
// parsing so a backend change shows a clear message instead of an empty
// dashboard.
export const REQUIRED_DEVICE_COLUMNS = ['team_code', 'imei', 'analysis_date', 'track_count'] as const

// ---- flags -----------------------------------------------------------------

export interface FlagCategory {
  key: string
  name: string
  color: string
  rule: string
  // Lower-cased values of the backend flag column that map to this category
  // (empty for the assignment flags, which the page derives itself).
  backendValues: string[]
}

export interface FlagSetDef {
  id: 'device' | 'work' | 'assign' | 'code'
  title: string
  blurb: string
  // Which column of the result the category comes from; 'derived' = worked
  // out client-side from team code x IMEI x day (the backend has no column
  // for it).
  source: 'device_flag' | 'work_rate_flag' | 'team_code_flag' | 'derived'
  cats: FlagCategory[]
}

export const FLAG_SETS: FlagSetDef[] = [
  {
    id: 'device',
    title: 'Device flags',
    blurb: 'Devices whose tracks look broken: no tracking time, or too few points for the time on.',
    source: 'device_flag',
    cats: [
      {
        key: 'nonTracking',
        name: 'Non-tracking',
        color: '#8A3B06',
        rule: 'no time between the first and last point of the day (reported by the backend as "Switched Off")',
        backendValues: ['switched off', 'non-tracking', 'non tracking'],
      },
      {
        key: 'inconsistent',
        name: 'Track inconsistency',
        color: '#F0A35E',
        rule: '(points + 4) ÷ minutes between first and last point is below 0.3',
        backendValues: ['track inconsistency'],
      },
    ],
  },
  {
    id: 'work',
    title: 'Team work-rate flags',
    blurb: 'Team-days whose movement or hours fall short of a working day.',
    source: 'work_rate_flag',
    cats: [
      {
        key: 'noTracking',
        name: 'No tracking',
        color: '#4C1D95',
        rule: 'no time between the first and last point of the day',
        backendValues: ['no tracking'],
      },
      {
        key: 'clustered',
        name: 'Clustered tracks',
        color: '#8B5CF6',
        rule: 'no distance covered between the day’s points',
        backendValues: ['clustered tracks'],
      },
      {
        key: 'lowHours',
        name: 'Low work hours',
        color: '#C4B5FD',
        rule: 'under 3 hours (180 minutes) between the first and last point',
        backendValues: ['low work hours'],
      },
    ],
  },
  {
    id: 'assign',
    title: 'Code–device assignment flags',
    blurb: 'Team codes shared between devices, and devices used under more than one team code, on the same day.',
    source: 'derived',
    cats: [
      {
        key: 'sharedCode',
        name: 'Team code on several devices',
        color: '#0B5E57',
        rule: 'the same team code sent tracks from 2 or more devices on the same day',
        backendValues: [],
      },
      {
        key: 'multiCode',
        name: 'Device under several team codes',
        color: '#5FC4B8',
        rule: 'the same device (IMEI) sent tracks under 2 or more team codes on the same day',
        backendValues: [],
      },
    ],
  },
  {
    id: 'code',
    title: 'Team code flags',
    blurb: 'Team codes that do not follow the campaign pattern, so the team cannot be placed by code.',
    source: 'team_code_flag',
    cats: [
      {
        key: 'invalidCode',
        name: 'Invalid team code',
        color: '#9F1239',
        rule: 'not state code (2) - LGA code (3) - ward code (3 to 4) - campaign code - team number (3 digits), e.g. KE-BRK-GAD-IBRA1-003',
        backendValues: ['invalid team code'],
      },
    ],
  },
]

export const MISSED_BUCKETS = [
  { name: 'None missed', color: '#C9D3DD' },
  { name: '1 day', color: '#F9D3A6' },
  { name: '2 days', color: '#F0A35E' },
  { name: '3 days', color: '#C9621A' },
  { name: '4+ days', color: '#7A3305' },
] as const

// ---- device types ------------------------------------------------------------

// A device is a vaccine buddy when its IMEI starts with "VBU" (the backend's
// match_vb_team_code treats those as vaccine-buddy GTS devices); every other
// device is a team phone. A team carries one or the other, never both.
export type DeviceKind = 'phone' | 'vb'

export const DEVICE_TYPES: ReadonlyArray<{ key: DeviceKind; name: string; color: string }> = [
  { key: 'phone', name: 'Phones', color: '#1F5FA8' },
  { key: 'vb', name: 'Vaccine buddies', color: '#0E8A7E' },
]

// ---- page-wide cross filter ------------------------------------------------------

// A click on a coloured part of any chart (or a legend item, or a day label)
// narrows the whole page to that value. One value per dimension; picking the
// same value again clears it.
export interface Selection {
  day?: number // index into the result's days
  device?: string // key of a device-flag category
  work?: string // key of a work-rate-flag category
  assign?: string // 'sharedCode' | 'multiCode'
  code?: string // 'invalidCode'
  type?: DeviceKind
  missed?: number // index into MISSED_BUCKETS
}
export type SelectionDim = keyof Selection

export const SELECTION_NAMES: Record<SelectionDim, string> = {
  day: 'Day',
  device: 'Device flag',
  work: 'Work-rate flag',
  assign: 'Code–device',
  code: 'Team code',
  type: 'Device type',
  missed: 'Missed days',
}

// By-area charts show this many rows at once; a slider moves through the rest.
export const WINDOW_SIZE = 5
