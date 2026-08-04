import logging

import pandas as pd

from toolbox.tools import issues_counter
from toolbox.mlos import MLoSAttributes, Accessibility, YNAttributes, YN


def check_habitation_consistency(row: pd.Series, attributes: MLoSAttributes) -> None | str:
    """Checks for Consistency between security compromised, habitational status and reason for inaccessibility attributes"""
    compromised: str | None = row.get(attributes.y_n_attributes.security_compromised, None)
    accessibility: str | None  = row.get(attributes.preset_attributes.accessibility_status, None)

    if pd.isna(compromised) or pd.isna(accessibility):
        return None

    try:
        accessibility: Accessibility = Accessibility(accessibility)
        compromised: YN = YN(compromised)

        if compromised == YN.YES and accessibility == Accessibility.FULLY_ACCESSIBLE:
            return f"Cannot be security compromised and {accessibility.value}"

        if compromised == YN.NO and accessibility != Accessibility.FULLY_ACCESSIBLE:
            return f"Cannot be {accessibility.value} accessibility and not security compromised"

        reason = row.get(attributes.preset_attributes.reasons_for_inaccessibility)
        if compromised == YN.YES and pd.isna(reason):
            return "Reason for Security Compromised not Provided"

        if pd.notna(reason) and accessibility == Accessibility.FULLY_ACCESSIBLE:
            return f"{accessibility.value} settlement should not have {reason} reason for inaccessibility"

        return None
    except ValueError:
        return "Invalid Entry"


def check_settlement_type_consistency(row: pd.Series, attributes: YNAttributes) -> None | str:
    """Checks for consistency between settlement type attributes"""
    urban = row.get(attributes.urban)
    rural = row.get(attributes.rural)
    scattered = row.get(attributes.scattered)

    if urban == rural == scattered:
        return f"urban, rural and scattered cannot have the same {rural} value"

    category_map = {
        "urban": urban,
        "rural": rural,
        "scattered": scattered
    }

    check_for_yeses = {cat: value for cat, value in category_map.items() if value=='Y'}
    if 'urban' in check_for_yeses and 'scattered' in check_for_yeses:
        return f'urban and scattered cannot be both be Y'

    return None


def review_attributes_consistency(dataset: pd.DataFrame, data_attributes: MLoSAttributes) -> pd.DataFrame:
    """Consistency Evaluation for MLoS Entry Attributes"""
    logging.info('Reviewing Entries Consistency')
    dataset['habitation_fidelity'] = dataset.apply(check_habitation_consistency, args=(data_attributes,), axis=1)
    issues_counter(dataset, 'habitation_fidelity', 'habitational status consistency')

    dataset['settlement_type_fidelity'] = dataset.apply(
        check_settlement_type_consistency, args=(data_attributes.y_n_attributes,), axis=1)

    issues_counter(dataset, 'settlement_type_fidelity', 'Settlement Type consistency')

    return dataset
