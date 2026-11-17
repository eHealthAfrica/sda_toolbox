"""What a Target Area run did with each state, for the page that shows it.

generate_settlement_target_area runs one state at a time; a state that cannot run (duplicate settlements, a
failure part-way) is left out of the result. The run records which states ran and which were skipped, with the
reason, and the route sends that to the browser in the X-TA-Summary response header (the same way the Checkout
page gets its counts), where the Target Area page lists it.

Kept free of geopandas so it can be tested on its own.
"""
import json
from dataclasses import dataclass

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


def summary_header_value(states_run: list[str], skipped: list[SkippedState]) -> str:
    """The X-TA-Summary value: JSON, ASCII only (header values cannot carry anything else).

    Every state is always listed; if the reasons make the header too long they are shortened, never dropped.
    """
    value = ''
    for limit in (MAX_REASON_LENGTH, 120, 60, 30):
        value = json.dumps({
            'states_run': list(states_run),
            'skipped': [{'state': item.state, 'reason': _shorten(item.reason, limit)} for item in skipped],
        })
        if len(value) <= MAX_HEADER_LENGTH:
            break
    return value
