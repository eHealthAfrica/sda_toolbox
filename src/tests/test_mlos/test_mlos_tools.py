import random
import pytest
import pandas as pd
from fuzzywuzzy import fuzz

from toolbox.exceptions import DataError
from toolbox.mlos import get_admin_col, detect_unique_admin_field, construct_new_unique


@pytest.fixture
def mlos_with_admin():
    data = {
        'state': ['Kebbi', 'Kaduna', 'Sokoto'],
        'lga': ['Birnin kebbi', 'Chikun', 'Kware'],
        'wards': ['kola tarasa', 'ward_2', 'ward W'],
        'settlement_name': ['settlement 1', 'Settlement 2', 'settlemenT 3']
    }

    return pd.DataFrame(data)


@pytest.fixture
def mlos():
    data = {
        'unique_col': ['state_lga_ward_settlement 1', 'state_lga_ward_settlement 2', 'state_lga_ward_settlement 3'],
        'state': ['Kebbi', 'Kaduna', 'Sokoto'],
        'lga': ['Birnin kebbi', 'Chikun', 'Kware'],
        'wards': ['kola tarasa', 'ward_2', 'ward W'],
        'settlement_name': ['settlement 1', 'Settlement 2', 'settlemenT 3']
    }

    return pd.DataFrame(data)


@pytest.fixture
def mlos_with_gaps():
    data = {
        'unique_col': [None, 'state_lga_ward_settlement 2', 'state_lga_ward_settlement 3'],
        'state': ['Kebbi', 'Kaduna', None],
        'lga': ['Birnin kebbi', None, 'Kware'],
        'wards': ['kola tarasa', None, 'ward W'],
        'settlement_name': ['settlement 1', None, 'settlemenT 3']
    }

    return pd.DataFrame(data)

@pytest.fixture
def mlos_no_state():
    data = {
        'statecode': ['Kebbi', 'Kaduna', 'Sokoto'],
        'lga': ['Birnin kebbi', 'Chikun', 'Kware'],
        'wards': ['kola tarasa', 'ward_2', 'ward W'],
        'settlement_name': ['settlement 1', 'Settlement 2', 'settlemenT 3']
    }

    return pd.DataFrame(data)

@pytest.fixture
def mlos_no_state_col():
    data = {
        'mandate': ['Kebbi', 'Kaduna', 'Sokoto'],
        'lga': ['Birnin kebbi', 'Chikun', 'Kware'],
        'wards': ['kola tarasa', 'ward_2', 'ward W'],
        'settlement_name': ['settlement 1', 'Settlement 2', 'settlemenT 3']
    }

    return pd.DataFrame(data)


def test_get_admin_col(mlos_with_admin):
    choice = random.choice(['state', 'lga', 'ward', 'settlement'])
    admin_col = get_admin_col(mlos_with_admin, choice)
    assert admin_col

    assert fuzz.partial_ratio(admin_col, choice) >= 90


def test_failed_admin_col(mlos_no_state_col):
    with pytest.raises(DataError):
        get_admin_col(mlos_no_state_col, 'state', error='raise')


def test_ignore_missing_admin(mlos_no_state):
     state = get_admin_col(mlos_no_state, 'state', 'ignore')
     assert state is None


def test_retrieved_unique_code(mlos):
    unique_code = detect_unique_admin_field(mlos)
    assert isinstance(unique_code, str)


def test_no_plausible_unique_col(mlos_with_gaps):
    unique_col = detect_unique_admin_field(mlos_with_gaps)

    assert unique_col is None


def test_construct_unique_id(mlos_with_admin):
    unique_col = 'uniquecode'
    construct_new_unique(mlos_with_admin, unique_col)
    assert unique_col in mlos_with_admin.columns
    assert mlos_with_admin[unique_col].str.contains('_').all()