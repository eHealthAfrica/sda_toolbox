import tempfile
from pathlib import Path
from dataclasses import dataclass

import pandas as pd
import geopandas as gpd


@dataclass
class CSVExporter:
    data: gpd.GeoDataFrame | pd.DataFrame
    export_name: str

    def create_export(self):
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
        self.data.to_csv(temp_file.name, index=False)
        temp_file.close()
        x = Path(temp_file)
        return Path(temp_file) , temp_file


@dataclass
class SQliteExporter:
    data: pd.DataFrame | gpd.GeoDataFrame
    export_name: str

    def create_export(self):
        temp_dir_obj = tempfile.TemporaryDirectory()
        temp_path = Path(temp_dir_obj.name)
        db_path = temp_path / "tracks.sqlite"
        temp_path.mkdir(parents=True, exist_ok=True)
        self.data.to_file(str(db_path), driver="SQLite", layer=self.export_name)

        return temp_path, db_path


if __name__ == '__main__':
    data = pd.read_csv(r"C:\WORKSPACE\RES\RES_11\res_11_dip.csv")
    ex = CSVExporter(data, '').create_export()