import tempfile

from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse

from toolbox.spatial_mgr import GeomColumns
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos import detect_unique_admin_field, construct_new_unique
from toolbox.mlos.validation.review import duplicate_deep_search_protocol

router = APIRouter()


@router.post("/duplicate-deep-search", tags=["MLoS"])
async def search_for_duplicate_settlements(settlements_file: UploadFile, threshold: int) -> FileResponse:

    settlement_data = await read_dataset(settlements_file)
    unique_code = detect_unique_admin_field(settlement_data)
    if not unique_code:
        unique_code = 'unique_code'
        settlement_data = construct_new_unique(settlement_data, unique_code)

    geom = GeomColumns.get_geom_cols(settlement_data, True)
    settlement_data = duplicate_deep_search_protocol(settlement_data, unique_code, threshold, geom, 'mapping')

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
    settlement_data.to_csv(temp_file.name, index=False)
    temp_file.close()

    save_name = "Potential Duplicate Settlements"

    return FileResponse(
        temp_file.name,
        media_type="text/csv",
        filename=save_name
    )

