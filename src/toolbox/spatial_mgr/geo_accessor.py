from typing import Literal, Any
from dataclasses import dataclass

import pandas as pd
from fuzzywuzzy import process

from toolbox.exceptions import NotFoundError
from toolbox.tools import filter_coordinate_column


@dataclass
class GeomColumns:
    latitude: str | None = None
    longitude: str | None = None

    @classmethod
    def get_geom_cols(cls, data: pd.DataFrame, enforce: bool) -> "GeomColumns":
        """find and retrieves the latitude and longitude columns from a dataset"""
        x_field_options = cls._get_plausible_columns(data.columns, 'x', enforce)
        y_field_options = cls._get_plausible_columns(data.columns, 'y', enforce)
        x_numeric_options = cls._filter_numeric_columns(data, x_field_options)
        y_numeric_options = cls._filter_numeric_columns(data, y_field_options)
        x_field = cls._filter_coords(x_numeric_options, 'x', data)
        y_field = cls._filter_coords(y_numeric_options, 'y', data)

        if (x_field is None or y_field is None) and (enforce is True):
            raise NotFoundError('missing coordinate field', 'Could not find both x and y fields')

        if x_field and y_field and x_field == y_field:
            raise NotFoundError('missing coordinate field', f'only {x_field} found')

        if (x_field is None and y_field) or (x_field and  y_field is None):
            raise NotFoundError('missing coordinate field', f'only coordinate field found')

        return GeomColumns(latitude=y_field, longitude=x_field)

    @staticmethod
    def _get_plausible_columns(columns: list, coord: Literal['x', 'y'], error_raise: bool) -> list[str] | None:
        fields_map = {
            'x': ['x', 'lon'],
            'y': ['y', 'lat']
        }

        data_fields = fields_map.get(coord)

        def check_item(item: Any) -> Any | None:
            if item:
                return item

            return None

        field_matches = list(
            filter(check_item, [
                process.extractBests(x, columns, limit=5,score_cutoff=50)
                for x in data_fields
            ])
        )
        if not any(field_matches) and error_raise:
            raise ValueError(f'{coord} Field Found')

        if not field_matches and not error_raise:
            return None

        found_fields = [filter(lambda x: x[-1] != 0, field_match) for field_match in field_matches]
        return [field[0] for found_field in found_fields for field in found_field]

    @staticmethod
    def _filter_numeric_columns(data: pd.DataFrame, coord_fields: list[str] | None) -> list[str] | None:
        if not coord_fields:
            return None

        plausible_coord_field = []
        for coord_field in coord_fields:
            if data[coord_field].dtype.name.startswith('float'):
                plausible_coord_field.append(coord_field)

        return plausible_coord_field

    @staticmethod
    def _filter_coords(options: list[str] | None, coord_type: Literal['x', 'y'], data: pd.DataFrame) -> str | None:
        if options is None or len(options)==0:
            return None

        pattern_matched = filter_coordinate_column(data, options)
        if not any(pattern_matched):
            return None

        if isinstance(pattern_matched, str):
            return pattern_matched

        coords_map = {
            'x': 'longitude',
            'y': 'latitude'
        }

        expected_field = coords_map.get(coord_type)
        matched: tuple[Any, ...] = process.extractOne(expected_field, pattern_matched, score_cutoff=85)
        if not matched:
            return None

        return matched[0]

    @property
    def not_found(self)-> bool:
        if self.latitude is None or self.longitude is None:
            return True

        return False
