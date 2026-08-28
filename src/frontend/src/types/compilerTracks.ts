// Compiler · Tracks — POST /compiler/tracks (toolbox/apps/aggregators/tracks.py
// combine_tracks). Reads one or many uploaded track files, optionally clips
// to one or more state boundaries, and streams back a SINGLE GeoPackage
// (.gpkg) — not a zip, despite the route's own docstring calling it a
// "downloadable zipped sqlite file" (tracks.to_file(buffer, driver="GPKG",
// layer='tracks', ...) never zips anything).
//
// Backend params, from the real signature — `tracks_path: UploadFile,
// tracks_extension: Extensions, background_tasks: BackgroundTasks,
// states: list[State] | None = Query(default_factory=None),
// remove_invalid_tracks: bool = True`: the route was updated from a single
// optional `state` to a `states` LIST — clipping now unions every selected
// state's boundary instead of clipping to just one. Only `tracks_path` is
// annotated as UploadFile, so it's the only multipart form field;
// `tracks_extension`/`states`/`remove_invalid_tracks` have no Form()/Query()
// annotation at all beyond `states`' own `Query(...)` wrapper, which FastAPI
// resolves as plain (repeatable) Query params — sent on the URL, not in the
// FormData body, one `states=<name>` pair per selection (see
// api/client.ts::submitCombineTracks). The route's own docstring still
// describes a single `state: State` param — it hasn't been updated to match
// the new signature yet, but the plural, repeatable-param behavior is what's
// actually implemented.
//
// ⚠ Real, code-confirmed finding (see the design proposal / chat disclosure
// for the full trace): "remove_invalid_tracks" (default on) doesn't just
// drop points with speed > 1 m/s the way the docstring implies. The actual
// filter — tracks_manager/preprocess.py::filter_valid_tracks, which wraps
// every call to read_tracks — ALSO drops every point whose GPS timestamp
// hour is after 4pm (`timestamp.dt.hour <= 16`), regardless of speed, with
// no mention of that cutoff anywhere in the endpoint's docs. There's a
// second, unconditional filter underneath both: any row whose lat/lon/speed
// value doesn't match a numeric coordinate pattern is dropped before either
// check runs, whether or not remove_invalid_tracks is on. The docstring/API
// documentation for this route hasn't been updated yet — but the filter
// criteria itself (speed > 1 m/s OR after 4pm, on top of the unconditional
// coordinate-pattern check) has been confirmed accurate as implemented, so
// this page now surfaces how many points it removed rather than treating it
// as unknowable. See utils/compilerTracksOriginalCount.ts for how: it counts
// rows/features in the RAW upload (client-side, before the request is even
// sent) and the page computes dropped = originalCount − pointsReturned. That
// deliberately does NOT re-implement the filter's own pandas/regex logic
// client-side (real risk of subtle drift) — it just diffs input against
// output, so the number stays correct no matter how the backend's filtering
// is implemented or later changed.
//
// Output format note: the response is a single un-zipped .gpkg — a
// GeoPackage IS a SQLite database, so it's read client-side the same way as
// utils/gpkg.ts already reads Target Area's GeoPackage layers (sql.js /
// WASM SQLite), just without an outer JSZip unwrap step first.

import type { StateName } from './h2h'

export const TRACKS_LAYER_NAME = 'tracks'

export interface TracksFormInput {
  tracksFile: File | null
  tracksExtension: string
  /** Empty array = no clipping, keep every compiled point (mirrors the backend's `states=None` default). */
  states: StateName[]
  removeInvalidTracks: boolean
}

// One compiled track point, read directly off the GeoPackage's attribute
// columns (not the geometry blob) — the backend's own filter_valid_tracks
// already casts these lat/lon/speed columns to float32 in place under
// whatever column names the uploaded file used, fuzzy-matched the same way
// server-side (see utils/columns.ts::findLatitudeColumnStrict and friends).
export interface TrackPoint {
  latitude: number
  longitude: number
  speedMps: number | null
  gpsTimestamp: string | null
  raw: Record<string, string | number | null>
}

// See utils/compilerTracksOriginalCount.ts. `supported: false` means this
// upload's extension has no client-side parser (sqlite/kml/kmz) — the page
// shows that plainly rather than a fabricated or guessed number.
export interface TracksOriginalCount {
  supported: boolean
  count: number
}

export interface ParsedTracksResult {
  points: TrackPoint[]
  columns: string[]
  latColumn: string | null
  lonColumn: string | null
  speedColumn: string | null
  timestampColumn: string | null
  /** Rows present in the GeoPackage layer but missing usable lat/lon — skipped from the map, not counted as "dropped" (that's a server-side concept; see the file-level comment above). */
  unplottable: number
}
