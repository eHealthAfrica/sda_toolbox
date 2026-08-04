import pytest
import pandas as pd
import geopandas as gpd
from shapely import Point

from toolbox.access.read_mgr import prepare_and_create_gdf
from toolbox.exceptions import DataError


@pytest.fixture
def sample_data():
    data = {
        "id": [1, 2, 3],
        "value": [10, 20, 30],
        "geometry": [Point(1, 1), Point(3, 5), Point(3, 5)]
    }
    return pd.DataFrame(data)


@pytest.fixture
def sample_no_geom_data():
    data = {
        "id": [1, 2, 3],
        "value": [10, 20, 30],
        "category": [None, None, None]
    }
    return pd.DataFrame(data)


@pytest.fixture
def geo_data():
    data = {
        "id": [1, 2, 3],
        "value": [10, 20, 30],
        "geometry": [Point(1, 1), Point(3, 5), Point(3, 5)]  # Add geometry column if needed
    }
    return gpd.GeoDataFrame(data)


def test_input_geodata(geo_data):
    output_gdf = prepare_and_create_gdf(geo_data)

    pd.testing.assert_frame_equal(output_gdf, geo_data)


def test_dataframe_to_geoframe(sample_data):

    assert isinstance(sample_data, pd.DataFrame)

    output = prepare_and_create_gdf(sample_data)
    assert isinstance(output, gpd.GeoDataFrame)


def test_failed_conversion(sample_no_geom_data):
    assert isinstance(sample_no_geom_data, pd.DataFrame)
    with pytest.raises(DataError):
        prepare_and_create_gdf(sample_no_geom_data)
