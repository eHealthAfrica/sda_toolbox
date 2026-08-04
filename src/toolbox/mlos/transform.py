import pandas as pd

from toolbox.configs import CONFIG
from toolbox.utils import timer, logger
from toolbox.mlos import MLoSAttributes
from toolbox.mlos.attr_builder import build_attributes
from toolbox.fixers import populate_global_id
from toolbox.mlos.transformers import (
    common_transformations,
    standardize_take_off_point,
    transform_preset_attributes,
    recalculate_population_entries
)

@timer
def standardize_mlos_records(data: pd.DataFrame):
    """
    Execute several standardization protocols of the MLoS attributes. These include:
        ``Capitalization``: Converting all String Columns to Titlecase (Proper case)
                            and Specific column that have preset values such as reason for inaccessibility,
        ``Take-off-Point Transformation``: Standardizing take_off-point information to an accepted standard

    Parameters
    ----------
    data: pd.DataFrame
        MLoS Dataset

    Returns
    -------
        pd.DataFrame: transformed MLoS Dataset
    """

    mlos_attributes: MLoSAttributes = MLoSAttributes()(data, CONFIG.get('ATTRIBUTE_COLUMNS'))
    print('Starting Standardization')
    transformed_mlos = common_transformations(data)
    transformed_mlos = standardize_take_off_point(transformed_mlos, mlos_attributes)
    transformed_mlos = transform_preset_attributes(transformed_mlos, mlos_attributes.preset_attributes)
    transformed_mlos = recalculate_population_entries(transformed_mlos, mlos_attributes.numeric_attributes)
    transformed_mlos = populate_global_id(transformed_mlos, mlos_attributes.global_id)

    return transformed_mlos

if __name__ == '__main__':
    file = r"C:\Users\enyinnaya.nwaiwu\Downloads\MLoS May 2026_fixed_20260525.csv"
    data_df = pd.read_csv(file)
    standardize_mlos_records(data_df)
