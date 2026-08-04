from typing import Any

from tqdm import tqdm
import pandas as pd
import numpy as np

from toolbox.exceptions import DataError
from toolbox.mlos.validation.update import standardize_admin_records
from toolbox.spatial_mgr import GeomColumns
from toolbox.configs import CONFIG
from toolbox.models import Policy
from toolbox.mlos import construct_new_unique, MLoSAttributes, attr_builder, get_admin_col, detect_unique_admin_field
from toolbox.tools import find_column


def update_record(row: pd.Series, old_value: Any, new_value: Any, combine: bool=False, keep: bool=False) -> Any:
    old_value = row[old_value]
    new_value = row[new_value]
    if combine:
        return f"{':'.join([value for value in [old_value, new_value] if pd.notna(value)])}"

    if keep and pd.notna(old_value):
        return old_value

    if pd.isna(new_value):
        return old_value

    return new_value


def create_relationship(source_attributes: dict, update_attributes: dict):
    mapped =  {col: update_attributes.get(attrib) for attrib, col in source_attributes.items()}
    return {target: source for target, source in mapped.items() if source is not None}


def map_attribute_relationship(
        attributes: MLoSAttributes, source_data: pd.DataFrame,
        reason: Policy, take_off: str=None, comment: str=None) -> dict:

    attributes = attributes.__repr__(take_off_point=take_off, comment=comment)
    if reason == Policy.MLOS:
        source_attr = attr_builder.build_attributes(source_data)
        source_attr = source_attr.__repr__()

    else:
        source_attr = CONFIG['REMAPPERS'][reason.value.upper()]

    return create_relationship(attributes, source_attr)


def update_settlement_category_columns(data: pd.DataFrame):
    category_col = find_column(data, 'settlement_category', error='ignore')
    if category_col is None:
        category_cols = [find_column(data, col, 'ignore') for col in ['urban', 'rural', 'scattered']]
        if missing := pd.isna(category_cols).all():
            raise DataError('missing info', f'{", ".join(missing)} columns not found')

        for col in category_cols:
            data[col] = data[col].str.lower()
        return data

    data[category_col] = data[category_col].str.lower()
    data['urban'] = data.apply(lambda row: 'Y' if row[category_col]=='urban' else 'N', axis=1)
    data['rural'] = data.apply(lambda row: 'Y' if row[category_col]=='rural' else 'N', axis=1)
    data['scattered'] = data.apply(lambda row: 'Y' if row[category_col]=='scattered' else 'N', axis=1)
    return data


def update_mlos(mlos_data: pd.DataFrame, validated_data: pd.DataFrame, reason: Policy):
    """
    Update MLoS based on the LGA validated data

    Parameters
    ----------
    mlos_data: pd.DataFrame
        MLoS Dataset
    validated_data: pd.DataFrame
        Validated MLoS dataset
    reason: Policy

    Returns
    -------
        pd.DataFrame: Updated MLoS data
    """

    admin_levels = ['state', 'lga', 'ward', 'settlement']
    mlos_attr: MLoSAttributes = attr_builder.build_attributes(mlos_data)
    mlos_geom: GeomColumns = GeomColumns.get_geom_cols(mlos_data, True)
    mlos_admin: dict = {level: get_admin_col(mlos_data, level) for level in admin_levels} # noqa
    take_off_point = find_column(mlos_data, mlos_attr.take_off_point)
    comment = find_column(mlos_data, mlos_attr.comment)

    validated_data = standardize_admin_records(validated_data, reason)
    validated_data = update_settlement_category_columns(validated_data)
    validated_admin: dict =  {level: get_admin_col(validated_data, level) for level in admin_levels} # noqa
    validated_geom = GeomColumns.get_geom_cols(validated_data, True)
    validated_data['set_pop'] = np.divide(validated_data['population'], 0.2)

    mlos_unique_code = detect_unique_admin_field(mlos_data)
    if not mlos_unique_code:
        mlos_unique_code =  'unique_code'
        mlos_data = construct_new_unique(mlos_data, mlos_unique_code)

    validated_unique_code = detect_unique_admin_field(validated_data)
    if not validated_unique_code:
        validated_unique_code = 'admin_code'
        validated_data = construct_new_unique(validated_data, validated_unique_code)
        validated_data.drop_duplicates(subset=validated_unique_code, inplace=True, keep='first')

    attrib_relationship = map_attribute_relationship(mlos_attr, validated_data, reason, take_off_point, comment)
    admin_attributes = create_relationship(mlos_admin, validated_admin)
    coord_attrib = create_relationship(mlos_geom.__dict__, validated_geom.__dict__)
    all_attributes = {
        **attrib_relationship,
        **admin_attributes,
        **coord_attrib
        }

    merged_data = mlos_data.merge(
        validated_data, how='left', left_on=mlos_unique_code, suffixes=('', '_y'), right_on=validated_unique_code)

    for mlos_col, update_col in tqdm(all_attributes.items(), desc='updating mlos attributes'):
        try:
            combine=False
            keep = False
            if mlos_col == update_col:
                update_col += '_y'

            if mlos_col == comment:
                combine = True

            if mlos_col in [mlos_geom.latitude, mlos_geom.longitude, mlos_unique_code]:
                keep = True

            merged_data[mlos_col] = merged_data.apply(update_record, args=(mlos_col, update_col, combine, keep), axis=1)
        except KeyError as e:
            print(f"error with key-:{e} from pairing {mlos_col}, {update_col}")
            continue

    return merged_data