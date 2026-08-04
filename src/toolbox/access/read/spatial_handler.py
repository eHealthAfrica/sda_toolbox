import os
import sqlite3
import logging
import asyncio
import tempfile
import warnings
from concurrent.futures import ThreadPoolExecutor

import pyogrio
import geopandas as gpd
from fastapi import UploadFile

from toolbox.utils import atimer
from toolbox.tools import extract_and_find_file
from toolbox.exceptions import DataError, NotSupportedError, FileNotFound, TableNotFound

warnings.filterwarnings(action='ignore')
executor = ThreadPoolExecutor(max_workers=4)


class TempSaver:
    def __init__(self, file: UploadFile):
        self.file = file

    async def save_upload_file(self, to_folder: bool):
        if to_folder:
            return self.save_to_folder(self.file)

        return self.save_file(self.file)

    @staticmethod
    async def save_to_folder(uploaded_file: UploadFile):
        logging.info('Saving to Temporary Folder')
        with tempfile.TemporaryDirectory() as temp_dir:
            save_path = os.path.join(temp_dir, uploaded_file.filename)
            with open(save_path, "wb") as f:
                while contents := await uploaded_file.read(1024 * 1024):  # 1MB chunks
                    f.write(contents)
            return save_path

    @staticmethod
    async def save_file(uploaded_file):
        logging.info('Saving File to Temporary Location')
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(uploaded_file.filename)[1]) as tmp:
                while contents := await uploaded_file.read(1024 * 1024):  # 1MB chunks
                    tmp.write(contents)
                return tmp.name
        except Exception as e:
            logging.error(f"Error saving file: {str(e)}")
            raise DataError('could not save', details=f"Error saving file: {str(e)}")


class ESRIHandler:
    def __init__(self, file_path: UploadFile):
        self.file_path = file_path

    @staticmethod
    async def save_uploaded_file(upload_file: UploadFile, temp_dir: str):
        """Stream the upload to disk without loading entirely into memory"""
        logging.info('Saving to Temporary Folder')
        zip_path = os.path.join(temp_dir, upload_file.filename)
        with open(zip_path, "wb") as f:
            while contents := await upload_file.read(1024 * 1024):  # 1MB chunks
                f.write(contents)
        return zip_path

    @staticmethod
    def read_shapefile(shp_path: str):
        """Read shapefile using pyogrio (faster than geopandas)"""
        logging.info(f'Reading {shp_path}')
        return pyogrio.read_dataframe(shp_path)

    @atimer
    async def read_spatial_data(self):
        if not self.file_path.filename.endswith('.zip'):
            logging.error('non-zipped not supported for reading shapefiles')
            raise NotSupportedError('non-zipped not supported', details="Only ZIP files are accepted")

        with tempfile.TemporaryDirectory() as temp_dir:
            try:
                # Step 1: Stream upload to disk
                zip_path = await self.save_uploaded_file(self.file_path, temp_dir)

                # Step 2: Extract in thread pool
                shp_path = await asyncio.get_event_loop().run_in_executor(
                    executor, extract_and_find_file, zip_path, temp_dir, 'shp'
                )

                if not shp_path:
                    logging.error("No .shp file found in zipped folder")
                    raise FileNotFound('file missing', details="No .shp file found")

                # Step 3: Read shapefile in thread pool
                gdf = await asyncio.get_event_loop().run_in_executor(
                    executor, self.read_shapefile, shp_path
                )

                return gdf

            except Exception as e:
                logging.error(f'error encountered: {e}')
                raise


class OSGeoHandler:
    def __init__(self, file_path: UploadFile, table_name: str | None = None):
        self.file_path = file_path
        self.table_name = table_name

    @staticmethod
    def is_valid_sqlite(sqlite_file: str) -> bool:
        """Check if the file is a valid SQLite database"""
        logging.info("checking SQLite Validity")
        try:
            conn = sqlite3.connect(sqlite_file)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            conn.close()
            return len(tables) > 0
        except Exception as e:
            logging.warning(f'SQLite is a valid DB, {e}')
            return False

    @staticmethod
    def _is_upload(file_input) -> bool:
        if hasattr(file_input, 'filename') and hasattr(file_input, 'file'):
            return True

        return False

    @staticmethod
    def get_spatial_tables(file_path: str) -> list:
        """Get a list of spatial tables in SQLite/GeoPackage"""
        logging.info("Retrieving Tables in DB")
        try:
            gdf = gpd.list_layers(file_path)
            return gdf['name'].unique().tolist() if hasattr(gdf, 'name') else ['default']
        except Exception as e:
            logging.error(f"Error reading spatial tables: {str(e)}")
            raise DataError('error encountered', details=f"Error reading spatial tables: {str(e)}")

    async def save_uploaded_file(self) -> str:
        """Save uploaded file to temporary location"""
        logging.info('Saving File to Temporary Location')
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(self.file_path.filename)[1]) as tmp:
                while contents := await self.file_path.read(1024 * 1024):  # 1MB chunks
                    tmp.write(contents)
                return tmp.name
        except Exception as e:
            logging.error(f"Error saving file: {str(e)}")
            raise DataError('could not save', details=f"Error saving file: {str(e)}")

    @property
    def extension(self):
        if hasattr(self.file_path, 'filename') and hasattr(self.file_path, 'file'):
            extension = self.file_path.filename.split('.')[-1]

        else:
            extension = self.file_path.split('.')[-1]

        return extension

    async def read_spatial_data(self):
        if self.extension not in ['gpkg', 'sqlite', 'db']:
            logging.error("Only .gpkg, .sqlite, or .db files are accepted")
            raise NotSupportedError(
                f"{self.extension} not supported", details="Only .gpkg, .sqlite, or .db files are accepted")

        file_path = await self.save_uploaded_file() if self._is_upload(self.file_path) else self.file_path

        try:
            if not self.is_valid_sqlite(file_path):
               logging.error("Invalid database")
               raise DataError("invalid data", details="Invalid SQLite database")

            # Get available spatial tables if none specified
            available_tables = self.get_spatial_tables(file_path)
            if self.table_name and self.table_name not in available_tables:
                raise TableNotFound(
                    f"{self.table_name} not found",
                    details=f"{self.table_name} not found. Available tables: {', '.join(available_tables)}"
                )

            logging.info('Reading Dataset')
            layer = self.table_name if self.table_name else None
            gdf = gpd.read_file(file_path, layer=layer)

            # Clean up the temporary file
            if self._is_upload(file_path):
                os.unlink(file_path)

            return gdf

        except Exception as e:
            logging.error(f'Error Encountered: {e}')
            os.unlink(file_path) if self._is_upload(file_path) else None
            raise
