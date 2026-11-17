"""What a Target Area run did with each state, for the page that shows it.

generate_settlement_target_area runs one state at a time; a state that cannot run (duplicate settlements, a
failure part-way) is left out of the result. The run records which states ran and which were skipped, with the
reason, and the route sends that to the browser in the X-TA-Summary response header (the same way the Checkout
page gets its counts), where the Target Area page lists it.

Kept free of geopandas so it can be tested on its own.
"""
import json
from dataclasses import dataclass
from typing import Any, Iterable, Optional

import pandas as pd

SUMMARY_HEADER = 'X-TA-Summary'
MAX_REASON_LENGTH = 300
MAX_HEADER_LENGTH = 6000   # proxies commonly refuse response headers much over 8 KB


@dataclass
class SkippedState:
    state: str
    reason: str


def skip_reason(error: Exception) -> str:
    """One readable line for why a state was skipped.

    The toolbox exceptions carry a short `msg` and the full `details`; anything else is an unexpected failure,
    named by its type so it can be found in the log.
    """
    msg = getattr(error, 'msg', None)
    details = getattr(error, 'details', None)
    if msg:
        text = f'{msg}: {details}' if details else str(msg)
    else:
        text = f'Unexpected error ({type(error).__name__}): {error}'
    return _shorten(' '.join(str(text).split()), MAX_REASON_LENGTH)


def _shorten(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit - 3].rstrip() + '...'


def skipped_summary_text(skipped: list[SkippedState]) -> str:
    """'Kano: ...; Sokoto: ...' for an error message when no state could run."""
    return '; '.join(f'{item.state}: {item.reason}' for item in skipped)


def summary_header_value(
    states_run: list[str], skipped: list[SkippedState],
    planned_requested: Optional[int] = None, planned_matched: Optional[int] = None,
) -> str:
    """The X-TA-Summary value: JSON, ASCII only (header values cannot carry anything else).

    Every state is always listed; if the reasons make the header too long they are shortened, never dropped.
    When a planned settlement list was given, `planned` says how many of its settlements were found in the
    generated target areas, so a list that matched nothing (or only some) is visible on the page.
    """
    value = ''
    for limit in (MAX_REASON_LENGTH, 120, 60, 30):
        body: dict[str, Any] = {
            'states_run': list(states_run),
            'skipped': [{'state': item.state, 'reason': _shorten(item.reason, limit)} for item in skipped],
        }
        if planned_requested is not None and planned_matched is not None:
            body['planned'] = {'requested': int(planned_requested), 'matched': int(planned_matched)}
        value = json.dumps(body)
        if len(value) <= MAX_HEADER_LENGTH:
            break
    return value


NO_STATE = '(no state)'


def resolve_run_states(state_values: Iterable[Any], state_enum: Any = None) -> tuple[dict[str, str], list[SkippedState]]:
    """The states a run can work on, and the ones it cannot, from the master list's state column.

    Returns ({state name as written, in Title Case: its state code}, states left out with the reason). The
    run used to look each name up as `State[name]` outside the per-state `try`, so one misspelled state (or a
    blank one, or a two-word one such as 'Akwa Ibom', whose enum member is `Akwa_Ibom`) crashed the whole run
    with a bare KeyError. Now that state is skipped with a reason, like any other state that cannot run, and
    the rest go ahead. Names are matched exactly (case aside): ' Kano' with a stray space is reported as it was
    written, because the later per-state filter compares the written name.
    """
    if state_enum is None:
        from toolbox.models import State as state_enum  # lazy: keeps this module importable on its own

    known: dict[str, Any] = {}
    for member in state_enum:
        known[member.name.replace('_', ' ').lower()] = member
        known[str(member.value).lower()] = member

    values = pd.Series(list(state_values), dtype='object')
    blank = values.isna() | values.astype(str).str.strip().eq('')
    state_info: dict[str, str] = {}
    skipped: list[SkippedState] = []

    if blank.any():
        skipped.append(SkippedState(
            NO_STATE, f'{int(blank.sum()):,} settlement(s) have no state name, so they are in no state run.'))

    for name in values[~blank].astype(str).str.title().unique():
        member = known.get(name.lower())
        if member is None:
            skipped.append(SkippedState(name, f"'{name}' is not a recognised state name."))
            continue
        try:
            state_info[name] = member.state_code
        except Exception as error:  # no code configured for this state
            skipped.append(SkippedState(
                name, f'No state code is configured for {member.value} ({type(error).__name__}).'))
    return state_info, skipped


def planned_match(planned_codes: Iterable[Any], generated_codes: Iterable[Any]) -> tuple[int, int]:
    """(planned settlements with a code, how many of those codes were found among the generated ones).

    Blank codes are not counted either way: a planned row with no code cannot be matched, and the
    count says how many could have been."""
    planned = pd.Series(list(planned_codes), dtype='object').dropna().astype(str).str.strip()
    planned = set(planned[planned != ''])
    generated = pd.Series(list(generated_codes), dtype='object').dropna().astype(str).str.strip()
    return len(planned), len(planned & set(generated))
