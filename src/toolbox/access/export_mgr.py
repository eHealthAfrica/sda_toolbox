import io
from zipfile import ZipFile
from typing import Literal

import pandas as pd
import geopandas as gpd


class Exporter:
    data: pd.DataFrame | gpd.GeoDataFrame
    export_name: str

    def create_export(self):
        ...


def export_file(exporter: Exporter):
    return exporter.create_export()

import tempfile
import os


def create_spatial_sqlite(gdf: gpd.GeoDataFrame, table_name) -> bytes:
    """Create an in-memory SQLite database with spatial data"""
    # Create a temporary file path
    with tempfile.NamedTemporaryFile(suffix='.gpkg', delete=False) as tmp_file:
        temp_path = tmp_file.name

    try:
        # Save GeoDataFrame to SQLite with geopandas
        gdf.to_file(temp_path, driver='GPKG', layer=table_name, encoding='utf-8')

        # Read the file back into memory
        with open(temp_path, 'rb') as f:
            return f.read()
    finally:
        # Ensure the temp file is deleted even if errors occur
        try:
            os.unlink(temp_path)
        except:
            pass


def add_to_archive(zipper: ZipFile, data: pd.DataFrame | gpd.GeoDataFrame, file_name: str, db_name: str=None):
    import warnings
    if isinstance(data, gpd.GeoDataFrame):
        warnings.filterwarnings(action='error')
        data_bytes = create_spatial_sqlite(data, file_name)
        zipper.writestr(db_name, data_bytes)
    else:
        data_buffer = io.StringIO()
        data.to_csv(data_buffer, index=False, encoding='utf-8')
        zipper.writestr(file_name, data_buffer.getvalue())