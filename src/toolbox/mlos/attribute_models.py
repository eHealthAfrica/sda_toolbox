from dataclasses import dataclass, field
from typing import Optional
from enum import Enum
import logging

import pandas as pd
from fuzzywuzzy import process

from toolbox.configs import CONFIG
from toolbox.models import Policy
from toolbox.tools import find_column


@dataclass
class YNAttributes:
    security_compromised: Optional[str] = field(default=None)
    urban: Optional[str] = field(default=None)
    rural: Optional[str] = field(default=None)
    scattered: Optional[str] = field(default=None)
    highrisk: Optional[str] = field(default=None)
    slums: Optional[str] = field(default=None)
    densely_populated: Optional[str] = field(default=None)
    hard2reach: Optional[str] = field(default=None)
    border: Optional[str] = field(default=None)
    nomadic: Optional[str] = field(default=None)
    riverine: Optional[str] = field(default=None)
    fulani: Optional[str] = field(default=None)


@dataclass
class NumericAttributes:
    set_population: Optional[str] = field(default=None)
    set_target: Optional[str] = field(default=None)
    number_of_household: Optional[str] = field(default=None)
    noncompliant_household: Optional[str] = field(default=None)
    team_code: Optional[str] = field(default=None)

    def allow_zero(self):
        return {
            self.set_target: False,
            self.set_population: False,
            self.team_code: False,
            self.noncompliant_household: True,
            self.number_of_household: False
        }


@dataclass
class PresetAttributes:
    """MLoS Attribute columns object for non YN columns"""
    day_of_activity: Optional[str] = field(default=None)
    border_type: Optional[str] = field(default=None)
    accessibility_status: Optional[str] = field(default=None)
    reasons_for_inaccessibility: Optional[str] = field(default=None)
    habitational_status: Optional[str] = field(default=None)

    def preset_attribute_map(self):
        """Retrieves and Maps the preset values for each field in the data"""
        validation_mapper = {}
        configuration = CONFIG['PRESET_VALUES']
        for key, value in self.__dict__.items():
            if not value:
                continue

            preset_values = configuration.get(key)
            if not preset_values:
                continue

            validation_mapper[value] = preset_values

        return validation_mapper


@dataclass
class MLoSAttributes:
    y_n_attributes: Optional[YNAttributes] = None
    numeric_attributes: Optional[NumericAttributes] = None
    preset_attributes: Optional[PresetAttributes] = None
    _take_off_point: Optional[str] = None
    _gis_feedback: Optional[str] =None
    _comment: Optional[str] = None
    _global_id: str = None

    @property
    def comment(self):
        return self._comment

    @property
    def gis_feedback(self):
        return self._gis_feedback

    @property
    def take_off_point(self):
        return self._take_off_point

    @property
    def global_id(self):
        return self._global_id

    def __repr__(self, **kwargs):

        col_map = {
            **self.y_n_attributes.__dict__,
            **self.preset_attributes.__dict__,
            **self.numeric_attributes.__dict__,
            'global_id': self.global_id,
            'take_off_point': self.take_off_point
        }

        col_map.update(kwargs)
        return {attrib: col for attrib, col in col_map.items() if col is not None}

    @staticmethod
    def find_columns(source: dict[str, str], data_columns: list[str], attrib_name: str):
        remapped_columns = {}
        for value in source:
            if attrib_name in remapped_columns:
                continue

            result: list[tuple[str, float]] = process.extractBests(value, data_columns, score_cutoff=91, limit=1)
            if not result:
                continue

            remapped_columns[value] = result[0][0]

        return remapped_columns

    @classmethod
    def map_columns(cls, columns: list, schema_config: dict[str, dict[str, str]]):
        column_mapper = {}
        for attribute in schema_config:
            attribute_name = attribute.lower().replace("columns", "attributes")
            column_mapper[attribute_name] = cls.find_columns(schema_config.get(attribute), columns, attribute_name)

        return column_mapper

    def __call__(self, dataset: pd.DataFrame, config: dict, policy: Policy=Policy.MLOS, **kwargs) -> 'MLoSAttributes':
        """Builds parses and builds an attribute object from the MLoS data"""
        logging.info('Constructing Entry Attributes Object')
        attribute_data: dict[str, dict[str, str]] = self.map_columns(dataset.columns, config)
        take_off_point = find_column(dataset, 'take_off_point', 'ignore')
        comment = find_column(dataset, 'comment', 'ignore')
        gis_feedback = find_column(dataset, 'gis_feedback', 'ignore')
        global_id = find_column(dataset, config['GUID'][policy.value], 'ignore')

        mlos_attributes: MLoSAttributes = MLoSAttributes(
            numeric_attributes=NumericAttributes(**attribute_data.get('numeric_attributes')),
            y_n_attributes=YNAttributes(**attribute_data.get('y_n_attributes')),
            preset_attributes=PresetAttributes(**attribute_data.get('preset_attributes')),
            _global_id=global_id,
            _take_off_point=take_off_point,
            _gis_feedback=gis_feedback,
            _comment=comment
        )

        return mlos_attributes


class Accessibility(Enum):
    FULLY_ACCESSIBLE = "Fully Accessible"
    INACCESSIBLE = "Inaccessible"
    PARTIALLY_ACCESSIBLE = "Partially Accessible"


class YN(Enum):
    YES = "Y"
    NO = "N"