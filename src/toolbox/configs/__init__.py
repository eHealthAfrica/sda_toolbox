from typing import Any
from toolbox.utils import read_config, read_json

CONFIG: dict[str, Any] = read_config(file_name='config.yaml')
PCONFIG: dict[str, Any] = read_config(file_name='planfeld_config.yaml')
members = read_json(file_name='members.json')
