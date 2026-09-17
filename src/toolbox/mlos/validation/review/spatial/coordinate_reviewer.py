import logging
import multiprocessing
import concurrent.futures
from functools import partial
from typing import Literal, Any
from dataclasses import dataclass, field

import rapidfuzz
import numpy as np
import pandas as pd
from tqdm import tqdm
import geopandas as gpd
from fuzzywuzzy import fuzz
from geopy.distance import geodesic
from shapely.geometry.base import BaseGeometry
from shapely.geometry import MultiPolygon, Point, MultiPoint

from toolbox.utils import atimer
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.spatial_mgr import GeomColumns, convert_to_geodata
from toolbox.mlos import AdminColumns, detect_unique_admin_field, construct_new_unique, get_admin_col

THRESHOLD = 95
LGA_THRESHOLD = 90
WARD_THRESHOLD = 98


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
    return f"{admin.state}_{admin.lga}_{admin.ward}"


def match_settlement(settlement_codes: list[str], search_dataset: ReviewDataSet) -> dict[str, dict[str, str|None]] | None:
    try:
        search_result: dict[str, str | None] = {}

        search_data: list[str] = search_dataset.data[search_dataset.unique_code].tolist()
        results_array: list[list[int]] = rapidfuzz.process.cdist(                                       # noqa
            settlement_codes, search_data, scorer=rapidfuzz.fuzz.partial_ratio, workers=6).tolist()

        for settlement, similarity in zip(settlement_codes, results_array):
            max_similarity = max(similarity)
            if max_similarity < THRESHOLD:
                search_result[settlement] = None
            else:
                index_max = similarity.index(max_similarity)
                matched_settlement = search_data[index_max]
                search_result[settlement] = matched_settlement

        return {search_dataset.name: search_result}
    except Exception as e:
        print(f'Error Encountered: {e}')
        pass


def find_and_match_settlement(focal_datasets: list[ReviewDataSet]):
    """Find Match and possible close matches in the MLoS against comparison datasets"""

    focal_mlos: ReviewDataSet = list(filter(lambda d: d.name=='mlos', focal_datasets))[0]
    if focal_mlos.data.empty:
        return None

    focal_mlos_settlements = focal_mlos.data[focal_mlos.unique_code].tolist()
    settlement_matcher = partial(match_settlement, focal_mlos_settlements)
    search_datasets = [
        dataset for dataset in focal_datasets
        if dataset.name!='mlos' and dataset.data.empty is False
    ]

    search_results = {}
    with multiprocessing.Pool() as pool:
        results = pool.map(settlement_matcher, search_datasets)

        for output in results:
            search_results.update(output)

    return search_results


def filter_dataset(dataset: pd.DataFrame | gpd.GeoDataFrame, admin: AdminColumns, ward_code: str):
    state, lga, ward = ward_code.split("_")
    logging.info(f'Filtering Datasets to {state} State {lga} LGA and {ward}')
    dataset['ward_score'] = rapidfuzz.process.cdist(dataset[admin.ward], [ward], scorer=rapidfuzz.fuzz.partial_ratio) # noqa
    dataset['lga_score'] = rapidfuzz.process.cdist(dataset[admin.lga], [lga], scorer=rapidfuzz.fuzz.partial_ratio) # noqa

    mask = (
        (dataset['ward_score']>=WARD_THRESHOLD)  &
        (dataset['lga_score']>=LGA_THRESHOLD)
    )

    focal_dataset = dataset[mask]
    focal_dataset.drop(columns=['ward_score', 'lga_score'], inplace=True)
    return focal_dataset


def process_focal_datasets(review_datasets: list[ReviewDataSet],  focal_ward_id: str)-> dict:
    focal_datasets = []
    logging.info(f'Cross-Referencing Settlements within {focal_ward_id.split("_")} Administrative Locations')
    for review_dataset in review_datasets:
        dataset_copy = review_dataset.data.copy()
        focal_dataset = filter_dataset(dataset_copy, review_dataset.admin_columns, focal_ward_id)
        filtered_data: ReviewDataSet = ReviewDataSet(
            name=review_dataset.name,
            data=focal_dataset,
            settlement_col=review_dataset.settlement_col,
            admin_columns=review_dataset.admin_columns,
            geo_col=review_dataset.geo_col,
        )
        focal_datasets.append(filtered_data)

    focal_datasets_result = find_and_match_settlement(focal_datasets)
    return focal_datasets_result


def process_ward_level_data(boundary_record: tuple[str, MultiPolygon], datasets: list[ReviewDataSet]) -> dict:
    ward_id, geometry = boundary_record
    datasets_copy = list(datasets)
    focal_dataset_result = process_focal_datasets(datasets_copy, ward_id)
    return focal_dataset_result


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
    places_data['admin_id'] = places_data.apply(
        lambda row: f"{row[admin.state]}_{row[admin.lga]}_{row[admin.ward]}", axis=1)

    places_data = places_data[places_data['admin_id'].isin(subset_locations)]
    places_data.drop(columns=['admin_id'], inplace=True)
    return places_data


def retrieve_ward_geometries(states: list[str], places: list[str]) -> tuple[list[tuple[str, MultiPolygon]],ReviewDataSet]:
    logging.info('Retrieving Ward Boundary Data and Converting to Ward Geometries')
    boundary_data: gpd.GeoDataFrame = ReadDBData(CONFIG['DATASETS']['ward_boundary'], True).read_data({'statename': states})
    admin_info = boundary_data.loc[:, ['statename', 'lganame', 'wardname', 'geometry']].to_records(index=False)
    ward_geometry_map: list[tuple[str, MultiPolygon]] = [(f"{state}_{lga}_{ward}",geometry) for state, lga, ward, geometry in admin_info]
    ward_geometry_map = list(filter(lambda m: m[0] in places, ward_geometry_map))
    osm_dataset = retrieve_osm_data(boundary_data, places)
    return ward_geometry_map, osm_dataset


def enrich_dataset(target_data: gpd.GeoDataFrame, source_data: gpd.GeoDataFrame, places: list[str]):
    logging.info('Enriching OSM Data with Administrative information')
    enriched_data = target_data.sjoin(source_data[['wardname', 'lganame', 'statename', 'geometry']], how='left', predicate='intersects', lsuffix="_source")
    added_cols = [col for col in enriched_data.columns if col.__contains__('_source')] + ['index_right']
    enriched_data.drop(added_cols, axis=1, inplace=True)
    enriched_data['ward_id'] = enriched_data.apply(
        lambda row: f"{row['statename']}_{row['lganame']}_{row['wardname']}", axis=1)
    enriched_data = enriched_data.loc[enriched_data['ward_id'].isin(places)]
    return enriched_data


def retrieve_osm_data(boundary_data: gpd.GeoDataFrame, places: list[str]) -> ReviewDataSet:
    logging.info('Retrieving OSM Data')
    osm_admin = AdminColumns('statename', 'lganame', 'wardname', 'name')
    try:
        osm_place = ReadDBData(CONFIG['DATASETS']['osm'], True).read_data()
        osm_place = osm_place.loc[osm_place['name'].notna()]
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
    ward_level_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(process_ward_level_data, mapping, datasets)
            for mapping in admin_map]

        for future in tqdm(concurrent.futures.as_completed(futures), total=len(admin_map), desc="Processing", unit='wards'):
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

        new_code = f"{dataset.unique_code}_{dataset.name}"
        dataset.data.rename(columns={dataset.unique_code: new_code}, inplace=True)
        settlement_data = settlement_data.merge(
            dataset.data[['geometry', new_code]], left_on=dataset.name, right_on=new_code,
            suffixes=(None, f'_{dataset.name}'), how='left')

        settlement_data[f'geometry_{dataset.name}'] = settlement_data.apply(
            lambda row: row[f'geometry_{dataset.name}'] if pd.notna(row[dataset.name]) else np.nan, axis=1)

        settlement_data.drop(columns=[new_code], inplace=True)

    return settlement_data


def evaluator(row: pd.Series, target_source: str, ind_source: str):
    source_geom = row['geometry']
    ind_geom = row[f'geometry_{ind_source}']
    source_name = row[target_source]
    ind_name = row[ind_source]

    if pd.isna([source_name, ind_name]).any():
        return None

    similarity = fuzz.partial_ratio(source_name, ind_name)
    distance = calculate_distance(source_geom, ind_geom)

    return Response(source=ind_source, unique_code=ind_name, similarity=similarity, distance=distance)


def get_coord(coord: Point | MultiPoint, ax: Literal['x', 'y']) -> float:
    if coord is None:
        return np.nan

    if isinstance(coord, MultiPoint):
        coord = coord.centroid

    if ax == 'x':
        return coord.x

    return coord.y


def intersects_grid3_extent(ind_geom: Point|MultiPoint|None, grid3_extent: BaseGeometry) -> bool|None:
    if ind_geom is None:
        return None

    if isinstance(ind_geom, MultiPoint):
        ind_geom = ind_geom.centroid

    return ind_geom.within(grid3_extent)


def close_to_tracks(ind_geom: Point|MultiPoint|None, tracks_data: BaseGeometry) -> bool|None:
    if ind_geom is None:
        return None

    if isinstance(ind_geom, MultiPoint):
        ind_geom = ind_geom.centroid

    return ind_geom.dwithin(tracks_data, distance=0.0027000270)


def evaluate_settlements(settlement: gpd.GeoDataFrame, code_col: str, ind_datasets: list[str],
                         tracks_data: gpd.GeoDataFrame, grid3_extent: gpd.GeoDataFrame) -> pd.DataFrame:
    print('Merging Datasets....')
    merged_extent: BaseGeometry = grid3_extent.geometry.union_all()
    merged_tracks: BaseGeometry = tracks_data.geometry.union_all()

    print('Starting Evaluation...')
    logging.info('Starting Evaluation for Intersection with Grid3 and proximity to Tracks...')
    for ind_dataset in tqdm(ind_datasets, desc='Evaluating and Expanding Results', unit='datasets'):
        settlement[f"{ind_dataset}_response"] = settlement.apply(evaluator, args=(code_col, ind_dataset,), axis=1)
        settlement[f'{ind_dataset}_similarity'] = settlement[f'{ind_dataset}_response'].apply(
            lambda x: x.similarity if pd.notna(x) else np.nan)

        settlement[f'{ind_dataset}_distance'] = settlement[f'{ind_dataset}_response'].apply(
            lambda x: x.distance if pd.notna(x) else np.nan)
        settlement[f'{ind_dataset}_grid3'] = settlement[f'geometry_{ind_dataset}'].apply(
            intersects_grid3_extent, args=(merged_extent,))

        settlement[f'{ind_dataset}_near_tracks'] = settlement[f'geometry_{ind_dataset}'].apply(
            close_to_tracks, args=(merged_tracks,))

        settlement[f'{ind_dataset}_latitude'] = settlement[f'geometry_{ind_dataset}'].apply(get_coord, args=('y',))
        settlement[f'{ind_dataset}_longitude'] = settlement[f'geometry_{ind_dataset}'].apply(get_coord, args=('x',))
        settlement.drop(columns=[f'{ind_dataset}_response', f'geometry_{ind_dataset}'], inplace=True)

    settlement.drop(columns=['geometry'], inplace=True)
    return settlement


def calculate_distance(geometry1: Point|MultiPoint, geometry2: Point|MultiPoint):
    if isinstance(geometry1, MultiPoint):
        # Todo: convert to Point
        geometry1 = geometry1.centroid

    if isinstance(geometry2, MultiPoint):
        geometry2 = geometry2.centroid

    geom1 = geometry1.y, geometry1.x
    geom2 = geometry2.y, geometry2.x
    if pd.isna(list(geom2)).any() or pd.isna(list(geom1)).any():
        return np.nan

    distance = geodesic(geom1, geom2).meters
    return distance


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
    settlement_data_copy = settlement_data.copy()
    admin = AdminColumns.create_by_search(settlement_data_copy)
    settlement_data_copy['unique_ward'] = settlement_data_copy.apply(
        lambda row: f"{row[admin.state]}_{row[admin.lga]}_{row[admin.ward]}", axis=1
    )

    unique_wards = settlement_data_copy['unique_ward'].unique().tolist()

    return unique_wards


def create_review_datasets(
        source_datasets: dict[str, pd.DataFrame], states: list[str],
        places: list[str], use_osm: bool) -> tuple[list[ReviewDataSet], Any]:

    logging.info(f'Creating Review Datasets from {len(source_datasets)} datasets and {len(states)} states...')
    datasets = []

    for data_name, data in source_datasets.items():
        admin_cols = AdminColumns.create_by_search(data)
        if data_name != 'mlos':
            data = subset_datasets(data, admin_cols, places)
        geo_cols = GeomColumns.get_geom_cols(data, True)
        geo_data = convert_to_geodata(data, geo_cols)
        dataset: ReviewDataSet = ReviewDataSet(
            name=data_name,
            data=geo_data,
            admin_columns=admin_cols,
            geo_col=geo_cols
        )

        datasets.append(dataset)

    geom_map, osm_dataset = retrieve_ward_geometries(states, places)
    if use_osm:
        logging.info('OSM Data Included')
        datasets.append(osm_dataset)

    return datasets, geom_map


def investigate_similarity_response(
        enriched_df: gpd.GeoDataFrame, datasets: list[ReviewDataSet], states: list[str], set_code: str,
        tracks_gdf: gpd.GeoDataFrame, sources: list[str]):

    enriched_settlement = merge_and_cleanup(enriched_df, datasets)
    grid3 = ReadDBData(CONFIG['DATASETS']['grid_3_extent'], True).read_data({'statename': states})
    reviewed_settlement = evaluate_settlements(enriched_settlement, set_code, sources, tracks_gdf, grid3)
    final_settlements = reviewed_settlement.drop_duplicates(subset='unique_code', keep='first')

    return final_settlements


@atimer(display=True)
async def review_settlement_coordinates(
        source_datasets: dict[str, pd.DataFrame], settlements: pd.DataFrame, tracks: gpd.GeoDataFrame, include_osm: bool) -> pd.DataFrame:

    analysis_wards = extract_places(settlements)
    source_datasets.update({'mlos': settlements})
    state_col = get_admin_col(settlements, 'state')
    states = settlements[state_col].str.title().unique().tolist()
    datasets, geom_map = create_review_datasets(source_datasets, states, analysis_wards, include_osm)
    sources = [ds.name for ds in datasets if ds.name != 'mlos']

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

    return reviewed_settlements



# if __name__ == '__main__':
#     import openpyxl
#     import asyncio
#
#     baseline_settlement_file = r"C:\Workspace\MLoS\validation\Kebbi_Harmonised_MLoS_Manager.xlsx"
#     baseline_df = pd.read_excel(baseline_settlement_file, sheet_name="state")
#     cols = ['unique_code', 'state_name', 'lga_name', 'ward_name', 'settlement_name', 'latitude', 'longitude']
#     baseline_df = baseline_df.loc[baseline_df['lga_name'].str.contains('Fakai'), cols]
#     tracks_data = gpd.read_file(r"C:\Workspace\NEOC\IBRA\August Round\GIS\tracks_day_6.gpkg")
#     previous_camp_file = r"C:\Workspace\NEOC\IBRA\August Round\Submissions\Standardized\August 2026 IBRA 2 Campaign Submissions.xlsx"
#     rounds = openpyxl.load_workbook(previous_camp_file).sheetnames
#     campaign_datasets: dict[str, pd.DataFrame] = {}
#     for camp_round in tqdm(rounds, desc='Reading Datasets', total=len(rounds)):
#         df = pd.read_excel(previous_camp_file, sheet_name=camp_round)
#         campaign_datasets[camp_round] = df
#
#     output = asyncio.run(
#         review_settlement_coordinates(campaign_datasets, baseline_df, tracks_data)
#     )
#     output.to_csv(r'C:\Workspace\MLoS\validation\DUplicate.csv', index=False)
#
