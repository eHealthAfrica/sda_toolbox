"""Generic data checks used by the tools (GTS device tracking, REACH, ...).

What this is: a small toolkit for answering "is the data this tool was given,
or produced, sane?" in a way the Reliability page can understand.

Two kinds of finding:

  * FATAL  - the tool cannot give a correct answer from this input (a required
             column is missing, the file is empty). `Report.raise_if_fatal()`
             turns these into a DataContractError: the user gets a clear 422
             that says what to fix, and the job tracker files it under
             `data_contract`, which does not count against the success rate.
  * WARNING - the tool ran, but something looks off (a third of the tracks have
             no usable location; no settlement matched any source). The result
             is still returned; the warning travels in the `X-Data-Warning`
             response header, is saved on the job row (`data_warning`), and is
             shown on the Reliability page.

Every check function returns a `Finding`, or None when the data is fine, so a
tool reads as a list of checks added to one `Report`:

    report = Report('gts_device_tracking')
    report.add(require_columns(tracks, ['IMEI', 'Team Code'], 'Tracks file'))
    report.add(max_null_share(tracks, 'Team Code', 'Tracks file', warn_above=0.1))
    report.raise_if_fatal()

The functions only use pandas (geometry checks use whatever `.geometry`
provides), so they are cheap to unit-test without a database.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Iterable, Optional

import pandas as pd

from toolbox.errors import DataContractError

logger = logging.getLogger(__name__)

# Response header a tool sets when it finished but the data looked wrong.
WARNING_HEADER = 'X-Data-Warning'
# Headers are one line; the job row keeps the same text. Long enough to name
# two or three problems, short enough that no proxy rejects it.
HEADER_MAX_CHARS = 480
COLUMNS_SHOWN = 40


@dataclass
class Finding:
    code: str                    # short machine name, e.g. 'missing_columns'
    message: str                 # one plain sentence for a person
    fatal: bool = False
    details: Any = None

    def as_dict(self) -> dict[str, Any]:
        return {'code': self.code, 'message': self.message, 'fatal': self.fatal, 'details': self.details}


class Report:
    """The findings for one run of one tool."""

    def __init__(self, tool: str):
        self.tool = tool
        self.findings: list[Finding] = []

    def add(self, *findings: Optional[Finding | Iterable[Finding]]) -> 'Report':
        for item in findings:
            if item is None:
                continue
            if isinstance(item, Finding):
                self.findings.append(item)
            else:
                self.findings.extend(f for f in item if f is not None)
        return self

    @property
    def fatal(self) -> list[Finding]:
        return [f for f in self.findings if f.fatal]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if not f.fatal]

    def raise_if_fatal(self) -> 'Report':
        """Raise a DataContractError naming every fatal problem; otherwise
        log any warnings and return self so the call chains."""
        fatal = self.fatal
        if fatal:
            raise DataContractError(
                code=fatal[0].code,
                message=' '.join(f.message for f in fatal),
                details={'tool': self.tool, 'problems': [f.as_dict() for f in fatal]},
            )
        self.log()
        return self

    def log(self) -> None:
        for finding in self.warnings:
            logger.warning('data check [%s] %s: %s', self.tool, finding.code, finding.message)

    def headers(self) -> dict[str, str]:
        """{'X-Data-Warning': ...} for the response, or {} when all is well."""
        warnings = self.warnings
        if not warnings:
            return {}
        text = '; '.join(f'{f.code}: {f.message}' for f in warnings)
        text = re.sub(r'[\r\n]+', ' ', text)
        text = text.encode('latin-1', 'replace').decode('latin-1')
        if len(text) > HEADER_MAX_CHARS:
            text = text[:HEADER_MAX_CHARS - 3].rstrip() + '...'
        return {WARNING_HEADER: text}


# ---- helpers ---------------------------------------------------------------

def _pct(share: float) -> str:
    return f'{share * 100:.1f}%'


def _normal(name: Any) -> str:
    return re.sub(r'[\s_\-]+', '', str(name)).lower()


def _quoted(names: Iterable[Any]) -> str:
    return ', '.join(f"'{n}'" for n in names)


# ---- checks that apply to a table's shape ----------------------------------

def require_columns(df: pd.DataFrame, columns: Iterable[str], label: str, *, fatal: bool = True) -> Optional[Finding]:
    """Every name in `columns` must be a column of `df` (exact match: the
    tools index columns by exact name). When one is missing but a column that
    differs only by case, spaces or punctuation exists, say so."""
    found = list(df.columns)
    missing = [c for c in columns if c not in found]
    if not missing:
        return None

    by_normal = {_normal(c): c for c in found}
    hints = {c: by_normal[_normal(c)] for c in missing if _normal(c) in by_normal}
    message = f'{label} is missing required column(s): {_quoted(missing)}.'
    if hints:
        message += ' Found similar: ' + ', '.join(f"'{have}' for '{want}'" for want, have in hints.items()) + '.'
    return Finding(
        'missing_columns', message, fatal,
        {'label': label, 'missing': missing, 'did_you_mean': hints, 'columns_found': [str(c) for c in found[:COLUMNS_SHOWN]]},
    )


def require_non_empty(
    df: pd.DataFrame, label: str, *, code: str = 'empty_dataset', message: Optional[str] = None, fatal: bool = True
) -> Optional[Finding]:
    if len(df) > 0:
        return None
    return Finding(code, message or f'{label} has no rows.', fatal, {'label': label, 'rows': 0})


def require_text_columns(df: pd.DataFrame, columns: Iterable[str], label: str, *, fatal: bool = True) -> Optional[Finding]:
    """The tools call string methods (`.str.upper()`, `.str.strip()`) on some
    columns. A column that arrived as numbers, or as nothing but blanks (which
    reads back as float), makes those calls fail with an opaque error."""
    wrong = [
        c for c in columns
        if c in df.columns and not (pd.api.types.is_string_dtype(df[c]) or pd.api.types.is_object_dtype(df[c]))
    ]
    if not wrong:
        return None
    return Finding(
        'wrong_column_type',
        f'In {label}, {_quoted(wrong)} should contain text but contains numbers or is empty.',
        fatal, {'label': label, 'columns': wrong},
    )


def require_crs(gdf: Any, label: str, *, expected_epsg: Optional[int] = None, fatal: bool = True) -> Optional[Finding]:
    """The dataset must say what coordinate system it is in. When
    `expected_epsg` is given, a different system is reported as a warning."""
    crs = getattr(gdf, 'crs', None)
    if crs is None:
        return Finding('missing_crs', f'{label} has no coordinate system defined.', fatal, {'label': label})
    if expected_epsg is not None:
        try:
            actual = crs.to_epsg()
        except Exception:
            actual = None
        if actual is not None and actual != expected_epsg:
            return Finding(
                'unexpected_crs',
                f'{label} is in EPSG:{actual}; EPSG:{expected_epsg} was expected.',
                False, {'label': label, 'epsg': actual, 'expected': expected_epsg},
            )
    return None


# ---- checks that measure a share of the rows -------------------------------

def _grade(share: float, warn_above: float, fail_above: Optional[float]) -> Optional[bool]:
    """None = fine, False = warn, True = fatal."""
    if fail_above is not None and share > fail_above:
        return True
    if share > warn_above:
        return False
    return None


def _invalid_geometry_mask(gdf: Any) -> Optional[pd.Series]:
    try:
        geometry = gdf.geometry
    except Exception:
        return None
    mask = geometry.isna()
    for attribute, negate in (('is_empty', False), ('is_valid', True)):
        try:
            values = getattr(geometry, attribute)
            mask = mask | (~values if negate else values)
        except Exception:
            continue
    return mask


def max_invalid_geometries(
    gdf: Any, label: str, *, warn_above: float = 0.05, fail_above: Optional[float] = 0.5
) -> Optional[Finding]:
    """Share of rows whose geometry is missing, empty or invalid."""
    if len(gdf) == 0:
        return None
    mask = _invalid_geometry_mask(gdf)
    if mask is None:
        return None
    bad = int(mask.sum())
    share = bad / len(gdf)
    grade = _grade(share, warn_above, fail_above)
    if grade is None:
        return None
    return Finding(
        'invalid_geometries',
        f'{_pct(share)} of {label} ({bad:,} of {len(gdf):,} rows) have a missing or invalid location.',
        grade, {'label': label, 'invalid': bad, 'total': len(gdf), 'share': round(share, 4)},
    )


def max_null_share(
    df: pd.DataFrame, column: str, label: str, *, warn_above: float = 0.1, fail_above: Optional[float] = None,
    code: str = 'many_blanks', message: Optional[str] = None,
) -> Optional[Finding]:
    """Share of rows where `column` is empty or only whitespace. `message`
    may use {pct}, {n}, {total} and {column}."""
    if column not in df.columns or len(df) == 0:
        return None
    series = df[column]
    blank = series.isna()
    if pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series):
        blank = blank | series.astype(str).str.strip().eq('')
    n, total = int(blank.sum()), len(df)
    share = n / total
    grade = _grade(share, warn_above, fail_above)
    if grade is None:
        return None
    text = (message or '{pct} of {label} ({n:,} of {total:,} rows) have no value in \'{column}\'.').format(
        pct=_pct(share), n=n, total=total, column=column, label=label)
    return Finding(code, text, grade, {'label': label, 'column': column, 'blank': n, 'total': total, 'share': round(share, 4)})


def max_duplicate_share(
    df: pd.DataFrame, column: str, label: str, *, warn_above: float = 0.0, fail_above: Optional[float] = None,
    code: str = 'duplicate_values', message: Optional[str] = None,
) -> Optional[Finding]:
    """Share of rows whose `column` value repeats an earlier row's (blanks are
    not counted: `max_null_share` covers those)."""
    if column not in df.columns or len(df) == 0:
        return None
    series = df[column].dropna()
    n = int(series.duplicated().sum())
    share = n / len(df)
    grade = _grade(share, warn_above, fail_above)
    if grade is None:
        return None
    text = (message or '{n:,} row(s) in {label} repeat a value already used in \'{column}\'.').format(
        pct=_pct(share), n=n, total=len(df), column=column, label=label)
    return Finding(code, text, grade, {'label': label, 'column': column, 'duplicates': n, 'total': len(df), 'share': round(share, 4)})


def max_value_share(
    df: pd.DataFrame, column: str, value: Any, label: str, *, warn_above: float, min_rows: int = 1,
    code: str = 'value_dominates', message: Optional[str] = None,
) -> Optional[Finding]:
    """Share of rows where `column == value` (e.g. every team code flagged
    invalid). Ignored for tables smaller than `min_rows`, where a share is
    meaningless. `message` may use {pct}, {n}, {total}, {value}, {column}, {label}."""
    if column not in df.columns or len(df) < max(min_rows, 1):
        return None
    n = int((df[column] == value).sum())
    share = n / len(df)
    if share <= warn_above:
        return None
    text = (message or "{pct} of {label} ({n:,} of {total:,} rows) have '{column}' = '{value}'.").format(
        pct=_pct(share), n=n, total=len(df), value=value, column=column, label=label)
    return Finding(code, text, False, {'label': label, 'column': column, 'value': value, 'count': n, 'total': len(df), 'share': round(share, 4)})


def row_count_ratio(
    rows_out: int, rows_in: int, label_out: str, label_in: str, *, min_ratio: float = 0.98, max_ratio: Optional[float] = None,
    code: str = 'rows_lost',
) -> Optional[Finding]:
    """The output should hold about as many rows as the input it was built
    from. A drop usually means rows were silently merged or discarded."""
    if rows_in <= 0:
        return None
    ratio = rows_out / rows_in
    if ratio < min_ratio:
        return Finding(
            code,
            f'{label_out} has {rows_out:,} rows but {label_in} had {rows_in:,} ({_pct(ratio)}); '
            f'{rows_in - rows_out:,} row(s) were dropped or merged.',
            False, {'rows_in': rows_in, 'rows_out': rows_out, 'ratio': round(ratio, 4)},
        )
    if max_ratio is not None and ratio > max_ratio:
        return Finding(
            'rows_gained',
            f'{label_out} has {rows_out:,} rows but {label_in} had {rows_in:,} ({_pct(ratio)}); rows were duplicated.',
            False, {'rows_in': rows_in, 'rows_out': rows_out, 'ratio': round(ratio, 4)},
        )
    return None
