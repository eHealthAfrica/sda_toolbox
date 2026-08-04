import logging
from enum import Enum
from typing import Optional

import pandas as pd
from pyproj import CRS
import geopandas as gpd

from toolbox.configs import CONFIG
from toolbox.tools import convert_to_degrees
from toolbox.spatial_mgr.geo_accessor import GeomColumns
from toolbox.exceptions import DataError, MissingConfiguration


class ProjectionType(Enum):
    PROJECTED='PROJECTED'
    GEOGRAPHIC='GEOGRAPHIC'


class SpatialOps:
    @staticmethod
    def check_and_match_projection(
            data: gpd.GeoDataFrame, base_data: Optional[gpd.GeoDataFrame]=None, crs_code: str | int = None) -> gpd.GeoDataFrame:

        if not isinstance(data, gpd.GeoDataFrame):
            raise DataError('Invalid Data Type', 'provided dataset is not a GeoDataFrame')

        if base_data is not None and not isinstance(base_data, gpd.GeoDataFrame):
            raise DataError('Invalid Data Type', 'provided base dataset is not a GeoDataFrame')

        if base_data is None and crs_code is None:
            raise DataError('missing info', 'You must either provide a reference data or a crs code')

        if base_data is not None:
            base_crs = base_data.crs
        else:
            base_crs = CRS.from_epsg(crs_code)

        logging.info('Checking for Projection Consistency...')
        if data.crs == base_crs:
            return data

        logging.info(f"Converting Projection to {base_crs.name}")
        data.to_crs(base_crs, inplace=True)
        return data

    @staticmethod
    def check_projection_type(gdf: gpd.GeoDataFrame) -> ProjectionType:
        if not isinstance(gdf, gpd.GeoDataFrame):
            raise DataError('Invalid Data Type', 'provided dataset is not a GeoDataFrame')

        crs_type = gdf.crs.type_name
        if crs_type.__contains__('Geographic'):
            return ProjectionType.GEOGRAPHIC
        elif crs_type.__contains__('Projected'):
            return ProjectionType.PROJECTED
        
        raise DataError("Invalid Data Type", 'Could not Determine Projection Type')

    @classmethod
    def create_buffer(cls, gdf: gpd.GeoDataFrame, buffer_distance_meters: float | int= None) -> gpd.GeoDataFrame:
        try:
            logging.info('Creating Buffer...')

            buffer_distance_meters = buffer_distance_meters if buffer_distance_meters else CONFIG['BUFFER_DISTANCE_METERS']
            projection_type = cls.check_projection_type(gdf)
            if projection_type == ProjectionType.PROJECTED:
                buffer = gdf.buffer(buffer_distance_meters)

            else:
                distance_degree = convert_to_degrees(buffer_distance_meters, 'meters')
                buffer = gdf.buffer(distance_degree)

            buffered_gdf = gpd.GeoDataFrame(buffer)
            buffered_gdf.set_geometry(0, inplace=True)
            buffered_gdf.rename_geometry('geometry', inplace=True)

            return buffered_gdf
        except KeyError as e:
            raise MissingConfiguration('Missing config', f'{e}')

    @classmethod
    def clip_dataset(cls, in_data: gpd.GeoDataFrame, clip_boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        clip_boundary: gpd.GeoDataFrame = cls.check_and_match_projection(clip_boundary, in_data)

        logging.info('Clipping Data to Boundary...')
        clipped: gpd.GeoDataFrame = in_data.clip(clip_boundary)
        return clipped


def convert_to_geodata(data: pd.DataFrame, geo_columns: GeomColumns) -> gpd.GeoDataFrame:
    try:
        geometries = gpd.points_from_xy(
        data[geo_columns.longitude],
        data[geo_columns.latitude],
        crs=f'EPSG:{CONFIG["SOURCE_EPSG"]}'
        )

        gdf: gpd.GeoDataFrame = gpd.GeoDataFrame(data, geometry=geometries)
        return gdf
    except KeyError:
        raise MissingConfiguration('Missing Config', "SOURCE_EPSG Config is Missing")
