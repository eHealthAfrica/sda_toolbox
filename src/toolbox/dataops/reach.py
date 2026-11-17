"""Data checks for REACH analysis (POST /validation).

The tool has several ways to go wrong without raising an error:

  * a data-source sheet with no latitude/longitude is skipped by the coordinate
    method (toolbox/triangulate/by_coords.py catches the error and carries on);
  * settlements with a repeated or incomplete name are collapsed into one row
    (`drop_duplicates(subset=unique_col)` in both methods);
  * a state name that is not a known State crashes the job with a KeyError, and
    a sheet with no rows for the planned states crashes it in pd.concat.

The first two are reported as warnings; the crashes are reported up front as
data-contract failures that say what to fix.

Column lookups use the tool's own fuzzy matchers (get_admin_col, GeomColumns)
so the check agrees with what the analysis will do. They are imported lazily
and can be replaced by passing `find_admin_col` / `find_geom_cols`.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

import pandas as pd

from toolbox.errors import DataContractError
from toolbox.dataops.checks import (
    Finding, Report, require_non_empty, max_null_share, max_duplicate_share, max_value_share, row_count_ratio,
)

TOOL = 'reach'
ADMIN_LEVELS = ('state', 'lga', 'ward', 'settlement')
GTS_SOURCE = 'GTS'
VALID_STATES_SHOWN = 40


def resolve_states(state_values: pd.Series, state_enum: Any = None, tool: str = TOOL) -> list:
    """The planned settlements' state names as State members.

    Does what the route used to do inline
    (`[State[n] for n in col.str.strip().str.title().unique()]`), but a blank,
    non-text or unknown state raises a DataContractError that lists the
    offending values instead of a KeyError. `tool` names the calling tool in
    the error details (the H2H route uses this too)."""
    if state_enum is None:
        from toolbox.models import State as state_enum  # lazy: needs the full app

    if state_values.isna().any():
        count = int(state_values.isna().sum())
        raise DataContractError(
            'missing_state_values',
            f'{count:,} settlement row(s) have no state. Every row needs a state name.',
            {'tool': tool, 'rows_without_state': count},
        )
    if not (pd.api.types.is_string_dtype(state_values) or pd.api.types.is_object_dtype(state_values)):
        raise DataContractError(
            'state_not_text', 'The state column should contain state names but contains numbers.', {'tool': tool})

    names = state_values.astype(str).str.strip().str.title().unique().tolist()
    unknown = [n for n in names if n not in state_enum.__members__]
    if unknown:
        raise DataContractError(
            'unknown_states',
            f"Unrecognised state name(s): {', '.join(repr(n) for n in unknown)}.",
            {'tool': tool, 'unknown': unknown, 'valid_examples': list(state_enum.__members__)[:VALID_STATES_SHOWN]},
        )
    return [state_enum[n] for n in names]


def _default_admin_finder(data: pd.DataFrame, level: str) -> Optional[str]:
    from toolbox.mlos import get_admin_col
    return get_admin_col(data, level, error='ignore')


def _default_geom_finder(data: pd.DataFrame) -> Any:
    from toolbox.spatial_mgr import GeomColumns
    return GeomColumns.get_geom_cols(data, True)


def validate_input(
    settlements: pd.DataFrame,
    datasets: dict[str, pd.DataFrame],
    *,
    unique_code: str,
    state_names: list[str],
    use_coords: bool,
    use_settlement: bool,
    find_admin_col: Optional[Callable[[pd.DataFrame, str], Optional[str]]] = None,
    find_geom_cols: Optional[Callable[[pd.DataFrame], Any]] = None,
) -> Report:
    """Check the settlement list and each data source. Raises
    DataContractError for problems that would crash the analysis or make the
    result meaningless; returns a Report with the warnings otherwise.

    `state_names` are the planned states' names as they appear in sources
    (State.value); `unique_code` is the settlement-code column of
    `settlements`, built already if the upload had none."""
    find_admin_col = find_admin_col or _default_admin_finder
    find_geom_cols = find_geom_cols or _default_geom_finder
    report = Report(TOOL)

    report.add(require_non_empty(settlements, 'The planned settlement list'))
    report.add(
        max_null_share(
            settlements, unique_code, 'planned settlements', warn_above=0.0, code='incomplete_settlement_names',
            message="{n:,} planned settlement(s) are missing a state, LGA, ward or settlement name. "
                    "They have no usable code and will be merged into a single record."),
        max_duplicate_share(
            settlements, unique_code, 'planned settlements', warn_above=0.0, code='duplicate_settlement_codes',
            message="{n:,} planned settlement(s) share a code with another row; only the first of each is kept."),
    )

    if not datasets:
        report.add(Finding('no_data_sources', 'No data sources were found in the upload.', True, None))
        return report.raise_if_fatal()

    wanted_states = {s.strip().lower() for s in state_names}
    no_coordinates: list[str] = []

    for source, data in datasets.items():
        if len(data) == 0:
            report.add(Finding(
                'empty_source', f"Data source '{source}' has no rows.", use_settlement and source != GTS_SOURCE,
                {'source': source}))
            continue

        if use_coords:
            try:
                find_geom_cols(data)
            except Exception:
                no_coordinates.append(source)

        if use_settlement and source != GTS_SOURCE:
            report.add(_check_admin_source(source, data, wanted_states, find_admin_col))

    if no_coordinates:
        everything_skipped = not use_settlement and len(no_coordinates) == len(datasets)
        report.add(Finding(
            'no_usable_coordinates' if everything_skipped else 'sources_without_coordinates',
            ('None of the data sources has latitude/longitude columns, so there is nothing to match by location.'
             if everything_skipped else
             f"No latitude/longitude columns found in: {', '.join(no_coordinates)}. "
             "The location method skips these sources."),
            everything_skipped, {'sources': no_coordinates}))

    return report.raise_if_fatal()


def _check_admin_source(
    source: str, data: pd.DataFrame, wanted_states: set[str], find_admin_col: Callable[[pd.DataFrame, str], Optional[str]],
) -> Optional[Finding]:
    found: dict[str, Optional[str]] = {}
    for level in ADMIN_LEVELS:
        try:
            found[level] = find_admin_col(data, level)
        except Exception:
            found[level] = None
    missing = [level for level, col in found.items() if col is None]
    if missing:
        return Finding(
            'source_missing_admin_columns',
            f"Data source '{source}' has no {', '.join(missing)} column. "
            "The settlement-name method needs state, LGA, ward and settlement columns.",
            True, {'source': source, 'missing': missing},
        )

    states_in_source = data[found['state']].astype(str).str.strip().str.lower()
    if wanted_states and not states_in_source.isin(wanted_states).any():
        return Finding(
            'source_outside_area',
            f"Data source '{source}' has no rows for the planned state(s) ({', '.join(sorted(wanted_states))}).",
            True, {'source': source, 'state_column': found['state']},
        )
    return None


def check_output(
    report: Report, result: pd.DataFrame, settlements_in: int, source_names: Optional[list[str]] = None,
) -> Report:
    """Add warnings about the finished REACH table to `report`.

    `source_names` are the data sources given to the analysis; a source that
    appears in no settlement's 'sources' list is reported when others do."""
    report.add(
        require_non_empty(result, 'The REACH result', code='empty_result', fatal=False,
                          message='The REACH analysis produced no rows, so the output file is empty.'),
        row_count_ratio(len(result), settlements_in, 'The REACH result', 'the planned settlement list'),
        max_value_share(
            result, 'status', 'Not Visited', 'settlements', warn_above=0.999, min_rows=20, code='nothing_reached',
            message="None of the {total:,} planned settlements matched any data source. "
                    "Check the state, the settlement names and the coordinates in the sources."),
        _silent_sources(result, source_names or []),
    )
    report.log()
    return report


def _silent_sources(result: pd.DataFrame, source_names: list[str]) -> Optional[Finding]:
    """Sources that matched no settlement although at least one other source
    did. (When none matched, 'nothing_reached' already says so.)"""
    if 'sources' not in result.columns or not source_names:
        return None
    lists = result['sources'].dropna().astype(str).str.split(' | ', regex=False)
    seen = {name.strip() for names in lists for name in names}
    if not seen:
        return None
    silent = [name for name in source_names if name not in seen]
    if not silent:
        return None
    return Finding(
        'source_matched_nothing',
        f"No settlement matched data source(s): {', '.join(silent)}. "
        "Check their coordinates and admin names against the planned settlements.",
        False, {'sources': silent},
    )
