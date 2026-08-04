import pandas as pd
import geopandas as gpd
import pytest

from toolbox.spatial_mgr import SpatialOps, ProjectionType, GeomColumns, convert_to_geodata
from toolbox.exceptions import DataError


@pytest.fixture
def dataset():
    data = {
        'uniquecode': ['a', 'b', 'c'],
        'latitude': [12.566, 11.453, 13.4121],
        'longitude': [4.134, 4.5463, 4.3644]
    }

    df = pd.DataFrame(data)
    return df

@pytest.fixture
def geodataset():
    data = {
        'uniquecode': ['a', 'b', 'c'],
        'latitude': [12.566, 11.453, 13.4121],
        'longitude': [4.134, 4.5463, 4.3644]
    }

    df = pd.DataFrame(data)
    gdf = gpd.GeoDataFrame(
        df, geometry=gpd.points_from_xy(df.longitude, df.latitude), crs='EPSG:4326'
    )
    return gdf


@pytest.fixture
def polygon():
    data = {
        'id': [1],
        'geometry': [gpd.GeoSeries.from_wkt(
            ['POLYGON((4.0871 12.3902, 3.8136 12.2417, 4.2747 13.9139, 4.0871 12.3902))']
        ).iat[0]]
    }
    gdf = gpd.GeoDataFrame(data, crs='EPSG:4326')
    return gdf


@pytest.fixture
def geodataset_projected():
    data = {
        'uniquecode': ['a', 'b', 'c'],
        'latitude': [1256.6, 1145.3, 13412.1],
        'longitude': [4.134, 4.5463, 4.3644]
    }

    df = pd.DataFrame(data)
    gdf = gpd.GeoDataFrame(
        df, geometry=gpd.points_from_xy(df.longitude, df.latitude), crs='EPSG:32632'
    )
    return gdf


def test_convert_to_geodata(dataset):
    geo_cols = GeomColumns.get_geom_cols(dataset, True)
    geo_data = convert_to_geodata(dataset, geo_cols)
    assert isinstance(geo_data, gpd.GeoDataFrame)
    assert 'geometry' in geo_data.columns


def test_check_projection_type_geographic(geodataset):
    proj_type = SpatialOps.check_projection_type(geodataset)
    assert proj_type == ProjectionType.GEOGRAPHIC


def test_check_projection_type_projected(geodataset_projected):
    proj_type = SpatialOps.check_projection_type(geodataset_projected)
    assert proj_type == ProjectionType.PROJECTED


def test_check_projection_type_invalid(dataset):
    with pytest.raises(DataError):
        SpatialOps.check_projection_type(dataset)


def test_create_buffer_geographic(geodataset):
    buffered = SpatialOps.create_buffer(geodataset)
    assert geodataset.within(buffered.union_all('unary')).all()
    buffer_extent = buffered.total_bounds
    original_extent = geodataset.total_bounds
    assert all(buffer_extent[i] != original_extent[i] for i in range(4))
    assert geodataset.geometry.iat[0] != buffered.geometry.iat[0]


def test_check_and_match_projection_with_crs(geodataset):
    geodataset_copy = geodataset.copy()
    reprojected = SpatialOps.check_and_match_projection(geodataset_copy, crs_code=32632)
    assert geodataset.crs != reprojected.crs
    assert SpatialOps.check_projection_type(reprojected) == ProjectionType.PROJECTED


def test_check_and_match_projection_with_geodata(geodataset, geodataset_projected):
    reprojected = SpatialOps.check_and_match_projection(geodataset_projected, base_data=geodataset)
    assert geodataset.crs == reprojected.crs


def test_check_and_match_projection_with_input_dataframe(dataset):
    with pytest.raises(DataError):
        SpatialOps.check_and_match_projection(dataset, crs_code=326322)


def test_check_and_match_projection_with_base_dataframe(dataset, geodataset):
    with pytest.raises(DataError):
        SpatialOps.check_and_match_projection(geodataset, dataset)


def test_check_and_match_projection_no_argument(geodataset):
    with pytest.raises(DataError):
        SpatialOps.check_and_match_projection(geodataset)


def test_check_and_match_projection_matching_projection(geodataset, geodataset_projected):
    reprojected = geodataset_projected.to_crs('4326')
    reprojected = SpatialOps.check_and_match_projection(geodataset_projected, base_data=reprojected)
    assert reprojected.crs == reprojected.crs


def test_clip_dataset(geodataset, polygon):
    clipped = SpatialOps.clip_dataset(geodataset, polygon)
    assert isinstance(clipped, gpd.GeoDataFrame)
    assert len(geodataset) > len(clipped)