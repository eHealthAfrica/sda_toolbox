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


def parse_read_parameters_ii(parameters: dict[str, Any]):
    queries = []
    values = {}
    for field, value in parameters.items():
        placeholder = field.split('_')[0][:3]
        # value_map = f"({placeholder})" if len(value_ls)>1 else placeholder
        field_query = f"{field} = ANY(:{placeholder})"
        queries.append(field_query)
        values[placeholder] = value if isinstance(value, list) else [value]

    final_queries = " AND ".join(queries)
    return final_queries, values


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


def generate_output_name(input_file_name: str, ext: str, suffix: str=None):
    base_names = input_file_name.split('.')[:-1]
    datestamp = datetime.today().strftime("%Y%m%d")
    # names = list(filter(lambda x: x is not None, [base_names, suffix, datestamp]))
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


def write_in_memory_zip(report: Report, images: dict, **kwargs) -> io.BytesIO:
    """Write Generated Images into a zipped file"""

    zip_buffer = io.BytesIO()
    # allowZip64 was hardcoded False here while the outer h2h zip
    # (toolbox/apps/tracking/h2h_validation.py) that this nested reports.zip
    # gets embedded into uses allowZip64=True — the inconsistency is a real
    # bug, not a deliberate size cap: with allowZip64 off, zipfile falls back
    # to 32-bit size/offset fields, and depending on how many report images
    # get written (a chart per LGA/ward — see DailyReport.generate_report),
    # this archive can legitimately need 64-bit fields. A local/small run may
    # never hit that ceiling, but nothing about this zip is actually meant to
    # be capped at 4GB / 65535 entries. Matches the outer zip's True.
    with zipfile.ZipFile(zip_buffer, 'a', zipfile.ZIP_DEFLATED, True) as zipf:
        with tempfile.TemporaryDirectory() as tmp_dir_name:
            report.writer(images, tmp_dir_name, **kwargs)

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


def is_uuid4(series: pd.Series) -> bool:
    uuid4 = CONFIG['REGEX']['UUID4']
    regex_pattern = rf"{uuid4}"
    check = series.str.match(regex_pattern)
    if not check.any():
        return False

    check_met = check.shape[0]
    ratio = check_met / len(series)

    return ratio >= 0.6


def detect_settlement_id_field(df: pd.DataFrame):
    str_cols = [col for col in df.columns if df[col].dtype == "str"]
    for col in str_cols:
        if not is_uuid4(df[col]):
            continue

        return col

    return None


def get_visitation_col(df: pd.DataFrame):
    def review() -> str | None:
        cols_idx = {}
        cols = df.columns.tolist()
        for idx, col in enumerate(cols):
            if df[col].dtype.name != 'str':
                continue

            if pd.isna(df[col]).any():
                continue

            col_values: list[str] = df[col].unique().tolist()
            if any([value.title() not in ['Visited', 'Not Yet Visited', 'Not Visited'] for value in col_values]):
                continue

            cols_idx[col] = idx

        return max(cols_idx, key=cols_idx.get) if cols_idx else None

    return review()
