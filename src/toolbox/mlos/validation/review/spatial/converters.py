import pandas as pd
import geopandas as gpd

from toolbox.configs import CONFIG
from toolbox.exceptions import MissingConfiguration
from toolbox.spatial_mgr import GeomColumns


def convert_str_to_float(string_value: str) -> None | float:
    try:
        if pd.isna(string_value):
            return None

        float_value = float(string_value)
        return float_value

    except ValueError:
        return None


def convert_to_geodata(data: pd.DataFrame, geo_columns: GeomColumns) -> gpd.GeoDataFrame:
    try:
        geometries = gpd.points_from_xy(
            data[geo_columns.longitude],
            data[geo_columns.latitude],
            crs=f'EPSG:{CONFIG["SOURCE_EPSG"]}'
        )

        gdf: gpd.GeoDataFrame = gpd.GeoDataFrame(data, geometry=geometries)
        return gdf
    except KeyError as e:
        raise MissingConfiguration('Config Attribute Missing', f'{e}')