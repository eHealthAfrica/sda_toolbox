"""Data checks for MLoS QC and Validation (POST /qc/validation).

What QC can get wrong without raising an error:

  * a record with a blank state, LGA, ward or settlement name has no unique code when the code is
    built from those names (`construct_new_unique` leaves it empty), and the duplicate checks work
    from that code;
  * a record with a blank or impossible location (no number, outside valid degrees, or 0,0) cannot
    be tested by the spatial checks (proximity, stacked points, settlement extent);
  * records whose comment or habitation status marks them "Validated Unknown" are set aside before
    the checks run, so a file where most records match that was mostly not checked;
  * a file where most settlements come back flagged usually means something about the file is off
    (wrong columns, wrong coordinate system, only part of the master list), not that most
    settlements are wrong.

The only thing that stops a run is what would have crashed it anyway, now with a message that says
what to fix: an empty file, or no usable latitude/longitude columns (the QC reads them with
`GeomColumns.get_geom_cols(data, True)`, which raises when they are missing or not numeric).

Every other finding is a warning, so it can never block someone's run. The two share thresholds
below are first guesses: they should be confirmed, and can be moved or made fatal, by the people
who run MLoS QC.

The column lookup is the tool's own (GeomColumns), imported lazily so this module can be tested
without the spatial libraries; tests pass `find_geom_cols` instead.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

import pandas as pd

from toolbox.dataops.checks import Finding, Report, max_null_share, max_value_share, require_non_empty, row_count_ratio

TOOL = 'mlos_qc'

# Share of the QC result above which "most flagged" / "most set aside" is worth saying. A table
# smaller than MIN_ROWS_FOR_SHARES is too small for a share to mean anything.
MOST_FLAGGED_ABOVE = 0.5
MOST_SET_ASIDE_ABOVE = 0.5
MIN_ROWS_FOR_SHARES = 20

FLAG_COLUMN = 'is_flagged'
FLAGGED = 'Flagged'
STATUS_COLUMN = 'validation_status'
SET_ASIDE = 'Validated Unknown'


def _default_geom_finder(data: pd.DataFrame) -> Any:
    from toolbox.spatial_mgr import GeomColumns
    return GeomColumns.get_geom_cols(data, True)


def validate_input(
    mlos: pd.DataFrame,
    unique_col: str,
    *,
    unique_code_built: bool = False,
    find_geom_cols: Optional[Callable[[pd.DataFrame], Any]] = None,
) -> Report:
    """Check the MLoS table the QC is about to run on (after standardising, with its unique code in
    `unique_col`; `unique_code_built` says the code was made from the admin names because the file
    had none). Raises DataContractError for what would crash the QC; returns a Report holding the
    warnings otherwise."""
    find_geom_cols = find_geom_cols or _default_geom_finder
    report = Report(TOOL)

    empty = require_non_empty(mlos, 'The MLoS file', code='empty_mlos',
                              message='The MLoS file has no rows, so there is nothing to check.')
    report.add(empty)
    if empty is not None:
        return report.raise_if_fatal()

    report.add(_missing_codes(mlos, unique_col, unique_code_built))
    report.add(_coordinates(mlos, find_geom_cols))
    return report.raise_if_fatal()


def _missing_codes(mlos: pd.DataFrame, unique_col: str, built: bool) -> Optional[Finding]:
    if built:
        message = ("{n:,} record(s) are missing a state, LGA, ward or settlement name, so no unique code could be "
                   "built for them and the duplicate checks cannot identify them reliably.")
    else:
        message = ("{n:,} record(s) have no value in the unique code column '{column}', so the duplicate checks "
                   "cannot identify them reliably.")
    return max_null_share(
        mlos, unique_col, 'MLoS records', warn_above=0.0, code='missing_unique_codes', message=message)


def _coordinates(mlos: pd.DataFrame, find_geom_cols: Callable[[pd.DataFrame], Any]) -> Optional[Finding]:
    try:
        found = find_geom_cols(mlos)
    except ImportError:
        return None  # the spatial libraries are not available here, so the columns cannot be judged
    except Exception:
        found = None
    latitude = getattr(found, 'latitude', None)
    longitude = getattr(found, 'longitude', None)
    if latitude not in mlos.columns or longitude not in mlos.columns:
        return Finding(
            'no_coordinate_columns',
            'No usable latitude and longitude columns were found. They must be numeric (decimal degrees); '
            'a single text value in a coordinate column stops it being read as coordinates.',
            True, {'columns_found': [str(c) for c in list(mlos.columns)[:40]]})

    lat = pd.to_numeric(mlos[latitude], errors='coerce')
    lon = pd.to_numeric(mlos[longitude], errors='coerce')
    blank = lat.isna() | lon.isna()
    impossible = ~blank & (~lat.between(-90, 90) | ~lon.between(-180, 180))
    origin = ~blank & lat.eq(0) & lon.eq(0)
    unusable = blank | impossible | origin
    n, total = int(unusable.sum()), len(mlos)
    if n == 0:
        return None
    return Finding(
        'unusable_coordinates',
        f"{n:,} of {total:,} records ({n / total * 100:.1f}%) have a blank or impossible location (no number, "
        "outside valid latitude/longitude, or 0,0), so the spatial checks cannot test them.",
        False, {'unusable': n, 'blank': int(blank.sum()), 'impossible': int(impossible.sum()),
                'origin': int(origin.sum()), 'total': total, 'latitude': latitude, 'longitude': longitude})


def check_output(report: Report, result: pd.DataFrame, rows_in: int) -> Report:
    """Add warnings about the finished QC table to `report`. `rows_in` is the number of records the
    QC was given."""
    report.add(
        row_count_ratio(len(result), rows_in, 'The QC result', 'the MLoS file', max_ratio=1.02),
        max_value_share(
            result, FLAG_COLUMN, FLAGGED, 'settlements', warn_above=MOST_FLAGGED_ABOVE, min_rows=MIN_ROWS_FOR_SHARES,
            code='most_flagged',
            message="{pct} of settlements ({n:,} of {total:,}) were flagged. That is unusually high: check the "
                    "column names, the coordinate system, and whether this is the whole MLoS or only part of it."),
        max_value_share(
            result, STATUS_COLUMN, SET_ASIDE, 'settlements', warn_above=MOST_SET_ASIDE_ABOVE,
            min_rows=MIN_ROWS_FOR_SHARES, code='most_set_aside',
            message="{pct} of settlements ({n:,} of {total:,}) were set aside as 'Validated Unknown' before the "
                    "checks ran (a comment that matches the exclusion keywords, or a Migrated/Abandoned status), "
                    "so most of the file was not checked."),
    )
    report.log()
    return report
