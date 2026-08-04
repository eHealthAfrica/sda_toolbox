from tqdm import tqdm
import pandas as pd

from toolbox.tools import find_column
from toolbox.mlos import MLoSAttributes


def update_gis_feedback(row:pd.Series, qc_result_cols:list):
    qc_results = [row.get(col) for col in qc_result_cols]
    filtered_results = [result for result in qc_results if pd.notna(result)]
    return ", ".join(filtered_results) if len(filtered_results) > 0 else None


def assign_validation_status(row: pd.Series):
    is_invalid = row.get('is_invalid')
    habitational_status = row['habitational_status']
    if is_invalid or habitational_status in ['Abandoned', 'Migrated']:
        return "Validated Unknown"

    is_flagged = row.get('is_flagged')
    if pd.isna(is_flagged):
        return "Validated"

    no_coords_test = row.get('no_coordinates')
    if pd.notna(no_coords_test):
        return "Not Validated"

    return "Validation Ongoing"


def evaluate_settlement_validation(mlos_data: pd.DataFrame, attributes: MLoSAttributes):
    """
    Uses the Results from the QC Evaluation, comments from the LGA Team to set a Validation Status

    Parameters
    ----------
    mlos_data: pd.DataFrame
        MLoS Dataset
    attributes:
        MLoS Attributes Objects

    Returns
    -------
        pd.DataFrame: Updated MLoS with validation status set

    """

    validation_col = find_column(mlos_data, 'validation_status', 'ignore')
    if not validation_col:
        validation_col = 'validation_status'
        mlos_data[validation_col] = pd.NA

    tqdm.pandas(desc='Setting Validation Status')
    mlos_data[validation_col] = mlos_data.progress_apply(assign_validation_status, axis=1)
    feedback_fields = [
        'invalid_name_length', 'stacked_point', 'duplicate_attribute',
        'no_coordinates', 'boundary_issues', 'proximity_issues'
    ]

    mlos_data[attributes.gis_feedback] = mlos_data.apply(update_gis_feedback, args=(feedback_fields,), axis=1)

    return mlos_data
