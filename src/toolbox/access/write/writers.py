import logging
from pathlib import Path
from typing import Any

import pandas as pd
import geopandas as gpd
from sqlalchemy import create_engine
import psycopg2
from psycopg2.extras import execute_values

from toolbox.utils import Credential


class Writer:
    def __init__(self, dataset: pd.DataFrame | gpd.GeoDataFrame, save_path: str | Path):
        self.dataset = dataset
        self.save_path: Path = save_path if isinstance(save_path, Path) else Path(save_path)

    def save_data(self, save_name: str):
        ...

    def has_extension(self):
        extension = self.save_path.suffix
        if not extension:
            return False

        if extension not in ['.csv', '.shp']:
            return False

        return True


class CSVWriter(Writer):
    def __init__(self, dataset, save_path):
        self.dataset = dataset
        self.save_path = save_path
        super().__init__(dataset, save_path)

    def save_data(self, save_name: str=None):
        if save_name is None and self.has_extension() is False:
            raise ValueError('Save name is required')

        output_name = self.save_path if self.has_extension() else f"{self.save_path}\\{save_name}.csv"
        if isinstance(self.dataset, gpd.GeoDataFrame):
            self.dataset = pd.DataFrame(self.dataset)
            self.dataset.drop(columns='geometry', inplace=True, errors='ignore')

        logging.info(f'Saving {save_name} as CSV')
        self.dataset.to_csv(output_name, index=False)


class GeoWriter(Writer):
    def __int__(self, dataset, save_path):
        self.dataset = dataset
        self.save_path = save_path
        super().__init__(dataset, save_path)

    def save_data(self, save_name: str=None):
        if save_name is None and self.has_extension() is False:
            raise ValueError('Save name is required')

        output_name = self.save_path if self.has_extension() else f"{self.save_path}\\{save_name}.shp"
        if not isinstance(self.dataset, gpd.GeoDataFrame):
            logging.error('Dataset is not a GeoDataFrame')
            raise TypeError(f'Cannot Convert a {type(self.dataset)} to a GeoDataSet')

        logging.info(f'Saving {save_name} as a shapefile')
        self.dataset.to_file(output_name, index=False)


class DBWriter:
    def __init__(self, table_name: str):
        # self.dataset: pd.DataFrame = dataset
        self.table_name: str = table_name
        self.credential: Credential = Credential()
        self.engine = create_engine(self.credential.connection_string)
        self.connect = psycopg2.connect(**self.credential.__dict__)
        self.cursor = self.connect.cursor()

    def save_data(self, update_ids: list):
        placeholders = ", ".join(["%s"] * len(update_ids))
        update_query = f"""
        UPDATE {self.table_name}
        SET visitation = 'Visited'
        WHERE id IN ({placeholders});
        """
        logging.info(f'Updating {self.table_name}...')

        # 4. Execute the bulk update
        self.cursor.execute(update_query, tuple(update_ids))

        # 5. Commit and close
        self.connect.commit()
        self.cursor.close()
        self.connect.close()

        # self.dataset.to_file(f'{self.save_path}\\{save_name}.shp', index=False)
