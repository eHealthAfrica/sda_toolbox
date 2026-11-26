import logging
import concurrent.futures
from typing import Any
from dataclasses import dataclass, field

import rapidfuzz
import numpy as np
import pandas as pd
from tqdm import tqdm
import geopandas as gpd
import shapely
from pyproj import Geod
from fuzzywuzzy import fuzz
from shapely.geometry.base import BaseGeometry
from shapely.geometry import MultiPolygon
from sqlalchemy import text

from toolbox.mlos.validation.update.standardize import standardize_admin
from toolbox.utils import atimer
from toolbox.utils.offload import run_heavy
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.spatial_mgr import GeomColumns, convert_to_geodata
from toolbox.mlos import AdminColumns, detect_unique_admin_field, construct_new_unique, get_admin_col

THRESHOLD = 95
LGA_THRESHOLD = 90
WARD_THRESHOLD = 98

#TODO: Implement the Consensus and Recommendation Features
# Consensus will be driven by >=60% of sources being in agreement
# Recommendations include: Keep Original, Priority Review, Optional Review (less than 60%), Skippable


@dataclass(frozen=True)
class Response:
    source: str
    unique_code: str
    distance: float
    similarity: float


@dataclass(frozen=True)
class Result:
    response: list[Response]


@dataclass
class ReviewDataSet:
    name: str
    data: gpd.GeoDataFrame
    admin_columns: AdminColumns
    geo_col: GeomColumns
    settlement_col: str | None = None
    _unique_code: str = field(init=False)

    def __post_init__(self):
        unique_code = detect_unique_admin_field(self.data)
        if not unique_code:
            unique_code = 'unique_code'
            self.data = construct_new_unique(self.data, unique_code, self.settlement_col)

        self._unique_code = unique_code
        return self.data

    @property
    def geom_tuple(self) -> tuple:
        return self.data.geometry.x, self.data.geometry.y

    @property
    def unique_code(self):
        return self._unique_code

    @property
    def output_columns(self) -> list[Any]: #noqa
        return [
            self._unique_code,
            self.admin_columns.state,
            self.admin_columns.lga,
            self.admin_columns.ward,
            self.admin_columns.settlement,
            self.geo_col.latitude,
            self.geo_col.longitude
        ]


def create_ward_id(admin: AdminColumns)-> str:
    return f"{admin.state}*{admin.lga}*{admin.ward}"


def ward_keys(data: pd.DataFrame, admin: AdminColumns) -> list[str]:
    """The State*LGA*Ward key of every row, each value written with str() (a blank one as "nan"), like the per-row
    f-string it replaces"""
    return [f"{state}*{lga}*{ward}" for state, lga, ward in zip(data[admin.state], data[admin.lga], data[admin.ward])]


def match_settlement(settlement_codes: list[str], search_name: str, search_codes: list[str]) -> dict[str, dict[str, str | None]] | None:
    """Best match (at or above THRESHOLD) in `search_codes` for every MLoS code, keyed by the search dataset's name"""
    try:
        scores = rapidfuzz.process.cdist(                                                               # noqa
            settlement_codes, search_codes, scorer=rapidfuzz.fuzz.partial_ratio, workers=1)
        best = scores.argmax(axis=1)                    # the first best match, as list.index() picked it before
        best_scores = scores[np.arange(len(settlement_codes)), best]
        search_result: dict[str, str | None] = {
            settlement: (search_codes[index] if score >= THRESHOLD else None)
            for settlement, index, score in zip(settlement_codes, best, best_scores)
        }
        return {search_name: search_result}
    except Exception as e:
        logging.warning(f'Settlement matching against {search_name} failed: {e}')
        return None


def build_ward_index(dataset: ReviewDataSet, ward_ids: list[str]) -> dict[str, np.ndarray]:
    """Row positions of `dataset` that belong to each ward in `ward_ids` (State*LGA*Ward).

    A row belongs to a ward when its ward name scores >= WARD_THRESHOLD and its LGA name >= LGA_THRESHOLD
    (partial_ratio), the rule the review has always used. Each distinct LGA/ward pair in the dataset is scored once
    against every ward, instead of fuzzy-scoring every row of a full copy of the dataset once per ward."""
    data = dataset.data
    if data.empty or not ward_ids:
        return {}

    admin = dataset.admin_columns
    lga_values = data[admin.lga].fillna('').astype(str).to_numpy()
    ward_values = data[admin.ward].fillna('').astype(str).to_numpy()
    groups: dict[tuple[str, str], np.ndarray] = data.groupby([lga_values, ward_values], sort=False).indices
    pairs = list(groups)

    targets = [ward_id.split('*') for ward_id in ward_ids]
    ward_scores = rapidfuzz.process.cdist(                                                               # noqa
        [ward for _, ward in pairs], [ward for _, _, ward in targets], scorer=rapidfuzz.fuzz.partial_ratio, workers=-1)

    lga_scores = rapidfuzz.process.cdist(                                                                # noqa
        [lga for lga, _ in pairs], [lga for _, lga, _ in targets], scorer=rapidfuzz.fuzz.partial_ratio, workers=-1)

    passing = (ward_scores >= WARD_THRESHOLD) & (lga_scores >= LGA_THRESHOLD)

    index: dict[str, np.ndarray] = {}
    for position, ward_id in enumerate(ward_ids):
        hits = np.flatnonzero(passing[:, position])
        if hits.size:
            # Sorted so the rows keep the dataset's order: ties in match_settlement still go to the first row.
            index[ward_id] = np.sort(np.concatenate([groups[pairs[hit]] for hit in hits]))

    return index


def process_ward_level_data(
        ward_id: str, datasets: list[ReviewDataSet], ward_indexes: dict[str, dict[str, np.ndarray]]) -> dict | None:
    """Matches the MLoS settlements of one ward against the same ward's records in every other source"""
    logging.info(f'Cross-Referencing Settlements within {' '.join(ward_id.split("*"))} Administrative Locations')
    mlos: ReviewDataSet = next(ds for ds in datasets if ds.name == 'mlos')
    mlos_rows = ward_indexes['mlos'].get(ward_id)
    if mlos_rows is None:
        return None

    mlos_codes = mlos.data[mlos.unique_code].iloc[mlos_rows].tolist()
    search_results = {}
    for dataset in datasets:
        rows = ward_indexes[dataset.name].get(ward_id) if dataset.name != 'mlos' else None
        if rows is None:
            continue

        search_codes = dataset.data[dataset.unique_code].iloc[rows].tolist()
        output = match_settlement(mlos_codes, dataset.name, search_codes)
        if output:
            search_results.update(output)

    return search_results


def convert_dict_to_df(data: dict, out_col: str)->pd.DataFrame:
    logging.info(f'Converting Identified {out_col} Data to DataFrame')
    df = pd.DataFrame.from_dict(data, orient='index').reset_index(drop=False, names='unique_code').rename(columns={0:out_col})
    return df


def prepare_result(results: list[dict], sources: list[str]) -> pd.DataFrame:

    logging.info('Cleaning Up Results, Converting and Merging to Table')
    print('Cleaning Up Results, Converting and Merging to Table')
    compiled_df = pd.DataFrame()
    for source in sources:
        source_data: list[dict] = [res[source] for res in results if isinstance(res, dict) and source in res.keys()]
        if len(source_data) == 0:
            continue

        base_data = source_data[0]
        other_data = source_data[1:] if len(source_data) > 1 else {}
        for other in other_data:
            base_data.update(other)

        source_df = convert_dict_to_df(base_data, out_col=source)
        if source_df.empty:
            continue

        if compiled_df.empty:
            compiled_df = source_df

        else:
            compiled_df = compiled_df.merge(source_df, on='unique_code')

    return compiled_df


def subset_datasets(places_data: pd.DataFrame, admin: AdminColumns, subset_locations: list) -> pd.DataFrame:
    return places_data.loc[pd.Index(ward_keys(places_data, admin)).isin(subset_locations)]


def retrieve_ward_geometries(states: list[str], places: list[str]) -> tuple[list[tuple[str, MultiPolygon]], gpd.GeoDataFrame]:
    logging.info('Retrieving Ward Boundary Data and Converting to Ward Geometries')
    boundary_data: gpd.GeoDataFrame = ReadDBData(CONFIG['DATASETS']['ward_boundary'], True).read_data({'statename': states})
    admin_info = boundary_data.loc[:, ['statename', 'lganame', 'wardname', 'geometry']].to_records(index=False)
    ward_geometry_map: list[tuple[str, MultiPolygon]] = [(f"{state}*{lga}*{ward}",geometry) for state, lga, ward, geometry in admin_info]
    ward_geometry_map = list(filter(lambda m: m[0] in places, ward_geometry_map))
    return ward_geometry_map, boundary_data


def enrich_dataset(target_data: gpd.GeoDataFrame, source_data: gpd.GeoDataFrame, places: list[str]):
    logging.info('Enriching OSM Data with Administrative information')
    enriched_data = target_data.sjoin(source_data[['wardname', 'lganame', 'statename', 'geometry']], how='left', predicate='intersects', lsuffix="_source")
    added_cols = [col for col in enriched_data.columns if col.__contains__('_source')] + ['index_right']
    enriched_data.drop(added_cols, axis=1, inplace=True)
    # The same State*LGA*Ward key as `places` (it was still built with "_", so no OSM record ever matched a ward).
    enriched_data['ward_id'] = enriched_data['statename'] + '*' + enriched_data['lganame'] + '*' + enriched_data['wardname']
    enriched_data = enriched_data.loc[enriched_data['ward_id'].isin(places)]
    return enriched_data


def read_osm_places(boundary_data: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Named OSM places inside the bounding box of the given ward boundaries.

    The box is applied in PostGIS (osm has a GiST index on its geometry), so only the area under review is read
    instead of the whole national table."""
    reader = ReadDBData(CONFIG['DATASETS']['osm'], True)
    geom_col = reader.geo_col
    min_x, min_y, max_x, max_y = boundary_data.to_crs(4326).total_bounds
    query = text(
        f'SELECT * FROM {reader.db_table} WHERE name IS NOT NULL '
        f'AND {geom_col} && ST_MakeEnvelope(:min_x, :min_y, :max_x, :max_y, 4326)')
    params = {'min_x': float(min_x), 'min_y': float(min_y), 'max_x': float(max_x), 'max_y': float(max_y)}
    try:
        with reader.engine.connect() as conn:
            data: gpd.GeoDataFrame = gpd.read_postgis(sql=query, con=conn, geom_col=geom_col, params=params)
    finally:
        reader.engine.dispose()

    if geom_col != 'geometry':
        data = data.rename_geometry('geometry')

    return data.to_crs(boundary_data.crs) if boundary_data.crs and data.crs else data


def retrieve_osm_data(boundary_data: gpd.GeoDataFrame, places: list[str]) -> ReviewDataSet:
    logging.info('Retrieving OSM Data')
    osm_admin = AdminColumns('statename', 'lganame', 'wardname', 'name')
    try:
        ward_keys = boundary_data['statename'] + '*' + boundary_data['lganame'] + '*' + boundary_data['wardname']
        reviewed_wards = boundary_data.loc[ward_keys.isin(places)]
        osm_place = read_osm_places(reviewed_wards if not reviewed_wards.empty else boundary_data)
        enriched_osm = enrich_dataset(osm_place, boundary_data, places)
        enriched_osm = enriched_osm.loc[enriched_osm['wardname'].notna()]
        enriched_osm['longitude'] = enriched_osm.geometry.x
        enriched_osm['latitude'] = enriched_osm.geometry.y
        osm_geom = GeomColumns('latitude', 'longitude')
        return ReviewDataSet(name="osm", data=enriched_osm, admin_columns=osm_admin, settlement_col='name', geo_col=osm_geom)
    except Exception:
        logging.warning('OSM Data Retrieval Failed. Using Empty Fallback Dataset for OSM')
        data = gpd.GeoDataFrame(columns=['statename', 'lganame', 'wardname', 'name'])
        return ReviewDataSet(
            name='osm', data=data, admin_columns=osm_admin, settlement_col='name', geo_col=GeomColumns('latitude', 'longitude'))


def run_settlement_similarity_check(admin_map: list[tuple[str, MultiPolygon]], datasets: list[ReviewDataSet]) -> pd.DataFrame:
    logging.info('Running Settlement Similarity Check')
    ward_ids = [ward_id for ward_id, _ in admin_map]
    logging.info('Indexing the records of every dataset by ward')
    ward_indexes = {dataset.name: build_ward_index(dataset, ward_ids) for dataset in datasets}

    ward_level_results = []
    # rapidfuzz releases the GIL while it scores, so the threads match wards in parallel (no process pool needed).
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(process_ward_level_data, ward_id, datasets, ward_indexes)
            for ward_id in ward_ids]

        for future in tqdm(concurrent.futures.as_completed(futures), total=len(ward_ids), desc="Processing", unit='wards'):
            result = future.result()
            ward_level_results.append(result)

    logging.info('Similarity Check Completed')
    compiled_df: pd.DataFrame  = prepare_result(ward_level_results, [ds.name for ds in datasets if ds.name!='mlos'])
    return compiled_df


def merge_and_cleanup(settlement_data: gpd.GeoDataFrame, datasets: list[ReviewDataSet]) -> gpd.GeoDataFrame:
    logging.info('Extracting and Merging Settlement Data to Original Settlement Data')
    for dataset in datasets:
        if dataset.name == 'mlos':
            continue

        geom_col = f'geometry_{dataset.name}'
        if dataset.name not in settlement_data.columns:
            # No ward of this source produced a result, so the similarity check left no column for it.
            settlement_data[dataset.name] = None

        # One row per code, and none for blank codes. pandas joins a blank key to every blank key, so each MLoS row
        # with no match used to pick up every blank-coded row of the source, and a repeated code (common in OSM)
        # copied the MLoS row once per repeat. drop_duplicates(keep='first') later kept only the first of those rows,
        # which is the row kept here.
        source = pd.DataFrame({
            dataset.name: dataset.data[dataset.unique_code].to_numpy(dtype=object),
            geom_col: dataset.data.geometry.to_numpy(),
        })
        source = source.loc[source[dataset.name].notna()].drop_duplicates(subset=dataset.name, keep='first')
        settlement_data[dataset.name] = settlement_data[dataset.name].astype(object)
        settlement_data = settlement_data.merge(source, on=dataset.name, how='left')

    return settlement_data


TRACKS_DISTANCE = 0.0027000270      # degrees (about 300 m): how close to a GTS track counts as "near tracks"
GEOD = Geod(ellps='WGS84')          # the same WGS-84 geodesic geopy.distance.geodesic measures


def as_points(geometries: pd.Series) -> np.ndarray:
    """The geometries as a shapely array: a MultiPoint becomes its centroid and anything that is not a geometry None"""
    values = np.array([geom if isinstance(geom, BaseGeometry) else None for geom in geometries], dtype=object)
    multi = shapely.get_type_id(values) == shapely.GeometryType.MULTIPOINT
    if multi.any():
        values[multi] = shapely.centroid(values[multi])

    return values


def spatial_flag(points: np.ndarray, layer: gpd.GeoDataFrame, predicate: str, **kwargs) -> np.ndarray:
    """True/False for each point by whether it meets `predicate` against any feature of `layer`; None if no point.

    Uses the layer's spatial index, so a point is only tested against the features near it. The checks used to test
    every point against one geometry merged from the whole layer, which is slow to build and to test against."""
    result = np.full(len(points), None, dtype=object)
    present = np.flatnonzero(pd.notna(points))
    flags = np.zeros(len(present), dtype=bool)
    # A point with NaN coordinates is False, as the per-point check returned; the index query stops on it.
    queryable = np.flatnonzero(~np.isnan(shapely.get_x(points[present])))
    if len(queryable) and layer is not None and not layer.empty:
        hit_rows, _ = layer.sindex.query(points[present][queryable], predicate=predicate, **kwargs)
        flags[queryable[np.unique(hit_rows)]] = True

    result[present] = flags
    return result


def evaluate_settlements(settlement: gpd.GeoDataFrame, code_col: str, ind_datasets: list[str],
                         tracks_data: gpd.GeoDataFrame, grid3_extent: gpd.GeoDataFrame) -> pd.DataFrame:
    print('Starting Evaluation...')
    logging.info('Starting Evaluation for Intersection with Grid3 and proximity to Tracks...')
    mlos_points = as_points(settlement['geometry'])
    mlos_x, mlos_y = shapely.get_x(mlos_points), shapely.get_y(mlos_points)
    mlos_codes = settlement[code_col].to_numpy(dtype=object)

    for ind_dataset in tqdm(ind_datasets, desc='Evaluating and Expanding Results', unit='datasets'):
        points = as_points(settlement[f'geometry_{ind_dataset}'])
        x, y = shapely.get_x(points), shapely.get_y(points)
        ind_codes = settlement[ind_dataset].to_numpy(dtype=object)
        named = pd.notna(mlos_codes) & pd.notna(ind_codes)        # both names known: similarity and distance apply

        similarity = np.full(len(settlement), np.nan)
        similarity[named] = [fuzz.partial_ratio(a, b) for a, b in zip(mlos_codes[named], ind_codes[named])]
        distance = np.full(len(settlement), np.nan)
        if named.any():
            distance[named] = GEOD.inv(mlos_x[named], mlos_y[named], x[named], y[named])[2]

        settlement[f'{ind_dataset}_similarity'] = similarity
        settlement[f'{ind_dataset}_distance'] = distance
        settlement[f'{ind_dataset}_grid3'] = spatial_flag(points, grid3_extent, 'within')
        settlement[f'{ind_dataset}_near_tracks'] = spatial_flag(points, tracks_data, 'dwithin', distance=TRACKS_DISTANCE)
        settlement[f'{ind_dataset}_latitude'] = y
        settlement[f'{ind_dataset}_longitude'] = x
        settlement.drop(columns=[f'geometry_{ind_dataset}'], inplace=True)

    settlement.drop(columns=['geometry'], inplace=True)
    return settlement


def order_cols(original_cols: list[str], review_sources: list[str]) -> list[str]:
    result_cols = CONFIG['REVIEW_COLS']
    evaluated_cols = []
    for review_source in review_sources:
        eval_cols = list(map(lambda col: f"{review_source}_{col}", result_cols))
        eval_cols = [review_source] + eval_cols
        evaluated_cols.extend(eval_cols)

    return original_cols + evaluated_cols


def extract_places(settlement_data: pd.DataFrame) -> list[str]:

    logging.info('Extracting Unique Ward Location from Settlement Data...')
    admin = AdminColumns.create_by_search(settlement_data)
    return list(dict.fromkeys(ward_keys(settlement_data, admin)))      # unique, in first-seen order


def create_review_datasets(
        source_datasets: dict[str, pd.DataFrame], states: list[str],
        places: list[str], use_osm: bool) -> tuple[list[ReviewDataSet], Any]:

    logging.info(f'Creating Review Datasets from {len(source_datasets)} datasets and {len(states)} states...')
    datasets = []

    for data_name, data in source_datasets.items():
        admin_cols = AdminColumns.create_by_search(data)
        if data_name != 'mlos':
            data = subset_datasets(data, admin_cols, places)

        data = standardize_admin(data, admin_cols)
        geo_cols = GeomColumns.get_geom_cols(data, True)
        geo_data = convert_to_geodata(data, geo_cols)
        dataset: ReviewDataSet = ReviewDataSet(
            name=data_name,
            data=geo_data,
            admin_columns=admin_cols,
            geo_col=geo_cols
        )

        datasets.append(dataset)

    geom_map, boundary_data = retrieve_ward_geometries(states, places)
    if use_osm:
        # OSM is only read when it is wanted: it used to be read and spatially joined on every run.
        logging.info('OSM Data Included')
        datasets.append(retrieve_osm_data(boundary_data, places))

    return datasets, geom_map


def investigate_similarity_response(
        enriched_df: gpd.GeoDataFrame, datasets: list[ReviewDataSet], states: list[str], set_code: str,
        tracks_gdf: gpd.GeoDataFrame, sources: list[str]):

    enriched_settlement = merge_and_cleanup(enriched_df, datasets)
    grid3 = ReadDBData(CONFIG['DATASETS']['grid_3_extent'], True).read_data({'statename': states})
    reviewed_settlement = evaluate_settlements(enriched_settlement, set_code, sources, tracks_gdf, grid3)
    final_settlements = reviewed_settlement.drop_duplicates(subset='unique_code', keep='first')

    return final_settlements


def _review_settlement_coordinates(
        source_datasets: dict[str, pd.DataFrame], settlements: pd.DataFrame, tracks: gpd.GeoDataFrame, include_osm: bool) -> pd.DataFrame:

    analysis_wards = extract_places(settlements)
    source_datasets.update({'mlos': settlements})
    state_col = get_admin_col(settlements, 'state')
    states = settlements[state_col].str.title().unique().tolist()
    datasets, geom_map = create_review_datasets(source_datasets, states, analysis_wards, include_osm)
    sources = [ds.name for ds in datasets if ds.name != 'mlos']
    # A ward is only reviewed if its State_LGA_Ward name is found in the ward boundary layer; say which were not
    # (the DataOps checks report it, see toolbox/dataops/coord_review.py).
    found_wards = {ward_id for ward_id, _ in geom_map}
    unmatched_wards = [ward for ward in analysis_wards if ward not in found_wards]

    compiled = run_settlement_similarity_check(geom_map, datasets)
    settlement_ds: ReviewDataSet = list(filter(lambda ds: ds.name=='mlos', datasets))[0]
    settlements = settlement_ds.data

    updated_settlements = settlements.merge(
        compiled, left_on=settlement_ds.unique_code, right_on=settlement_ds.unique_code, how='left')

    logging.info('Conducting Spatial Evaluation')
    reviewed_settlements = investigate_similarity_response(
        updated_settlements, datasets, states, settlement_ds.unique_code, tracks, sources)

    ordered_columns = order_cols(settlement_ds.output_columns, sources)
    ordered_columns = [col for col in ordered_columns if col in reviewed_settlements.columns]
    reviewed_settlements = reviewed_settlements.loc[:, ordered_columns]
    reviewed_settlements.attrs['ward_coverage'] = {'wards': len(analysis_wards), 'unmatched': unmatched_wards}

    return reviewed_settlements


@atimer(display=True)
async def review_settlement_coordinates(
        source_datasets: dict[str, pd.DataFrame], settlements: pd.DataFrame, tracks: gpd.GeoDataFrame, include_osm: bool) -> pd.DataFrame:
    # Matching every settlement against every source (and OSM) is minutes of work: run it in a worker thread (hardening H7).
    return await run_heavy(_review_settlement_coordinates, source_datasets, settlements, tracks, include_osm)



if __name__ == '__main__':
    import openpyxl
    import asyncio
    folder = 'C:\\Workspace\\NEOC\\NIPDs\\NOV ROUND\\Analysis'
    baseline_settlement_file = f"{folder}\\20261023_Final Settlements List for November 2026 Campaign_v9.csv"
    baseline_df = pd.read_csv(baseline_settlement_file)
    # cols = ['unique_code', 'STATE', 'LGA', 'WARD', 'SETTLEMENTS', 'LATITUDE', 'LONGITUDE']
    baseline_df = baseline_df.loc[baseline_df['State'].str.lower()=='kaduna']
    tracks_data = gpd.read_file(f"{folder}\\GIS\\Tracks.gpkg")
    previous_camp_file = fr"{folder}\Submissions\November 2026 NIPDs Campaign Submission v3.xlsx"
    rounds = openpyxl.load_workbook(previous_camp_file).sheetnames
    campaign_datasets: dict[str, pd.DataFrame] = {}
    for camp_round in tqdm(rounds, desc='Reading Datasets', total=len(rounds)):
        df = pd.read_excel(previous_camp_file, sheet_name=camp_round)
        campaign_datasets[camp_round] = df

    output = asyncio.run(
        review_settlement_coordinates(campaign_datasets, baseline_df, tracks_data, False)
    )
    output.to_csv(r'C:\Workspace\MLoS\validation\DUplicate.csv', index=False)
#
