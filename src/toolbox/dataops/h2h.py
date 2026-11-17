"""Data checks for H2H settlement tracking (POST /tracking/gridded).

The analysis reads a settlement list (the DIP) and a tracks file, and fails in
several ways that say little about the cause:

  * a settlement list with no state column, or no way to build a unique
    settlement name (State_LGA_Ward_Settlement), crashes in the middle of the
    set-up with a KeyError;
  * for any day after the first, the settlement list must be the result of the
    previous day's run (it must hold the column `day_<N-1>_cumm`); uploading
    the original list instead raises a bare KeyError;
  * a list that already has a `visitation` or `track_count` column breaks the
    merge that adds them (they come back as visitation_x / visitation_y);
  * a state name that is not a known State raises KeyError.

Those are reported up front as data-contract failures that say what to fix.
Output checks only produce warnings.

Column lookups use the tool's own fuzzy matchers (get_admin_col,
detect_unique_admin_field) so the check agrees with what the analysis will do.
They are imported lazily and can be replaced with `find_admin_col` /
`find_unique_col`.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

import pandas as pd

from toolbox.dataops import reach as reach_checks
from toolbox.dataops.checks import (
    Finding, Report, require_columns, require_crs, require_non_empty, max_invalid_geometries,
    max_value_share, row_count_ratio,
)

TOOL = 'h2h'
ADMIN_LEVELS = ('state', 'lga', 'ward', 'settlement')
# Columns the analysis adds to the settlement list itself (campaign_tools /
# visitation_analysis); the output drops them again (DROPPING.H2H in config.yaml).
RESERVED_COLUMNS = ('visitation', 'track_count')
INCOMPLETE_NAMES_WARN = 0.05
COLUMNS_SHOWN = 40


def resolve_states(state_values: pd.Series, state_enum: Any = None) -> list:
    """The settlement list's states as State members; a blank, non-text or
    unknown state raises a DataContractError that lists the offending values."""
    return reach_checks.resolve_states(state_values, state_enum, tool=TOOL)


def _default_admin_finder(data: pd.DataFrame, level: str) -> Optional[str]:
    from toolbox.mlos import get_admin_col
    return get_admin_col(data, level, error='ignore')


def _default_unique_finder(data: pd.DataFrame) -> Optional[str]:
    from toolbox.mlos import detect_unique_admin_field
    return detect_unique_admin_field(data)


def _safe(finder: Callable, *args: Any) -> Optional[str]:
    try:
        return finder(*args)
    except Exception:
        return None


def validate_settlements(
    settlements: pd.DataFrame,
    analysis_day: int,
    *,
    report: Optional[Report] = None,
    find_admin_col: Optional[Callable[[pd.DataFrame, str], Optional[str]]] = None,
    find_unique_col: Optional[Callable[[pd.DataFrame], Optional[str]]] = None,
) -> Report:
    """The settlement-list half of the input checks, for the route to run as
    soon as that file is read (before the slower tracks upload is). Raises
    DataContractError when the analysis cannot run on it."""
    report = report if report is not None else Report(TOOL)
    _add_settlement_findings(report, settlements, analysis_day, find_admin_col, find_unique_col)
    return _stop_if_fatal(report)


def validate_tracks(tracks: pd.DataFrame, *, report: Optional[Report] = None) -> Report:
    """The tracks half of the input checks (run after the tracks are read and
    filtered). Raises DataContractError when there is nothing to analyse."""
    report = report if report is not None else Report(TOOL)
    _add_track_findings(report, tracks)
    return _stop_if_fatal(report)


def validate_input(
    settlements: pd.DataFrame,
    tracks: pd.DataFrame,
    analysis_day: int,
    *,
    report: Optional[Report] = None,
    find_admin_col: Optional[Callable[[pd.DataFrame, str], Optional[str]]] = None,
    find_unique_col: Optional[Callable[[pd.DataFrame], Optional[str]]] = None,
) -> Report:
    """Both halves at once; every problem found is reported together."""
    report = report if report is not None else Report(TOOL)
    _add_settlement_findings(report, settlements, analysis_day, find_admin_col, find_unique_col)
    _add_track_findings(report, tracks)
    return report.raise_if_fatal()


def _stop_if_fatal(report: Report) -> Report:
    """Raise on a fatal finding. Unlike Report.raise_if_fatal this does not log the
    warnings found so far: the route calls check_output at the end, which logs them once."""
    if report.fatal:
        report.raise_if_fatal()
    return report


def _add_settlement_findings(
    report: Report, settlements: pd.DataFrame, analysis_day: int,
    find_admin_col: Optional[Callable], find_unique_col: Optional[Callable],
) -> None:
    find_admin_col = find_admin_col or _default_admin_finder
    find_unique_col = find_unique_col or _default_unique_finder

    if analysis_day is None or analysis_day < 1:
        report.add(Finding(
            'invalid_analysis_day', f'The analysis day must be 1 or higher (got {analysis_day}).', True,
            {'field': 'analysis_day', 'value': analysis_day}))

    empty = require_non_empty(
        settlements, 'The settlement list', code='no_settlements', message='The settlement list has no rows.')
    report.add(empty)
    if empty is None:
        report.add(
            _check_state_column(settlements, find_admin_col),
            _check_unique_code(settlements, find_admin_col, find_unique_col),
            _check_previous_day(settlements, analysis_day),
            _check_reserved_columns(settlements),
        )


def _add_track_findings(report: Report, tracks: pd.DataFrame) -> None:
    empty = require_non_empty(
        tracks, 'The tracks file', code='no_valid_tracks',
        message='No usable tracks remain after removing invalid ones '
                '(speed of 1 m/s or more, or outside 07:00-16:59, or unreadable coordinates).')
    report.add(empty)
    if empty is None:
        report.add(
            require_columns(tracks, ['geometry'], 'The tracks file'),
            require_crs(tracks, 'The tracks file'),
            max_invalid_geometries(tracks, 'tracks'),
        )


def _check_state_column(settlements: pd.DataFrame, find_admin_col: Callable) -> Optional[Finding]:
    if _safe(find_admin_col, settlements, 'state') is not None:
        return None
    return Finding(
        'missing_state_column',
        "The settlement list has no state column; one is needed to know which state boundaries to use.",
        True, {'columns_found': [str(c) for c in list(settlements.columns)[:COLUMNS_SHOWN]]})


def _check_unique_code(
    settlements: pd.DataFrame, find_admin_col: Callable, find_unique_col: Callable,
) -> Optional[Finding]:
    """The list needs a unique-name column already, or the four admin columns
    to build one from (what CampaignDatasets does)."""
    if _safe(find_unique_col, settlements) is not None:
        return None
    found = {level: _safe(find_admin_col, settlements, level) for level in ADMIN_LEVELS}
    missing = [level for level, col in found.items() if col is None]
    if missing:
        return Finding(
            'no_unique_settlement_code',
            'The settlement list has no unique settlement name column (State_LGA_Ward_Settlement), and no '
            f"{', '.join(missing)} column to build one from.",
            True, {'missing': missing, 'columns_found': [str(c) for c in list(settlements.columns)[:COLUMNS_SHOWN]]})

    # A name is built only when all four parts are present; any blank part
    # leaves that settlement with no code, so it can never be matched.
    parts = settlements[[col for col in found.values() if col is not None]]
    blank = parts.isna() | parts.astype(str).apply(lambda column: column.str.strip().eq(''))
    n, total = int(blank.any(axis=1).sum()), len(settlements)
    if total and n / total > INCOMPLETE_NAMES_WARN:
        return Finding(
            'incomplete_settlement_names',
            f'{n / total * 100:.1f}% of settlements ({n:,} of {total:,}) are missing a state, LGA, ward or '
            'settlement name, so they get no code and cannot be matched to the grids.',
            False, {'blank': n, 'total': total})
    return None


def _check_previous_day(settlements: pd.DataFrame, analysis_day: int) -> Optional[Finding]:
    if analysis_day is None or analysis_day <= 1:
        return None
    needed = f'day_{analysis_day - 1}_cumm'
    if needed in settlements.columns:
        return None
    similar = [str(c) for c in settlements.columns if str(c).lower().endswith('_cumm')]
    return Finding(
        'previous_day_missing',
        f"Day {analysis_day} builds on day {analysis_day - 1}'s result, but the settlement list has no "
        f"'{needed}' column. Upload the file produced by the day {analysis_day - 1} run instead of the original list.",
        True, {'needed': needed, 'cumulative_columns_found': similar[:COLUMNS_SHOWN]})


def _check_reserved_columns(settlements: pd.DataFrame) -> Optional[Finding]:
    present = [c for c in RESERVED_COLUMNS if c in settlements.columns]
    if not present:
        return None
    quoted = ', '.join(f"'{c}'" for c in present)
    return Finding(
        'reserved_columns',
        f'The settlement list already has {quoted}, which the analysis creates itself and cannot overwrite. '
        'Remove or rename the column(s) and upload again.',
        True, {'columns': present})


def check_output(report: Report, results: pd.DataFrame, settlements_in: int) -> Report:
    """Add warnings about the finished settlement table to `report`.
    `settlements_in` is the number of rows in the list as uploaded."""
    report.add(
        require_non_empty(results, 'The H2H result', code='empty_result', fatal=False,
                          message='The H2H analysis produced no rows, so the output file is empty.'),
        row_count_ratio(len(results), settlements_in, 'The H2H result', 'the settlement list', max_ratio=1.0),
        max_value_share(
            results, 'Settlement Coverage', 'No Coverage', 'settlements', warn_above=0.999, min_rows=20,
            code='no_settlement_covered',
            message="None of the {total:,} settlements has any coverage. Check that the tracks are for the same "
                    "state and campaign as the settlement list, and that the settlement names match the grids."),
    )
    report.log()
    return report
