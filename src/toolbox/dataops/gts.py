"""Data checks for GTS device tracking (POST /tracking/devices).

Input checks run after the tracks file has been read and filtered, before the
analysis starts. They mirror what `tracks_cleanup()` and `match_vb_team_code()`
in toolbox/campaign/team_reviewer/team_reviewer_utils.py index by exact name,
so a column that is missing or misspelled is reported up front instead of as a
KeyError from the middle of the analysis.

Output checks look at the finished table and only ever produce warnings.
"""
from __future__ import annotations

from typing import Optional

import pandas as pd

from toolbox.dataops.checks import (
    Finding, Report, require_columns, require_non_empty, require_text_columns, require_crs,
    max_invalid_geometries, max_null_share, max_value_share,
)

TOOL = 'gts_device_tracking'

# What tracks_cleanup() selects. 'timestamp' is added by read_tracks()'s filter.
TRACK_COLUMNS = ['IMEI', 'Team Code', 'timestamp', 'Lat', 'Lon', 'Accuracy m', 'Speed mps', 'Track ID', 'geometry']
# What match_vb_team_code() merges on.
VB_MAPPING_COLUMNS = ['DEVICE ID', 'TEAM']

INVALID_TEAM_CODE = 'Invalid Team Code'


def validate_input(tracks: pd.DataFrame, activity_code: Optional[str], vb_mapping: Optional[pd.DataFrame] = None) -> Report:
    """Raises DataContractError if the analysis cannot run on this input;
    otherwise returns a Report holding any warnings."""
    report = Report(TOOL)

    if not activity_code or not str(activity_code).strip():
        report.add(Finding(
            'missing_activity_code',
            'The activity code is empty. It is used to check every team code, so every team would be flagged invalid.',
            True, {'field': 'activity_code'},
        ))

    empty = require_non_empty(
        tracks, 'The tracks file', code='no_valid_tracks',
        message='No usable tracks remain after removing invalid ones '
                '(speed of 1 m/s or more, or outside 07:00-16:59, or unreadable coordinates).',
    )
    report.add(empty)
    if empty is None:
        report.add(
            require_columns(tracks, TRACK_COLUMNS, 'The tracks file'),
            require_text_columns(tracks, ['IMEI', 'Team Code'], 'the tracks file'),
            require_crs(tracks, 'The tracks file'),
            max_invalid_geometries(tracks, 'tracks'),
            max_null_share(
                tracks, 'Team Code', 'tracks', warn_above=0.1, code='missing_team_codes',
                message="{pct} of tracks ({n:,} of {total:,}) have no Team Code and will be flagged invalid."),
        )

    if vb_mapping is not None and len(vb_mapping.columns) > 0:
        report.add(require_columns(vb_mapping, VB_MAPPING_COLUMNS, 'The vaccine buddy mapping'))

    return report.raise_if_fatal()


def check_output(report: Report, results: pd.DataFrame) -> Report:
    """Add warnings about the finished device/team table to `report`."""
    report.add(
        require_non_empty(results, 'The device analysis', code='empty_result', fatal=False,
                          message='The analysis produced no rows, so the output file is empty.'),
        max_null_share(
            results, 'unique_code', 'team-days', warn_above=0.1, code='unmatched_admin_areas',
            message="{pct} of team-days ({n:,} of {total:,}) could not be matched to a ward; "
                    "check that the team codes use the right state/LGA/ward codes."),
        max_value_share(
            results, 'team_code_flag', INVALID_TEAM_CODE, 'team-days', warn_above=0.25, min_rows=10,
            code='many_invalid_team_codes',
            message="{pct} of team-days ({n:,} of {total:,}) have an invalid team code; "
                    "check the activity code you entered matches the campaign."),
    )
    report.log()
    return report
