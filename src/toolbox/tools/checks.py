import re
from typing import Any

import pandas as pd

from toolbox.configs import CONFIG


def is_empty(value: Any) -> bool:
    if pd.isna(value):
        return True

    if value == 0:
        return True

    if value == '':
        return True

    return False


def count_delimiter(text: Any) -> int:
    delimiter = CONFIG.get('REGEX').get('DELIMITER')
    count = re.findall(rf'{delimiter}', str(text)).__len__()
    return count


def elements_have_equal_length(data: list) -> bool:
    # Handle edge cases: empty list or list with a single element
    # In both these cases, there's no variation in length, so it's considered True.
    if not data or len(data) <= 1:
        return True

    # Get the length of the first element to use as a reference
    try:
        reference_length = len(data[0])
    except TypeError:
        # If the first element does not have a length (e.g., an integer),
        # then we cannot compare lengths, so we return False or raise an error.
        # For this function, we'll assume elements should be "sizable".
        # You might want to raise a more specific error or handle differently
        # based on expected input types.
        print("Error: Elements in the list must support the 'len()' function.")
        return False

    # Iterate through the rest of the elements (starting from the second one)
    for element in data[1:]:
        try:
            if len(element) != reference_length:
                return False  # Found an element with a different length
        except TypeError:
            # If any subsequent element does not have a length, it's not consistent
            print("Error: Elements in the list must support the 'len()' function.")
            return False

    # If the loop completes, all elements have the same length
    return True


def coords_are_valid(coord_data: list[list[float]]) -> bool:
    if pd.isna(coord_data).any():
        return False

    if any([coord == 0 for coords in coord_data for coord in coords]):
        return False

    if any([coord == '' for coords in coord_data for coord in coords]):
        return False

    return True