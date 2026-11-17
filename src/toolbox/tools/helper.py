import io
import os
import re
import sqlite3
import string
import zipfile
import tempfile
import logging
from pathlib import Path
from typing import Literal, Any, Callable, Iterable
from datetime import datetime
from functools import wraps

import pandas as pd
from tqdm import tqdm
from starlette.concurrency import run_in_threadpool

from toolbox.models.db import Availability, Reasons, UUIDResponse, UUIDResponses
from toolbox.tools import is_empty
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
    filename = upload_file.filename if hasattr(upload_file, 'filename') else os.path.basename(upload_file)
    zip_path = os.path.join(temp_dir, filename)
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


def _read_workbook_sheets(content: bytes, filename: str) -> dict[str, pd.DataFrame]:
    """Every sheet of an Excel workbook as a DataFrame (blocking pandas work, run in a worker thread)."""
    content_io = io.BytesIO(content)
    sheet_names: list[str] = pd.ExcelFile(content_io).sheet_names
    return {
        sheet_name: pd.read_excel(content_io, sheet_name=sheet_name)
        for sheet_name in tqdm(sheet_names, desc=f'Reading {filename}')
    }


async def read_compiled_data(validated_data_files: Any) -> dict[str, pd.DataFrame]:
    extension = validated_data_files.filename.split('.')[-1]

    if extension not in ['zip', 'xls', 'xlsx']:
        raise DataError('unknown data format', 'please provide a zipped or excel workbook')

    if extension == 'zip':
        datasets = await run_in_threadpool(read_zip_file_in_memory_ii, validated_data_files)

    else:
        read_data_files = await validated_data_files.read()
        datasets = await run_in_threadpool(_read_workbook_sheets, read_data_files, validated_data_files.filename)

    return datasets


def value_is_uuid4(value: str | None):
    if is_empty(value):
        return False

    uuid4 = CONFIG['REGEX']['UUID4']
    regex_pattern = rf"{uuid4}"
    check = re.match(regex_pattern, value)
    if not check:
        return False

    return bool(check)


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

CACHE_TABLE = 'uuid_reserve'
UUID_CACHE_DB = '.\\data\\uuid_cache.db'


def _open_uuid_cache() -> sqlite3.Connection:
    """Open the UUID reservation database, creating the table on first use.

    `created_at` is filled in by SQLite when a row is inserted (CURRENT_TIMESTAMP, in UTC)."""
    db = sqlite3.connect(UUID_CACHE_DB)
    db.execute(
        f"CREATE TABLE IF NOT EXISTS {CACHE_TABLE} ("
        "uuid TEXT PRIMARY KEY, "
        "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    return db


# SQLite caps how many `?` one statement may carry (999 on older builds), so lookups go in chunks.
_LOOKUP_CHUNK = 500


def search_uuid_cache_many(uuids: Iterable[str]) -> set[str]:
    """The subset of `uuids` that is reserved. One connection and a few `IN (...)` queries, however many are asked."""
    wanted = list(dict.fromkeys(uuids))
    if not wanted:
        return set()
    db = _open_uuid_cache()
    try:
        found: set[str] = set()
        for i in range(0, len(wanted), _LOOKUP_CHUNK):
            chunk = wanted[i:i + _LOOKUP_CHUNK]
            marks = ', '.join('?' * len(chunk))
            found.update(row[0] for row in db.execute(f"SELECT uuid FROM {CACHE_TABLE} WHERE uuid IN ({marks})", chunk))
        return found
    finally:
        db.close()


def search_uuid_cache(uuid: str) -> bool:
    return uuid in search_uuid_cache_many([uuid])


def reserve_uuids(uuids: Iterable[str]) -> set[str]:
    """Reserve each UUID and return the ones this call reserved.

    A UUID somebody else reserved first (another request, even a moment ago) is left out of the answer. The
    check and the insert are one statement (`INSERT OR IGNORE` on the primary key), so two requests for the same
    new UUID cannot both win. A UUID repeated within `uuids` is reserved once."""
    mine: set[str] = set()
    db = _open_uuid_cache()
    try:
        with db:  # one transaction: commits on success, rolls back on error
            for uuid in dict.fromkeys(uuids):
                if db.execute(f"INSERT OR IGNORE INTO {CACHE_TABLE} (uuid) VALUES (?)", (uuid,)).rowcount == 1:
                    mine.add(uuid)
    finally:
        db.close()
    return mine


def uuid_cache(func: Callable[..., UUIDResponse | UUIDResponses]):
    """Reserve every UUID the wrapped endpoint reports Available, so it is not handed out twice.

    Works on a single UUIDResponse and on UUIDResponses. If another request reserved one of them first, it is
    changed to Not Available / Reserved instead of being reported Available twice."""
    @wraps(func)
    async def wrapper(*args, **kwargs):
        result = await func(*args, **kwargs)
        responses = result.response if isinstance(result, UUIDResponses) else [result]
        available = [r for r in responses if r.is_available == Availability.AVAILABLE]
        if not available:
            return result

        reserved = await run_in_threadpool(reserve_uuids, [str(r.uuid) for r in available])
        for response in available:
            if str(response.uuid) not in reserved:
                response.is_available = Availability.NOT_AVAILABLE
                response.reason = Reasons.RESERVED

        return result

    return wrapper


def clear_uuid_cache() -> int:
    """Delete every reserved UUID. Returns how many were removed.

    For use once a new MLoS version has been loaded: the reserved UUIDs are in it by then, so
    the settlements check finds them and the reservations are no longer needed."""
    db = _open_uuid_cache()
    try:
        with db:  # commits on success, rolls back on error
            return db.execute(f"DELETE FROM {CACHE_TABLE}").rowcount
    finally:
        db.close()
