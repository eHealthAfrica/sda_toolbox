import io
import logging
import warnings
from typing import Any
from pathlib import Path

import psycopg2
import pandas as pd
import geopandas as gpd
from fastapi import UploadFile
from sqlalchemy import create_engine
from functools import cached_property
from pandas.errors import ParserError, ParserWarning

from toolbox.utils import Credential
from toolbox.spatial_mgr import GeomColumns
from toolbox.tools import parse_read_parameters
from toolbox.spatial_mgr import convert_to_geodata
from toolbox.access.read.spatial_handler import ESRIHandler, OSGeoHandler
from toolbox.exceptions import FileNotFound, NotSupportedError, NoRecordsFound

warnings.filterwarnings(action='ignore')


class SpatialHandler:
    def __init__(self, file_path: UploadFile | str):
        self.file_path = file_path


    async def read_spatial_data(self):
        ...

    @property
    def extension(self):
        if hasattr(self.file_path, 'filename') and hasattr(self.file_path, 'file'):
            extension = self.file_path.filename.split('.')[-1]

        else:
            extension = self.file_path.split('.')[-1]

        return extension


class Reader:
    def __init__(self, directory: str):
        self.directory = Path(directory)
    
    def read_data(self, **kwargs):
        ...


class ReadGeoData:
    """Reads Spatial Datasets"""
    def __init__(self, file_path: UploadFile, table_name: str=None):
        self.file_path = file_path
        self.table_name = table_name

    async def read_data(self) -> gpd.GeoDataFrame:
        handler = SpatialHandler(self.file_path)
        layer_extension =  handler.extension


        if layer_extension not in ['shp', 'kml', 'kmz', 'sqlite', 'gpkg', 'zip']:
            raise NotSupportedError('Not Compatible', f'{layer_extension} is not supported with ReadGeoData')

        if layer_extension in ['shp', 'zip']:
            data = await ESRIHandler(self.file_path).read_spatial_data()
            return data

        if layer_extension in ['sqlite', 'gpkg', 'db']:
            return await OSGeoHandler(self.file_path, self.table_name).read_spatial_data()

        # if layer_extension == 'kmz':
        #     return self._read_kmz(self.file_path)

        else:
            raise FileNotFound('Not Found', 'Cannot Read File. Not Supported')

    @staticmethod
    def read_gdb(gdb: Path, layer_name: str):
        return gpd.read_file(gdb, driver='FileGDB', layer=layer_name)


class ReadTableData:
    def __init__(self, file_path: UploadFile| str, has_coord: bool):
        self.file_path = file_path
        self.has_coord = has_coord

    async def read_data(self, sheet_name: str=0) -> pd.DataFrame | gpd.GeoDataFrame:
        if hasattr(self.file_path, 'filename') and hasattr(self.file_path, 'file'):
            extension = self.file_path.filename.split(".")[-1]
        else:
            extension = self.file_path.split(".")[-1]

        if extension not in ['csv', 'xls', 'xlsx']:
            raise FileNotFound('missing file', f'{self.file_path} is not a valid file')

        try:
            if hasattr(self.file_path, 'filename'):
                logging.info(f'Reading File: {self.file_path.filename}')
                read_file = await self.file_path.read()
                content = io.BytesIO(read_file)
            else:
                logging.info(f'Reading File: {self.file_path}')
                content = self.file_path

            if extension == 'csv':
                logging.info('Reading CSV File')
                data = pd.read_csv(content)

            else:
                logging.info('Reading Excel File')
                data = pd.read_excel(content, engine='openpyxl', sheet_name=sheet_name)
                if isinstance(data, dict):
                    for value in data.values():
                        data = value
                        break

        except (ParserError, ParserWarning) as e:
            logging.warning(f'Error: {e}. Attempting Alternate Solution...')
            data = self.read_data_from_csv(content, self.has_coord) # noqa

        if not self.has_coord:
            return data

        geo_columns: GeomColumns = GeomColumns.get_geom_cols(data, self.has_coord)
        return convert_to_geodata(data, geo_columns)

    @classmethod
    def read_data_from_csv(cls, data: Any, is_tracks: bool):
        try:
            # Use pandas' optimized CSV reader with error handling
            df = pd.read_csv(
                data,
                on_bad_lines='skip', # or 'skip' depending on requirements
                header=0,
                low_memory=False
            )

            return df

        except Exception as e:
            logging.error(f"Failed to read CSV: {e}")
            raise


class ReadDBData(Reader):
    def __init__(self, db_table: str, is_spatial: bool, credential: Credential = None):
        self.credential = credential if credential else Credential()
        self.db_table = db_table
        self.is_spatial = is_spatial
        self.engine = create_engine(self.credential.connection_string)
        self.connect = psycopg2.connect(**self.credential.__dict__)
        self.cursor = self.connect.cursor()
        super().__init__(db_table)

    def read_data(self, params: dict[str, Any]=None) -> pd.DataFrame | gpd.GeoDataFrame:
        query = f'SELECT * FROM {self.db_table}'
        values = None

        if params:
            fields_map, values = parse_read_parameters(params)
            query += f" WHERE {fields_map}"

        logging.info(f'Reading Database Table: {self.db_table}')

        if self.is_spatial:
            data: gpd.GeoDataFrame =  gpd.read_postgis(query, self.engine.connect(), self.geo_col, params=values)
            data.rename_geometry('geometry', inplace=True) if 'geom' in data.columns else None

        else:
            data: pd.DataFrame = pd.read_sql(query, self.connect, params=values)

        if data.empty:
            columns = ", ".join([col for col in params.keys()])
            value_str = ", ".join(val for val in values)
            raise NoRecordsFound(
                'No Records found', f'No Records in for {value_str} in {columns} in {self.db_table} was found')

        return data

    @cached_property
    def geo_col(self):
        self.cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s
            AND data_type = 'USER-DEFINED'
            AND udt_name = 'geometry';
            """,
            (self.db_table,),
        )

        result = self.cursor.fetchone()

        if result:
            geometry_column = result[0]
            return geometry_column

        print(f"No geometry column found in table: {self.db_table}")
        logging.warning(f"No geometry column found in table: {self.db_table}")
        return None
