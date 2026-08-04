from fuzzywuzzy import fuzz
from fuzzywuzzy.process import extractOne

def filter_target(target_list: list[str], search_list: list[str]) -> list[str]:
    """Filters the target list based on the search list."""

    matched = []
    for item in target_list:
        match, score = extractOne(item, search_list, scorer=fuzz.token_sort_ratio)
        if score >= 95 and match not in matched:
            matched.append(match)

    return matched