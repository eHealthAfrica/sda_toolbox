import io
import os
import string
import zipfile
import tempfile
import logging
from pathlib import Path
from typing import Literal, Any
from datetime import datetime

import pandas as pd
from numpy.f2py.crackfortran import param_parse
from tqdm import tqdm

from toolbox.configs import CONFIG
from toolbox.reporting import Report
from toolbox.exceptions import MissingConfiguration, DataError


def process_delimited_input(cols: str | list[str]) -> list[str] | None:
    entry = cols[0]
    if entry == '':
        return None

    cols = entry.split(',')
    return [col.strip() for col in cols if col !='']


def parse_update_parameters(update_data: dict[str, list[str]], cols: list[str]) -> dict[str, list[str]]:

    pass


def parse_read_parameters(parameters: dict[str, Any]):
    values = list(parameters.values())[0]
    if len(parameters)==1 and len(values)>1:
        field = list(parameters.keys())[0]
        placeholder = ', '.join(["LOWER(%s)"]*len(values))
        field_query = f"LOWER({field}) IN ({placeholder})"
        return field_query, tuple(values)

    fields = [f'LOWER({field})=LOWER(%s)' for field in parameters.keys()]
    return " AND ".join(fields), tuple(values)


def get_next_letter(current_letter, restart=False):
    if restart or not current_letter:
        return 'A'

    alphabet = string.ascii_uppercase
    # Find the current position and move to next (modulo 26 ensures Z loops to A)
    current_index = alphabet.index(current_letter.upper())
    next_index = (current_index + 1) % 26

    return alphabet[next_index]


def convert_to_degrees(value, unit: Literal['meters', 'km']='meters') -> float:
    # if not isinstance(value, int) or not isinstance(value, float):
    #     raise ValueError(f"{value} is not numeric value")
    try:
        km_to_deg_scalar: float = CONFIG["KM2DEG"]

        value_degree = value/km_to_deg_scalar
        if unit == 'km':
            return value_degree

        return value_degree/1000
    except KeyError:
        raise MissingConfiguration('Config not found', 'KM2DEG configuration not found')


def generate_output_name(input_file_name: str, ext: str, suffix: str):
    base_names = input_file_name.split('.')[:-1]
    datestamp = datetime.today().strftime("%Y%m%d")
    return f"{'_'.join(base_names)}_{suffix}_{datestamp}.{ext}"

# @atimer
async def save_uploaded_file(upload_file: Any, temp_dir, factor:int =1):
    """Stream the upload to disk without loading entirely into memory"""
    logging.info('Saving to Temporary Folder')
    zip_path = os.path.join(temp_dir, upload_file.filename)
    with open(zip_path, "wb") as f:
        while contents := await upload_file.read((1024*factor) * (1024*factor)):  # 1MB chunks
            f.write(contents)
    return zip_path


def write_in_memory_zip(report: Report, images: dict, *args) -> io.BytesIO:
    """Write Generated Images into a zipped file"""

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'a', zipfile.ZIP_DEFLATED, False) as zipf:
        with tempfile.TemporaryDirectory() as tmp_dir_name:
            report.writer(images, tmp_dir_name, *args)

            for folder_name, subfolders, filenames in os.walk(tmp_dir_name):
                for filename in filenames:
                    file_path = os.path.join(folder_name, filename)
                    zipf.write(file_path, os.path.relpath(file_path, tmp_dir_name))

    zip_buffer.seek(0)

    return zip_buffer


def read_zip_file_in_memory(zip_file: Any) -> pd.DataFrame:
    layers = []
    with zipfile.ZipFile(zip_file.file, 'r') as zipper:
        for path in tqdm(zipper.infolist(), desc='reading zipped files'):
            if path.is_dir():
                continue

            extension = Path(path.filename).suffix
            if extension not in ['.csv', '.xls', '.xlsx']:
                continue

            buffer = zipper.open(path)
            if extension in ['.xls', '.xlsx']:
                sheet_names = pd.ExcelFile(buffer).sheet_names
                dfs = [pd.read_excel(buffer, sheet_name=sheet_name, dtype=str) for sheet_name in sheet_names]
            if extension == '.csv':
                dfs = [pd.read_csv(buffer, dtype=str)]

            layers += dfs

    return pd.concat(layers, ignore_index=True)


def read_zip_file_in_memory_ii(zip_file: Any) -> dict[str, pd.DataFrame]:
    layers = {}
    with zipfile.ZipFile(zip_file.file, 'r') as zipper:
        for path in tqdm(zipper.infolist(), desc='reading zipped files'):
            if path.is_dir():
                continue

            file = Path(path.filename)
            extension = file.suffix
            if extension not in ['.csv', '.xls', '.xlsx']:
                continue

            buffer = zipper.open(path)
            if extension in ['.xls', '.xlsx']:
                sheet_names = pd.ExcelFile(buffer).sheet_names
                df_map = {
                    sheet_name: pd.read_excel(buffer, sheet_name=sheet_name, dtype=str)
                    for sheet_name in sheet_names
                }
            if extension == '.csv':
                df = [pd.read_csv(buffer, dtype=str)]
                df_map = {file: df}

            layers.update(df_map)

    return layers


async def aggregate_validated_data(validated_data_files: Any):
    from toolbox.access import read_mgr
    extension = validated_data_files.filename.split('.')[-1]
    if extension == 'zip':
        dataset = read_zip_file_in_memory(validated_data_files)

    elif extension in ['xls', 'xlsx']:
        sheet_names: list[str] = pd.ExcelFile(validated_data_files).sheet_names
        datasets = [
            await read_mgr.read_dataset(validated_data_files, sheet=sheet_name, is_spatial=False)
            for sheet_name in sheet_names
        ]
        dataset = pd.concat(datasets, ignore_index=True)

    else:
        dataset = await  read_mgr.read_dataset(validated_data_files, False)

    return dataset


async def read_compiled_data(validated_data_files: Any) -> dict[str, pd.DataFrame]:
    extension = validated_data_files.filename.split('.')[-1]

    if extension not in ['zip', 'xls', 'xlsx']:
        raise DataError('unknown data format', 'please provide a zipped or excel workbook')

    if extension == 'zip':
        datasets = read_zip_file_in_memory_ii(validated_data_files)

    else:
        read_data_files = await validated_data_files.read()
        content_io = io.BytesIO(read_data_files)
        # content = content_io.getvalue()
        sheet_names: list[str] = pd.ExcelFile(content_io).sheet_names
        datasets = {
            sheet_name: pd.read_excel(content_io, sheet_name=sheet_name)
            for sheet_name in tqdm(sheet_names)
        }

    return datasets
