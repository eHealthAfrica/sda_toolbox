"""Notes about the input a request was given, collected while the files are read.

What this is: the readers sometimes have to make a decision about a file without anyone
asking them to. The main case is a CSV with malformed rows: when the strict read fails,
the tolerant read drops every row that has more fields than the header (for example a
team code with a stray comma, `BO- ASU - WAG,- SNIDs - 075`). Nothing was reported, so a
result built on 105 fewer rows than the user uploaded looked exactly like a normal one.

A reader writes a note here; `dataops.checks.Report` picks the notes up when a tool starts
its checks and turns them into a warning that travels in the `X-Data-Warning` header, is
saved on the job row and shows on the Reliability page.

How the notes reach the tool without being passed around: the job-tracking middleware calls
`begin()` once per tracked request. That stores a list in a context variable. Context
variables are copied into worker threads, and the copy points at the same list, so a note
added from a thread pool during a read is visible to the endpoint afterwards. Outside a
tracked request (a script, a unit test, an untracked route) `begin()` was never called, so
`note_*` only logs and nothing is stored.

This module imports nothing from the rest of the application on purpose: the readers, the
middleware and the checks all use it, and none of them should have to import the others.
"""
from __future__ import annotations

import csv
import io
import logging
import os
from contextvars import ContextVar, Token
from typing import Any, Optional

logger = logging.getLogger(__name__)

_notes: ContextVar[Optional[list[dict[str, Any]]]] = ContextVar('input_notes', default=None)

# Line numbers kept per file: enough to find the problem, short enough for a header.
EXAMPLE_LINES = 3


def begin() -> Token:
    """Start collecting notes for the current request. Returns the token for `end()`."""
    return _notes.set([])


def end(token: Token) -> None:
    try:
        _notes.reset(token)
    except ValueError:
        # Reset from a different context than the one that began; the list is simply left to be collected.
        pass


def notes() -> list[dict[str, Any]]:
    """Every note collected so far for this request (a copy)."""
    current = _notes.get()
    return list(current) if current else []


def note_skipped_rows(source: str, skipped: int, lines: list[int]) -> None:
    """A reader dropped `skipped` rows from `source`; `lines` are the first few line numbers."""
    logger.warning('input note: %d malformed row(s) skipped in %s (first lines: %s)', skipped, source, lines)
    current = _notes.get()
    if current is not None:
        current.append({'kind': 'skipped_rows', 'source': source, 'skipped': int(skipped),
                        'lines': list(lines)[:EXAMPLE_LINES]})


def display_name(file_path: Any) -> str:
    """A file name safe to show: the upload's filename or the last part of a path."""
    name = getattr(file_path, 'filename', None) or str(file_path)
    return os.path.basename(name.replace('\\', '/')) or 'the file'


def scan_csv(source: Any) -> tuple[int, int, list[int]]:
    """One pass over a CSV: (data rows, rows with more fields than the header, first line numbers of those).

    `source` is a path or a seekable binary file object; it is read from the start and, for a file
    object, left rewound. Blank lines are not rows. Never raises: when the file cannot be
    inspected the answer is (0, 0, []).

    This is the only place a second pass over a file happens, and only after the first read had
    already failed on it, so the cost is paid by files that are already known to be malformed."""
    try:
        if hasattr(source, 'seek'):
            source.seek(0)
            wrapper = io.TextIOWrapper(source, encoding='utf-8-sig', errors='replace', newline='')
            try:
                return _scan(wrapper)
            finally:
                wrapper.detach()  # keep the caller's buffer open
                source.seek(0)
        with open(source, 'r', encoding='utf-8-sig', errors='replace', newline='') as handle:
            return _scan(handle)
    except Exception:
        logger.debug('input notes: could not inspect %s for malformed rows', source, exc_info=True)
        return 0, 0, []


def _scan(handle) -> tuple[int, int, list[int]]:
    reader = csv.reader(handle)
    header_width = None
    rows = overlong = 0
    lines: list[int] = []
    for record in reader:
        if not record:
            continue  # a blank line
        if header_width is None:
            header_width = len(record)
            continue
        rows += 1
        if len(record) > header_width:
            overlong += 1
            if len(lines) < EXAMPLE_LINES:
                lines.append(reader.line_num)
    return rows, overlong, lines


def report_skipped_rows(source: Any, rows_kept: int, name: str) -> int:
    """After a tolerant CSV read: work out how many rows it dropped and note it.

    The count is "rows in the file minus rows in the result", so a row dropped for any reason is
    counted, not only the overlong ones; the line numbers come from the overlong-row scan and are
    only examples. `name` is what to call the file in the warning. Returns the number dropped
    (0 when none, or when it could not be worked out)."""
    rows, _, lines = scan_csv(source)
    skipped = rows - int(rows_kept)
    if skipped <= 0:
        return 0
    note_skipped_rows(name, skipped, lines)
    return skipped
