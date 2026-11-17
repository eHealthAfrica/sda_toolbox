import os
import math
import shutil
import sqlite3
import logging
import tempfile
from datetime import date, datetime
from uuid import UUID
from dataclasses import dataclass, field
from functools import cached_property

import numpy as np
import pandas as pd
import geopandas as gpd
from fastapi import UploadFile, BackgroundTasks
from starlette.concurrency import run_in_threadpool

from toolbox.configs import CONFIG
from toolbox.access.read_mgr import read_dataset
from toolbox.access import ReadDBData
from toolbox.exceptions import InvalidInputError
from toolbox.mlos.planfeld.checkout_mgr.tools import enrich_admin_codes, get_updated_records
from toolbox.mlos.validation.review.run_validate import run_settlements_qc
from toolbox.mlos.planfeld.checkout_mgr.prep import validate_settlements_takeoff_points, populate_editors
from toolbox.mlos.validation.review.summarize import categorize_flags, major_flag_check
from toolbox.mlos import detect_unique_admin_field, construct_new_unique, get_admin_col
from toolbox.mlos.planfeld.checkout_mgr.tools import update_settlements

SPATIALITE_DIR = r"C:\mod_spatialite"

logger = logging.getLogger(__name__)

@dataclass
class Checkout:
    checkout_file: UploadFile | str
    _settlement_table: str = field(init=False)
    _takeoff_table : str = field(init=False)

    @cached_property
    async def settlements_data(self):
        data =  await read_dataset(self.checkout_file, True, self.settlement_table)
        return data

    @cached_property
    async def takeoff_data(self):
        data =  await read_dataset(self.checkout_file, True, self.takeoff_table)
        return data

    @property
    def settlement_table(self):
        data_config: dict = CONFIG['DATASETS']
        table = data_config['db_settlements']
        self._settlement_table = table
        return self._settlement_table

    @property
    def takeoff_table(self):
        data_config: dict = CONFIG['DATASETS']
        table_name = data_config['db_takeoff_points']
        self._takeoff_table = table_name
        return self._takeoff_table



def cleanup_file(path: str):
  """Removes temporary file after the response is sent."""
  if os.path.exists(path):
    os.remove(path)


def load_spatialite_extension(conn: sqlite3.Connection):
  """Ensures SpatiaLite extension is properly loaded into the SQLite connection."""
  conn.enable_load_extension(True)

  # Explicit DLL paths on Windows
  dll_dirs = [
      r"C:\mod_spatialite",
      os.path.join(os.path.dirname(sqlite3.__file__), "DLLs"),
  ]
  for d in dll_dirs:
    if os.path.exists(d):
      try:
        os.add_dll_directory(d)
      except AttributeError:
        pass
      os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")

  extensions = ["mod_spatialite", "mod_spatialite.dll", "libspatialite.so"]
  loaded = False
  for ext in extensions:
    try:
      conn.load_extension(ext)
      loaded = True
      break
    except sqlite3.OperationalError:
      continue

  if not loaded:
    raise RuntimeError(
        "Could not load mod_spatialite. Ensure SpatiaLite DLLs/so files are"
        " installed and added to PATH."
    )

  conn.enable_load_extension(False)

  # Check that SpatiaLite's SQL functions are registered. (HasGeoSpa() is not a SpatiaLite function.)
  try:
    conn.execute("SELECT spatialite_version()").fetchone()
  except sqlite3.OperationalError as err:
    raise RuntimeError(
        "mod_spatialite loaded but its SQL functions are not available (spatialite_version() failed)."
        " The SpatiaLite build may not match this SQLite."
    ) from err


# Writes go through the checkout's settlements VIEW only (CONFIG DATASETS 'db_settlements'). In a versioned
# checkout the view is the editable face of the history table: its INSTEAD OF triggers turn an UPDATE, INSERT
# or DELETE on the view into the right versioned change. The base table is never touched from here.
DEFAULT_SRID = 4326
GUID = 'eha_guid'
GEOM_WKT = 'geom'


def quote(name: str) -> str:
  """An identifier safe to put in SQL."""
  return '"' + str(name).replace('"', '""') + '"'


def to_sql_value(value):
    """A value sqlite3 accepts: NaN/NaT/None become NULL; numpy, UUID and timestamp values become plain Python ones."""
    if value is None or value is pd.NaT:
        return None
    if isinstance(value, float):
        return None if math.isnan(value) else value
    if isinstance(value, (bool, int, str, bytes)):
        return value
    if isinstance(value, np.datetime64):
        return None if np.isnat(value) else pd.Timestamp(value).isoformat(sep=' ')
    if isinstance(value, np.generic):
        return to_sql_value(value.item())
    if isinstance(value, datetime):  # includes pd.Timestamp
        return value.isoformat(sep=' ')
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return str(value)


# Names a geometry column is commonly given, used when the database does not say which column it is.
GEOMETRY_COLUMN_NAMES = ('geometry', 'geom', 'the_geom', 'shape', 'wkb_geometry')


def _to_wkt(value) -> str | None:
    """WKT text for a shapely geometry (or WKT text already); None for empty or missing."""
    if hasattr(value, 'wkt'):
        return None if getattr(value, 'is_empty', False) else value.wkt
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def records_geometry_column(records: pd.DataFrame) -> str | None:
    """The column of the records that holds the geometry: the GeoDataFrame's active geometry; failing that (it is
    lost by merges and concats) a column called geometry; failing that any column holding shapely geometries."""
    active = getattr(records, 'geometry', None)
    name = getattr(active, 'name', None)
    if name in records.columns:
        return name
    for col in records.columns:
        first = records[col].dropna().head(1)
        if len(first) and hasattr(first.iloc[0], 'wkt'):
            return col
    return None


def split_geometry(records: pd.DataFrame) -> tuple[pd.DataFrame, str | None]:
    """The records without their geometry column, plus a 'geom_wkt' text column; and the geometry column's name."""
    frame = pd.DataFrame(records.copy())
    geom_col = records_geometry_column(records)
    if geom_col is None:
        return frame, None

    wkt = frame[geom_col].apply(_to_wkt)
    frame = frame.drop(columns=[geom_col])
    frame[GEOM_WKT] = wkt
    return frame, geom_col


def view_geometry_column(conn: sqlite3.Connection, table: str, available: dict[str, str]) -> str | None:
    """The geometry column of the table or view, whatever it is called there ('geom', 'geometry', ...).

    The records read from the checkout always call it 'geometry', so the name in the database cannot be taken from
    them. SpatiaLite's metadata tables say which column it is; failing that, the usual names are tried.
    """
    for sql in (
            'SELECT f_geometry_column FROM views_geometry_columns WHERE lower(view_name) = lower(?)',
            'SELECT f_geometry_column FROM geometry_columns WHERE lower(f_table_name) = lower(?)'):
        try:
            for (name,) in conn.execute(sql, (table,)).fetchall():
                if name and name.lower() in available:
                    return available[name.lower()]
        except sqlite3.OperationalError:
            continue  # no such metadata table
    for name in GEOMETRY_COLUMN_NAMES:
        if name in available:
            return available[name]
    return None


def srid_of(records) -> int:
    crs = getattr(records, 'crs', None)
    epsg = crs.to_epsg() if crs is not None else None
    return int(epsg) if epsg else DEFAULT_SRID


def table_columns(conn: sqlite3.Connection, table: str) -> dict[str, str]:
    """The columns of the table or view, as {lower-case name: name as stored}."""
    rows = conn.execute(f'PRAGMA table_info({quote(table)})').fetchall()
    if not rows:
        raise InvalidInputError(
        'Invalid Checkout', f"The checkout database has no table or view named '{table}'.")
    columns = {row[1].lower(): row[1] for row in rows}
    if GUID not in columns:
        raise InvalidInputError('Invalid Checkout', f"'{table}' in the checkout has no '{GUID}' column.")
    return columns


def stage(conn: sqlite3.Connection, name: str, frame: pd.DataFrame) -> None:
    """Copy a frame into a TEMP table (in the connection's temp database, never in the checkout file)."""
    columns = list(frame.columns)
    conn.execute(f'DROP TABLE IF EXISTS temp.{quote(name)}')
    conn.execute(f'CREATE TEMP TABLE {quote(name)} ({", ".join(quote(c) for c in columns)})')
    rows = ([to_sql_value(v) for v in row] for row in frame.itertuples(index=False, name=None))
    conn.executemany(
      f'INSERT INTO temp.{quote(name)} VALUES ({",".join("?" * len(columns))})', rows)


def prepare_records(records: pd.DataFrame, what: str) -> tuple[pd.DataFrame, str | None, int]:
    """Staging-ready records: one row per eha_guid, no missing GUIDs. Returns (frame, geometry column, srid)."""
    if GUID not in records.columns:
        raise InvalidInputError('Missing Column', f"The {what} have no '{GUID}' column.")
    srid = srid_of(records)
    frame, geom_col = split_geometry(records)

    if frame[GUID].isna().any():
        raise InvalidInputError(
        'Missing Column', f"{int(frame[GUID].isna().sum())} of the {what} have no '{GUID}'.")

    duplicated = frame[GUID].duplicated(keep='last')
    if duplicated.any():
        logger.warning('%d of the %s repeat an %s; keeping the last of each', int(duplicated.sum()), what, GUID)

    frame = frame[~duplicated]
    return frame, geom_col, srid


def writable_columns(frame: pd.DataFrame, available: dict[str, str], what: str) -> list[tuple[str, str]]:
    """[(staging column, column in the view)] for the columns the view has; the rest are logged and skipped."""

    pairs, skipped = [], []
    for col in frame.columns:
        if col in (GUID, GEOM_WKT):
            continue
        (pairs if col.lower() in available else skipped).append(col)
    if skipped:
        logger.warning('%s: columns not in the checkout view were skipped: %s', what, ', '.join(map(str, skipped)))

    return [(col, available[col.lower()]) for col in pairs]


def update_existing_records(conn: sqlite3.Connection, table: str, records: pd.DataFrame) -> int:
    """Update the view's rows that have the same eha_guid. Returns how many staged records matched a row."""
    if records is None or len(records) == 0:
        return 0

    available = table_columns(conn, table)
    frame, geom_col, srid = prepare_records(records, 'updated records')
    geom_target = view_geometry_column(conn, table, available)
    attributes = [
        (col, target) for col, target in writable_columns(frame, available, 'update') if target != geom_target]
    assignments = [f'{quote(target)} = s.{quote(col)}' for col, target in attributes]
    if geom_col and geom_target:
        # A record with no geometry keeps the one it has; it never blanks it.
        # The view's own column is qualified with its name: the staging column (GEOM_WKT) may be called the same.
        assignments.append(
            f'{quote(geom_target)} = COALESCE(ST_GeomFromText(s.{GEOM_WKT}, {srid}), '
            f'{quote(table)}.{quote(geom_target)})')
    elif geom_col:
        logger.warning('update: %s has no geometry column, so the geometry was not updated', table)
        frame = frame.drop(columns=[GEOM_WKT])
    if not assignments:
        logger.warning('update: none of the columns exist in %s; nothing to update', table)
        return 0

    stage(conn, 'temp_staging_update', frame)
    view = quote(table)
    matched = conn.execute(
      f'SELECT COUNT(*) FROM temp.temp_staging_update AS s '
      f'WHERE EXISTS (SELECT 1 FROM {view} AS v WHERE v.{GUID} = s.{GUID})').fetchone()[0]

    conn.execute(
      f'UPDATE {view} SET {", ".join(assignments)} FROM temp.temp_staging_update AS s '
      f'WHERE {view}.{GUID} = s.{GUID}')
    conn.execute('DROP TABLE temp.temp_staging_update')
    if matched < len(frame):
        logger.warning('update: %d of %d records have no row in %s and were not updated',
                   len(frame) - matched, len(frame), table)
    return matched


def insert_new_records(conn: sqlite3.Connection, table: str, new_records: pd.DataFrame) -> int:
    """Insert records whose eha_guid is not in the view yet. Returns how many were added.

    A record whose eha_guid is already there is skipped, not duplicated. After the insert every staged GUID must
    be visible through the view; if not, the view is refusing inserts and the whole change is rolled back.
    """
    if new_records is None or len(new_records) == 0:
        return 0

    available = table_columns(conn, table)
    frame, geom_col, srid = prepare_records(new_records, 'new records')
    geom_target = view_geometry_column(conn, table, available)
    pairs = [(GUID, available[GUID])] + [
        (col, target) for col, target in writable_columns(frame, available, 'insert') if target != geom_target]
    targets = [target for _, target in pairs]
    values = [f's.{quote(col)}' for col, _ in pairs]
    if geom_col and geom_target:
        targets.append(geom_target)
        values.append(f'ST_GeomFromText(s.{GEOM_WKT}, {srid})')
    elif geom_col:
        logger.warning('insert: %s has no geometry column, so the new records were added without geometry', table)

    stage(conn, 'temp_staging_new', frame)
    view = quote(table)
    missing = (f'SELECT COUNT(*) FROM temp.temp_staging_new AS s '
             f'WHERE NOT EXISTS (SELECT 1 FROM {view} AS v WHERE v.{GUID} = s.{GUID})')

    expected = conn.execute(missing).fetchone()[0]
    conn.execute(
        f'INSERT INTO {view} ({", ".join(quote(t) for t in targets)}) '
        f'SELECT {", ".join(values)} FROM temp.temp_staging_new AS s '
        f'WHERE NOT EXISTS (SELECT 1 FROM {view} AS v WHERE v.{GUID} = s.{GUID})')

    still_missing = conn.execute(missing).fetchone()[0]
    conn.execute('DROP TABLE temp.temp_staging_new')
    if still_missing:
        raise RuntimeError(
        f"{still_missing} new records were not added: '{table}' accepted the INSERT but they are not in it. "
        'The view may have no INSTEAD OF INSERT trigger. Nothing was saved.')
    if expected < len(frame):
        logger.warning('insert: %d of %d records were already in %s and were skipped',
                   len(frame) - expected, len(frame), table)
    return expected


def delete_dropped_records(conn: sqlite3.Connection, table: str, drop_ids: list[str] | None) -> int:
  """Delete the view's rows with these eha_guids, however many there are. Returns how many were removed."""
  ids = list(dict.fromkeys(str(i) for i in (drop_ids or []) if i is not None and not pd.isna(i)))
  if not ids:
    return 0

  table_columns(conn, table)
  stage(conn, 'temp_drop_ids', pd.DataFrame({GUID: ids}))
  view = quote(table)
  in_drop = f'{GUID} IN (SELECT {GUID} FROM temp.temp_drop_ids)'
  expected = conn.execute(f'SELECT COUNT(*) FROM {view} WHERE {in_drop}').fetchone()[0]
  conn.execute(f'DELETE FROM {view} WHERE {in_drop}')
  remaining = conn.execute(f'SELECT COUNT(*) FROM {view} WHERE {in_drop}').fetchone()[0]
  conn.execute('DROP TABLE temp.temp_drop_ids')
  if remaining:
    raise RuntimeError(
        f"{remaining} records were not deleted: '{table}' accepted the DELETE but they are still in it. "
        'The view may have no INSTEAD OF DELETE trigger. Nothing was saved.')
  if expected < len(ids):
    logger.warning('delete: %d of %d ids were not in %s', len(ids) - expected, len(ids), table)
  return expected


def count_rows(conn: sqlite3.Connection, table: str) -> int | None:
    """How many rows the table or view has; None when it cannot be counted (e.g. it does not exist)."""
    try:
        return int(conn.execute(f'SELECT COUNT(*) FROM {quote(table)}').fetchone()[0])
    except sqlite3.OperationalError:
        return None


def apply_checkout_changes(
    db_path: str, table: str, changed_records: pd.DataFrame | None,
    new_records: pd.DataFrame | None, drop_ids: list[str] | None,
    takeoff_table: str | None = None) -> dict[str, int]:
    """Update, insert and delete in one transaction: either all of it is saved or none of it. Blocking.

    Returns {'updated', 'inserted', 'deleted'}. With `takeoff_table` it also counts what the checkout holds after
    the change: 'settlements_after' (rows in `table`) and 'takeoff_checkout' (rows in `takeoff_table`).
    """
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        load_spatialite_extension(conn)
        conn.execute('BEGIN')
        counts = {
            'updated': update_existing_records(conn, table, changed_records),
            'inserted': insert_new_records(conn, table, new_records),
            'deleted': delete_dropped_records(conn, table, drop_ids),
        }
        if takeoff_table:
            counts['settlements_after'] = count_rows(conn, table)
            counts['takeoff_checkout'] = count_rows(conn, takeoff_table)
        conn.commit()
        logger.info('Checkout %s: %s', os.path.basename(db_path), counts)
        return counts
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()


def copy_upload(file_obj) -> str:
    """Copy an uploaded checkout to a temporary .sqlite file and return its path. Blocking."""
    try:
        file_obj.seek(0)  # the upload may already have been read once (to load its tables)
    except (AttributeError, OSError):
        pass
    with tempfile.NamedTemporaryFile(delete=False, suffix='.sqlite') as tmp:
        try:
            shutil.copyfileobj(file_obj, tmp)
        except BaseException:
            tmp.close()
            cleanup_file(tmp.name)
            raise

    return tmp.name


async def apply_mlos_checkout(
    checkout, updated_db_data: gpd.GeoDataFrame, drop_ids: list[str] | None = None,
    background_tasks: BackgroundTasks | None = None, new_records: gpd.GeoDataFrame | None = None,
    with_totals: bool = False) -> tuple[str, dict[str, int]]:
    """Apply the MLoS changes to the checkout's settlements view: update `updated_db_data`, insert `new_records`,
    delete `drop_ids`, all in one transaction. Returns the path of the changed database and the counts from
    apply_checkout_changes (with `with_totals`, also what the checkout holds afterwards).

    A checkout given as a path is changed in place. An uploaded checkout is copied first and the copy is changed;
    pass `background_tasks` to have that copy removed once the response is sent.
    """
    is_upload = hasattr(checkout.checkout_file, 'file')
    if is_upload:
        db_path = await run_in_threadpool(copy_upload, checkout.checkout_file.file)
    else:
        db_path = checkout.checkout_file

    try:
        counts = await run_in_threadpool(
            apply_checkout_changes, db_path, checkout.settlement_table, updated_db_data, new_records, drop_ids,
            checkout.takeoff_table if with_totals else None)
    except BaseException:
        if is_upload:
            cleanup_file(db_path)
        raise

    if is_upload and background_tasks:
        background_tasks.add_task(cleanup_file, db_path)
    return db_path, counts


async def update_mlos_checkout(
    checkout, updated_db_data: gpd.GeoDataFrame, drop_ids: list[str] | None = None,
    background_tasks: BackgroundTasks | None = None, new_records: gpd.GeoDataFrame | None = None) -> str:
    """apply_mlos_checkout, returning only the path of the changed database."""
    db_path, _ = await apply_mlos_checkout(checkout, updated_db_data, drop_ids, background_tasks, new_records)
    return db_path


async def update_takeoff_checkout(checkout: UploadFile, new_takeoff: gpd.GeoDataFrame):
    ...


@dataclass
class CheckoutSyncResult:
    """The updated database and the numbers the Checkout page shows (served in the X-Checkout-Summary header)."""
    path: str
    summary: dict[str, int | None]


def count_takeoff_points(mlos: pd.DataFrame) -> int | None:
    """How many distinct takeoff points the MLoS uses (by code when it has one, else by ward and name)."""
    if 'takeoffpoint_code' in mlos.columns:
        return int(mlos['takeoffpoint_code'].dropna().nunique())
    if 'takeoffpoint' in mlos.columns:
        subset = [col for col in ('ward_code', 'takeoffpoint') if col in mlos.columns]
        return int(len(mlos.dropna(subset=['takeoffpoint']).drop_duplicates(subset=subset)))
    return None


async def synchronize_checkout_datasets(
        settlements: pd.DataFrame, checkout_datasets: Checkout, new_takeoff_points: gpd.GeoDataFrame,
        background_tasks: BackgroundTasks | None = None) -> CheckoutSyncResult:
    """Update the checkout with the MLoS; returns the path of the updated database and a summary of the change.

    An uploaded checkout is copied and the copy is changed; pass `background_tasks` so the copy is removed once
    the response that serves it has been sent.
    """

    mlos_settlements = len(settlements)
    unique_code: str | None = detect_unique_admin_field(settlements)
    if not unique_code:
        unique_code: str = 'unique_code'
        settlements = construct_new_unique(settlements, unique_code)

    state_col = get_admin_col(settlements, 'state')
    states = settlements[state_col].unique().tolist()
    settlement_qc_ed = settlements.copy() #await run_settlements_qc(settlements, unique_code,True, False)
    # settlement_qc_ed = categorize_flags(settlement_qc_ed)
    # major_flags = major_flag_check(settlement_qc_ed)
    # if major_flags:
    #     print("Major QC Flags were Identified in Settlements Data")
    #     return settlement_qc_ed

    ward_boundary = ReadDBData('wards', True).read_data({'statename': states})
    enriched_settlements: pd.DataFrame = enrich_admin_codes(settlement_qc_ed, ward_boundary)
    db_settlement = await checkout_datasets.settlements_data
    updated_mlos = validate_settlements_takeoff_points(db_settlement, enriched_settlements)
    if 'indicator' in updated_mlos.columns and pd.notna(updated_mlos['indicator']).any() and new_takeoff_points.empty:
        raise InvalidInputError(
            'Missing Parameter',
            'There are new Takeoff Points in the MLoS and No New Takeoff Points was provided'
        )

    updated_db_data, drop_uuids = update_settlements(db_settlement, updated_mlos)
    updated_db_data = populate_editors(updated_db_data, states)
    changed_records, new_records = get_updated_records(db_settlement, updated_db_data)
    path, counts = await apply_mlos_checkout(
        checkout=checkout_datasets, updated_db_data=changed_records, new_records=new_records,
        drop_ids=drop_uuids, background_tasks=background_tasks, with_totals=True)
    return CheckoutSyncResult(path=path, summary={
        'updated': counts['updated'],
        'added': counts['inserted'],
        'removed': counts['deleted'],
        'settlements_mlos': mlos_settlements,
        'settlements_checkout': len(db_settlement),
        'settlements_after': counts.get('settlements_after'),
        'takeoff_mlos': count_takeoff_points(updated_mlos),
        'takeoff_checkout': counts.get('takeoff_checkout'),
    })



if __name__ == '__main__':
    import asyncio
    db = "C:\\Workspace\\MLoS\\PLANFELD\\ke_mlos_checkout_06102026 - Copy.sqlite"
    mlos = pd.read_csv(r"C:\\Workspace\\MLoS\\validation\\V13\\Kebbi_MLoS_v13.0.csv")
    # db_settlement = asyncio.run(read_dataset(db, True, data_config['db_settlements']))
    # db_takeoff = asyncio.run(read_dataset(db, True, data_config['db_takeoff_points']))

    checkout: Checkout = Checkout(db)

    asyncio.run(
        synchronize_checkout_datasets(mlos, checkout, gpd.GeoDataFrame())
    )
