#!/usr/bin/env python3
"""Trim real files into small canary fixtures (under 1 MB each).

Runs on YOUR machine against files you already have; nothing is uploaded
anywhere. Always open the result and check it holds nothing you would not want
kept in the repository before you commit it.

  # a few teams' tracks from one busy day (GTS tracks CSV or XLSX)
  python scripts/make_canary_fixture.py tracks --src "C:\\data\\gts_tracks.csv" \\
      --out tests/fixtures/canary/gts_device_tracking/tracks.csv

  # the first rows of any settlement list / DIP / MLoS (CSV or XLSX)
  python scripts/make_canary_fixture.py head --src "C:\\data\\dip.xlsx" \\
      --out tests/fixtures/canary/h2h/dip.xlsx --max-rows 150

  # one LGA's worth of ALL the tool fixtures at once, so they agree with each other
  # (tracks that really walk through that LGA's settlements, its settlement list,
  # and the data-source rows for it). First see which LGAs are good candidates:
  python scripts/make_canary_fixture.py areas --tracks "C:\\data\\Tracks.csv" \\
      --settlements "C:\\data\\Final Settlements List.csv" --sources "C:\\data\\Data Sources.xlsx"
  # then build the fixtures for the one you pick:
  python scripts/make_canary_fixture.py area --tracks ... --settlements ... --sources ... \\
      --state Sokoto --lga Tureta --out-dir tests/fixtures/canary

`tracks` keeps only rows the backend would keep anyway (speed below 1 m/s,
07:00-16:59), so the fixture is not emptied by its own input filter. It prints
the activity code found in the team codes: put that in the manifest as the
`activity_code` for gts_device_tracking.

Needs pandas (already in the project's environment); .xlsx also needs openpyxl.
"""
import argparse
import csv
import hashlib
import re
import sys
from pathlib import Path

import pandas as pd

MAX_BYTES = 1_000_000
TIME_FORMAT = '%m/%d/%Y %H:%M:%S'
NEAR_METRES = 400  # a track point "belongs" to the settlement nearest to it when that is closer than this
DEGREE_METRES = 111_000
# Columns a previous H2H run added to a settlement list; the clean planned list must not carry them
# (the tool refuses a list that already has `visitation`/`track_count`, and day_N_cumm confuses day 1).
RESULT_COLUMNS = re.compile(
    r'^(day_\d+(_cumm)?|time_spent_mins|time spent|settlement coverage|coverage|visitation|track_count)$', re.IGNORECASE)


def read_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == '.csv':
        return pd.read_csv(path, dtype=str, keep_default_na=False)
    if path.suffix.lower() in ('.xlsx', '.xls'):
        return pd.read_excel(path, dtype=str, keep_default_na=False)
    raise SystemExit(f'Unsupported file type {path.suffix!r}: use .csv or .xlsx')


def write_table(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == '.csv':
        df.to_csv(path, index=False)
    elif path.suffix.lower() in ('.xlsx', '.xls'):
        df.to_excel(path, index=False)
    else:
        raise SystemExit(f'Unsupported output type {path.suffix!r}: use .csv or .xlsx')


def find_column(df: pd.DataFrame, *words: str) -> str | None:
    for column in df.columns:
        lowered = column.lower()
        if all(word in lowered for word in words):
            return column
    return None


def trim_tracks(df: pd.DataFrame, teams: int, max_rows: int) -> tuple[pd.DataFrame, dict]:
    team_col = find_column(df, 'team', 'code')
    stamp_col = find_column(df, 'timestamp')
    speed_col = find_column(df, 'speed')
    if not (team_col and stamp_col):
        raise SystemExit(f'Could not find a team-code and a timestamp column. Columns found: {list(df.columns)}')

    stamps = pd.to_datetime(df[stamp_col], format=TIME_FORMAT, errors='coerce')
    keep = stamps.notna()
    if speed_col:
        keep &= pd.to_numeric(df[speed_col], errors='coerce') < 1
    keep &= stamps.dt.hour.between(7, 16)
    usable = df[keep].copy()
    usable['_stamp'] = stamps[keep]
    if usable.empty:
        raise SystemExit('No rows pass the backend\'s own filters (speed < 1, 07:00-16:59). Check the file.')

    usable['_day'] = usable['_stamp'].dt.date
    day = usable['_day'].value_counts().idxmax()
    day_rows = usable[usable['_day'] == day]
    chosen = day_rows[team_col].value_counts().head(teams).index.tolist()
    per_team = max(1, max_rows // max(len(chosen), 1))
    parts = [day_rows[day_rows[team_col] == team].sort_values('_stamp').head(per_team) for team in chosen]
    trimmed = pd.concat(parts).sort_values(['_stamp'])

    code_parts = chosen[0].upper().replace('/', '-').replace('_', '-').replace(' ', '').split('-') if chosen else []
    info = {'day': day, 'teams': chosen, 'activity_code': code_parts[3] if len(code_parts) > 3 else None}
    return trimmed.drop(columns=['_stamp', '_day']), info


# --- one area, all tools --------------------------------------------------------------------------

def read_tracks_tolerant(path: Path) -> tuple[pd.DataFrame, int]:
    """Read a tracks CSV/XLSX; returns (table, malformed_rows_skipped).

    Real exports sometimes hold a team code with a stray comma, which gives one row too many fields
    and stops pandas. The backend skips such rows too, so they are skipped here and counted."""
    if path.suffix.lower() != '.csv':
        return read_table(path), 0
    good, skipped = [], 0
    with open(path, newline='', encoding='utf-8-sig') as handle:
        reader = csv.reader(handle)
        header = next(reader, None)
        if header is None:
            raise SystemExit(f'{path} is empty')
        for row in reader:
            if len(row) == len(header):
                good.append(row)
            else:
                skipped += 1
    return pd.DataFrame(good, columns=header), skipped


def normalise_team_code(code: str) -> str:
    """What the backend does to a team code before using it (tracks_cleanup)."""
    return re.sub(r'\s+', '', str(code).replace('/', '-').replace('_', '-').upper())


def team_pattern(activity_code: str) -> re.Pattern:
    """The shape team_code_review() accepts for this campaign (after normalise_team_code)."""
    return re.compile(r'^[A-Z]{2}-[A-Z0-9]{3}-[A-Z0-9]{3,4}-' + re.escape(activity_code.upper()) + r'-\d{3}$')


def pseudonymise(values: pd.Series) -> pd.Series:
    """Replace device ids with a stable stand-in of the same length (same device -> same stand-in)."""
    def one(value: str) -> str:
        digest = hashlib.sha256(f'canary:{value}'.encode()).hexdigest()
        return digest[:max(len(str(value)), 8)]
    return values.map(one)


def _usable_tracks(df: pd.DataFrame) -> pd.DataFrame:
    """Rows the backend keeps (speed under 1 m/s, 07:00-16:59, readable coordinates), with parsed helpers."""
    stamp_col = find_column(df, 'gps', 'timestamp') or find_column(df, 'timestamp')
    lat_col, lon_col = find_column(df, 'lat'), find_column(df, 'lon')
    speed_col, team_col = find_column(df, 'speed'), find_column(df, 'team', 'code')
    if not (stamp_col and lat_col and lon_col and team_col):
        raise SystemExit(f'Tracks need a team code, timestamp, Lat and Lon column. Columns found: {list(df.columns)}')
    out = df.copy()
    out['_stamp'] = pd.to_datetime(out[stamp_col], format=TIME_FORMAT, errors='coerce')
    out['_lat'] = pd.to_numeric(out[lat_col], errors='coerce')
    out['_lon'] = pd.to_numeric(out[lon_col], errors='coerce')
    keep = out['_stamp'].notna() & out['_lat'].notna() & out['_lon'].notna() & out['_stamp'].dt.hour.between(7, 16)
    if speed_col:
        keep &= pd.to_numeric(out[speed_col], errors='coerce') < 1
    out = out[keep].copy()
    out['_day'] = out['_stamp'].dt.date
    out['_team'] = out[team_col].map(normalise_team_code)
    out.attrs['team_col'] = team_col
    return out


def _settlement_table(df: pd.DataFrame) -> pd.DataFrame:
    state_col, lga_col = find_column(df, 'state'), find_column(df, 'lga')
    lat_col, lon_col = find_column(df, 'lat'), find_column(df, 'lon')
    if not (state_col and lga_col and lat_col and lon_col):
        raise SystemExit(f'The settlement list needs state, LGA, latitude and longitude columns. Columns found: {list(df.columns)}')
    out = df.copy()
    out['_state'] = out[state_col].astype(str).str.strip().str.title()
    out['_lga'] = out[lga_col].astype(str).str.strip()
    out['_lat'] = pd.to_numeric(out[lat_col], errors='coerce')
    out['_lon'] = pd.to_numeric(out[lon_col], errors='coerce')
    return out[out['_lat'].notna() & out['_lon'].notna()].copy()


def _source_rows(sheet: pd.DataFrame, state: str, lga: str) -> pd.DataFrame:
    """The rows of one data-source sheet that belong to state/LGA, by its admin_code (State_LGA_Ward_Settlement)."""
    code_col = find_column(sheet, 'admin_code') or find_column(sheet, 'admin', 'code')
    if code_col:
        prefix = f'{state}_{lga}_'.lower()
        return sheet[sheet[code_col].astype(str).str.lower().str.startswith(prefix)]
    state_col, lga_col = find_column(sheet, 'state'), find_column(sheet, 'lga')
    if state_col and lga_col:
        return sheet[(sheet[state_col].astype(str).str.lower() == state.lower())
                     & (sheet[lga_col].astype(str).str.lower() == lga.lower())]
    return sheet.iloc[0:0]


def _nearest_lga(tracks: pd.DataFrame, settlements: pd.DataFrame) -> pd.DataFrame:
    """Adds `_near_state` / `_near_lga` to the tracks: where the closest settlement is, when within NEAR_METRES."""
    try:
        from scipy.spatial import cKDTree
    except ImportError as error:  # scipy is a project dependency; say so rather than guess
        raise SystemExit('This step needs scipy (it is in the project environment).') from error
    tree = cKDTree(settlements[['_lat', '_lon']].to_numpy())
    distance, index = tree.query(tracks[['_lat', '_lon']].to_numpy())
    out = tracks.copy()
    close = distance * DEGREE_METRES < NEAR_METRES
    out['_near_state'] = pd.Series(settlements['_state'].to_numpy()[index], index=out.index).where(close)
    out['_near_lga'] = pd.Series(settlements['_lga'].to_numpy()[index], index=out.index).where(close)
    return out


def detect_activity_code(tracks: pd.DataFrame) -> str | None:
    """Most common 4th part of the team codes ('SNIPDS' in NA-KEF-SBG-SNIPDS-077). Upper case: the backend
    compares it case-insensitively."""
    counts: dict[str, int] = {}
    for norm in tracks['_team']:
        parts = norm.split('-')
        if len(parts) == 5 and re.fullmatch(r'\d{3}', parts[4]):
            counts[parts[3]] = counts.get(parts[3], 0) + 1
    return max(counts, key=counts.get) if counts else None


def candidate_areas(tracks: pd.DataFrame, settlements: pd.DataFrame, sources: dict[str, pd.DataFrame],
                    activity_code: str, min_teams: int = 3, min_points: int = 100) -> pd.DataFrame:
    """LGAs where at least `min_teams` correctly-coded teams have `min_points`+ usable points on one day, and
    every data source has rows. Smallest settlement list first: a small area makes a small, quick fixture."""
    pattern = team_pattern(activity_code)
    near = _nearest_lga(tracks[tracks['_team'].map(lambda c: bool(pattern.match(c)))], settlements)
    near = near[near['_near_lga'].notna()]
    per_team = near.groupby(['_near_state', '_near_lga', '_day', '_team']).size().reset_index(name='points')
    per_team = per_team[per_team['points'] >= min_points]
    summary = (per_team.groupby(['_near_state', '_near_lga', '_day'])
               .agg(teams=('_team', 'nunique'), points=('points', 'sum')).reset_index())
    summary = summary[summary['teams'] >= min_teams]
    summary = summary.sort_values('points', ascending=False).drop_duplicates(['_near_state', '_near_lga'])
    rows = []
    for _, row in summary.iterrows():
        counts = {name: len(_source_rows(sheet, row['_near_state'], row['_near_lga'])) for name, sheet in sources.items()}
        in_list = int(((settlements['_state'] == row['_near_state']) & (settlements['_lga'] == row['_near_lga'])).sum())
        rows.append({'state': row['_near_state'], 'lga': row['_near_lga'], 'day': row['_day'], 'teams': row['teams'],
                     'track_points': row['points'], 'settlements': in_list, **{f'src:{n}': c for n, c in counts.items()}})
    result = pd.DataFrame(rows)
    if result.empty:
        return result
    source_cols = [c for c in result.columns if c.startswith('src:')]
    result = result[(result[source_cols] > 0).all(axis=1) & (result['settlements'] > 0)]
    return result.sort_values(['settlements', 'track_points'], ascending=[True, False]).reset_index(drop=True)


def read_sources(path: Path) -> dict[str, pd.DataFrame]:
    if path.suffix.lower() in ('.xlsx', '.xls'):
        return pd.read_excel(path, sheet_name=None, dtype=str, keep_default_na=False)
    if path.suffix.lower() == '.csv':
        return {path.stem: read_table(path)}
    raise SystemExit(f'Data sources must be an .xlsx workbook (one sheet per source) or a .csv, not {path.suffix!r}')


def build_area(tracks_raw: pd.DataFrame, settlements_raw: pd.DataFrame, sources: dict[str, pd.DataFrame],
               state: str, lga: str, activity_code: str | None, teams: int, max_track_rows: int,
               max_settlements: int) -> dict:
    """Everything the three tool fixtures need for one LGA, as in-memory tables."""
    tracks = _usable_tracks(tracks_raw)
    settlements = _settlement_table(settlements_raw)
    state = state.strip().title()
    wanted = settlements[(settlements['_state'] == state) & (settlements['_lga'].str.lower() == lga.strip().lower())]
    if wanted.empty:
        raise SystemExit(f'The settlement list has no rows for {state} / {lga}. Run the `areas` command to see what is there.')
    lga = wanted['_lga'].iloc[0]
    activity_code = activity_code or detect_activity_code(tracks)
    if not activity_code:
        raise SystemExit('Could not detect the activity code from the team codes. Pass --activity-code.')

    pattern = team_pattern(activity_code)
    coded = tracks[tracks['_team'].map(lambda c: bool(pattern.match(c)))]
    near = _nearest_lga(coded, settlements)
    local = near[(near['_near_state'] == state) & (near['_near_lga'].str.lower() == lga.lower())]
    if local.empty:
        raise SystemExit(f'No correctly coded team has track points near {lga} settlements. '
                         f'Activity code used: {activity_code}.')
    day = local['_day'].value_counts().idxmax()
    on_day = local[local['_day'] == day]
    chosen = on_day['_team'].value_counts().head(teams).index.tolist()
    per_team = max(1, max_track_rows // len(chosen))
    parts = [coded[(coded['_day'] == day) & (coded['_team'] == team)].sort_values('_stamp').head(per_team)
             for team in chosen]
    track_table = pd.concat(parts).sort_values(['_stamp'])
    helper_cols = [c for c in track_table.columns if c.startswith('_')]
    team_col = tracks.attrs['team_col']
    out_tracks = track_table.drop(columns=helper_cols)
    imei_col = find_column(out_tracks, 'imei')
    if imei_col:
        out_tracks = out_tracks.assign(**{imei_col: pseudonymise(out_tracks[imei_col])})

    plain = wanted.drop(columns=[c for c in wanted.columns if c.startswith('_')])
    plain = plain[[c for c in plain.columns if not RESULT_COLUMNS.match(str(c).strip())]].head(max_settlements)

    source_tables = {name: _source_rows(sheet, state, lga) for name, sheet in sources.items()}
    return {'tracks': out_tracks.reset_index(drop=True), 'settlements': plain.reset_index(drop=True),
            'sources': {k: v.reset_index(drop=True) for k, v in source_tables.items()},
            'info': {'state': state, 'lga': lga, 'day': day, 'teams': chosen, 'activity_code': activity_code,
                     'team_col': team_col}}


def cmd_areas(args: argparse.Namespace) -> int:
    tracks_raw, skipped = read_tracks_tolerant(args.tracks)
    tracks, settlements = _usable_tracks(tracks_raw), _settlement_table(read_table(args.settlements))
    sources = read_sources(args.sources)
    activity = args.activity_code or detect_activity_code(tracks)
    if skipped:
        print(f'Skipped {skipped} malformed track row(s) (too many fields).')
    print(f'Activity code: {activity}. Looking for LGAs with {args.min_teams}+ correctly coded teams, '
          f'{args.min_points}+ points each on one day, and rows in every data source...')
    found = candidate_areas(tracks, settlements, sources, activity, args.min_teams, args.min_points)
    if found.empty:
        print('No LGA qualifies. Lower --min-teams / --min-points, or check the files cover the same campaign.')
        return 1
    print(found.head(args.top).to_string(index=False))
    print('\nPick one and run the `area` command with --state and --lga.')
    return 0


def cmd_area(args: argparse.Namespace) -> int:
    tracks_raw, skipped = read_tracks_tolerant(args.tracks)
    result = build_area(tracks_raw, read_table(args.settlements), read_sources(args.sources), args.state, args.lga,
                        args.activity_code, args.teams, args.max_rows, args.max_settlements)
    out = args.out_dir
    info = result['info']
    plan = {
        'gts_device_tracking/tracks.csv': result['tracks'],
        'reach/tracks.csv': result['tracks'],
        'h2h/tracks.csv': result['tracks'],
        'reach/planned_settlements.xlsx': result['settlements'],
        'h2h/dip.xlsx': result['settlements'],
    }
    worst = 0
    for rel, table in plan.items():
        write_table(table, out / rel)
        size = (out / rel).stat().st_size
        worst = max(worst, size)
        print(f'Wrote {out / rel} ({len(table)} rows, {size / 1024:.0f} KB)')
    workbook = out / 'reach' / 'data_sources.xlsx'
    workbook.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(workbook) as writer:
        for name, table in result['sources'].items():
            table.to_excel(writer, sheet_name=name[:31], index=False)
    size = workbook.stat().st_size
    worst = max(worst, size)
    print(f'Wrote {workbook} ({", ".join(f"{k}: {len(v)}" for k, v in result["sources"].items())} rows, {size / 1024:.0f} KB)')

    print(f"\nArea: {info['state']} / {info['lga']}, track day {info['day']}, teams {', '.join(info['teams'])}")
    print(f"activity_code for the manifest: {info['activity_code']}")
    print('Device ids in the tracks were replaced with stand-ins (same device, same stand-in).')
    if skipped:
        print(f'{skipped} malformed row(s) in the tracks file were skipped, as the backend skips them.')
    empty = [k for k, v in result['sources'].items() if v.empty]
    if empty:
        print(f"WARNING: no rows for this LGA in data source(s): {', '.join(empty)}. REACH rejects an empty source.", file=sys.stderr)
    if worst > MAX_BYTES:
        print('WARNING: a file is larger than 1 MB. Lower --max-rows / --max-settlements.', file=sys.stderr)
        return 1
    print('Open the files and check them before committing them.')
    return 1 if empty else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Trim real files into small canary fixtures')
    sub = parser.add_subparsers(dest='command', required=True)
    for name, text in (('areas', 'list LGAs that make a good all-tools fixture'),
                       ('area', 'build every tool fixture for one LGA')):
        command = sub.add_parser(name, help=text)
        command.add_argument('--tracks', required=True, type=Path)
        command.add_argument('--settlements', required=True, type=Path)
        command.add_argument('--sources', required=True, type=Path, help='workbook with one sheet per data source')
        command.add_argument('--activity-code', default=None, help='default: the most common one in the team codes')
        if name == 'areas':
            command.add_argument('--min-teams', type=int, default=3)
            command.add_argument('--min-points', type=int, default=100)
            command.add_argument('--top', type=int, default=15)
        else:
            command.add_argument('--state', required=True)
            command.add_argument('--lga', required=True)
            command.add_argument('--out-dir', type=Path, default=Path('tests/fixtures/canary'))
            command.add_argument('--teams', type=int, default=3)
            command.add_argument('--max-rows', type=int, default=1200, help='track rows kept, over all teams')
            command.add_argument('--max-settlements', type=int, default=600)
    tracks = sub.add_parser('tracks', help='keep a few teams from the busiest day of a tracks file')
    tracks.add_argument('--teams', type=int, default=3)
    tracks.add_argument('--max-rows', type=int, default=1500)
    head = sub.add_parser('head', help='keep the first rows of a table')
    head.add_argument('--max-rows', type=int, default=150)
    for command in (tracks, head):
        command.add_argument('--src', required=True, type=Path)
        command.add_argument('--out', required=True, type=Path)
    args = parser.parse_args(argv)

    if args.command in ('areas', 'area'):
        for path in (args.tracks, args.settlements, args.sources):
            if not path.is_file():
                print(f'File not found: {path}', file=sys.stderr)
                return 2
        return cmd_areas(args) if args.command == 'areas' else cmd_area(args)

    if not args.src.is_file():
        print(f'Source file not found: {args.src}', file=sys.stderr)
        return 2
    df = read_table(args.src)
    if args.command == 'tracks':
        result, info = trim_tracks(df, args.teams, args.max_rows)
    else:
        result, info = df.head(args.max_rows), {}
    write_table(result, args.out)

    size = args.out.stat().st_size
    print(f'Wrote {args.out} ({len(result)} rows, {size / 1024:.0f} KB) from {len(df)} rows.')
    if info.get('teams'):
        print(f"Day {info['day']}, teams kept: {', '.join(info['teams'])}")
        print(f"activity_code for the manifest: {info['activity_code'] or 'not detected - read it off a team code'}")
    if size > MAX_BYTES:
        print('WARNING: larger than 1 MB. Lower --max-rows (or --teams).', file=sys.stderr)
        return 1
    print('Open the file and check it before committing it.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
