import re

from tqdm import tqdm
import pandas as pd

from toolbox.tools import is_empty, find_column
from toolbox.mlos import MLoSAttributes
from toolbox.configs import CONFIG


def review_comments(comment: str, comment_pattern: str):
    """Uses REGEX to identify that can be ignored for validation"""

    if is_empty(comment):
        return False

    invalid_match = re.search(rf"{comment_pattern}",comment, re.IGNORECASE)
    if invalid_match:
        return True

    return False


def flag_validated_unknown_settlements(mlos_data: pd.DataFrame, attributes: MLoSAttributes):
    invalid_settlement_keywords = "|".join(CONFIG["KEYWORDS"]['EXCLUSION'])
    invalid_pattern = f"(?:{invalid_settlement_keywords})"
    comment_col = find_column(mlos_data, attributes.comment)

    tqdm.pandas(desc="Reviewing Comments")
    mlos_data['is_invalid'] = mlos_data[comment_col].progress_apply(review_comments, args=(invalid_pattern,))
    mlos_data.loc[
        mlos_data[attributes.preset_attributes.habitational_status].isin(['Migrated', 'Abandoned']),
        ["is_invalid"]] = True

    return mlos_data