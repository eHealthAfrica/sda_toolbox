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

`tracks` keeps only rows the backend would keep anyway (speed below 1 m/s,
07:00-16:59), so the fixture is not emptied by its own input filter. It prints
the activity code found in the team codes: put that in the manifest as the
`activity_code` for gts_device_tracking.

Needs pandas (already in the project's environment); .xlsx also needs openpyxl.
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

MAX_BYTES = 1_000_000
TIME_FORMAT = '%m/%d/%Y %H:%M:%S'


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Trim real files into small canary fixtures')
    sub = parser.add_subparsers(dest='command', required=True)
    tracks = sub.add_parser('tracks', help='keep a few teams from the busiest day of a tracks file')
    tracks.add_argument('--teams', type=int, default=3)
    tracks.add_argument('--max-rows', type=int, default=1500)
    head = sub.add_parser('head', help='keep the first rows of a table')
    head.add_argument('--max-rows', type=int, default=150)
    for command in (tracks, head):
        command.add_argument('--src', required=True, type=Path)
        command.add_argument('--out', required=True, type=Path)
    args = parser.parse_args(argv)

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
