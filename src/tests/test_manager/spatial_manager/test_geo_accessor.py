import pytest
import pandas as pd

from toolbox.spatial_mgr.geo_accessor import GeomColumns
from toolbox.exceptions import NotFoundError


@pytest.fixture
def valid_dataset():
    data = {
        'uniquecode': ['a', 'b', 'c'],
        'latitude': [12.566, 11.453, 13.4121],
        'longitude': [4.134, 4.5463, 4.3644]
    }

    return pd.DataFrame(data)


@pytest.fixture
def invalid_dataset():
    data = {
        'uniquecode': ['a', 'b', 'c'],
        'latitude': [12.566, 11.453, 13.4121],
        'longitude': [4134, 45463, 43644],
        'population': [4134, 45463, 43644]
    }

    return pd.DataFrame(data)


@pytest.fixture
def all_text_data():
    data = {
        'uniquecode': ['a', 'b', 'c'],
        'dove': ['12.566', '11.453', '13.4121'],
        'cancer': ['4134', '45463', '43644']
    }

    return pd.DataFrame(data)

def test_empty_initialized_geo_columns():
    geo_column = GeomColumns()
    data = geo_column.__dict__
    assert all([value is None for value in data.values()])


def test_enforced_geo_columns(valid_dataset):
    geo_cols = GeomColumns.get_geom_cols(valid_dataset, True)
    data = geo_cols.__dict__
    assert all([value is not None for value in data.values()])


def test_no_viable_columns_unenforced(all_text_data):
    geo_cols = GeomColumns.get_geom_cols(all_text_data, False)
    data = geo_cols.__dict__
    assert all([value is None for value in data.values()])


def test_no_viable_columns_enforced(all_text_data):
    with pytest.raises(ValueError):
        GeomColumns.get_geom_cols(all_text_data, True)


def test_only_one_coord_found(invalid_dataset):
    with pytest.raises(NotFoundError):
        GeomColumns.get_geom_cols(invalid_dataset, False)
