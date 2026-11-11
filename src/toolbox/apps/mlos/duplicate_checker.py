from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse

from toolbox.errors import DataContractError
from toolbox.spatial_mgr import GeomColumns
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos import detect_unique_admin_field, construct_new_unique
from toolbox.mlos.validation.review import duplicate_deep_search_protocol
from toolbox.utils.offload import run_heavy
from toolbox.utils.tempfiles import afile_response

router = APIRouter()

SOURCE_COLUMN = 'Source'


def ensure_source_column(data):
    """Cross-referencing compares the 'Source' of each pair of settlements, so the file needs that column.

    A column that is only spelled differently ('source', ' SOURCE ') is renamed to 'Source'. When there
    is none, the user is told what to do, instead of the search failing with a bare "Missing Config Info".
    """
    if SOURCE_COLUMN in data.columns:
        return data
    for column in data.columns:
        if str(column).strip().lower() == SOURCE_COLUMN.lower():
            return data.rename(columns={column: SOURCE_COLUMN})
    raise DataContractError(
        code='missing_source_column',
        message=(
            "Cross-reference source is on, but the file has no 'Source' column. "
            "Add a 'Source' column, or turn Cross-reference source off and run the check again."
        ),
        details={'missing': [SOURCE_COLUMN], 'found': [str(column) for column in data.columns]},
    )


@router.post("/duplicate-deep-search", tags=["MLoS"])
async def search_for_duplicate_settlements(settlements_file: UploadFile, threshold: int, cross_reference_source: bool) -> FileResponse:
    """
    Conducts a duplicate check on settlement data based on fuzzy rules which helps identify duplicate settlements that
    are spelled differently.

    Parameters
    ----------
    settlements_file (UploadFile): Settlement data file
    threshold (int): Threshold for duplicate settlements
    cross_reference_source (bool): Use the source of the duplication to help triangulate duplicate settlements

    Returns
    -------
    FileResponse: CSV File of potentially duplicate settlements

    """
    settlement_data = await read_dataset(settlements_file)
    if cross_reference_source:
        settlement_data = ensure_source_column(settlement_data)
    def search(data):
        unique_code = detect_unique_admin_field(data)
        if not unique_code:
            unique_code = 'unique_code'
            data = construct_new_unique(data, unique_code)

        geom = GeomColumns.get_geom_cols(data, True)
        return duplicate_deep_search_protocol(data, unique_code, threshold, geom, 'mapping', cross_reference_source)

    # The fuzzy comparison of every settlement pair can run for minutes: keep it off the event loop.
    settlement_data = await run_heavy(search, settlement_data)

    save_name = "Potential Duplicate Settlements"

    return await afile_response(lambda path: settlement_data.to_csv(path, index=False), '.csv', 'text/csv', save_name)

