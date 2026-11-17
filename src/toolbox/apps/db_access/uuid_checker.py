from uuid import UUID

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from toolbox.tools import uuid_cache, clear_uuid_cache, search_uuid_cache, search_uuid_cache_many
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.models.db import Availability, UUIDResponse, UUIDResponses, Reasons

router = APIRouter()


@router.get("/uuid_check", tags=['Accessor'],  response_model=UUIDResponse)
@uuid_cache
async def uuid_exist(uuid: UUID) -> UUIDResponse:
    settlements_table = CONFIG['DATASETS']['settlements']
    # Database calls block, so they run in a worker thread; this is not a heavy job, so it does not queue behind them.
    found = await run_in_threadpool(lambda: ReadDBData(settlements_table, False).record_exists({'eha_guid': [str(uuid)]}))
    if found:
        return UUIDResponse(uuid=uuid, is_available=Availability.NOT_AVAILABLE, reason=Reasons.IN_MLOS)

    # Not in the MLoS: it may still be spoken for by an earlier check (reserved, not yet in the MLoS).
    if await run_in_threadpool(search_uuid_cache, str(uuid)):
        return UUIDResponse(uuid=uuid, is_available=Availability.NOT_AVAILABLE, reason=Reasons.RESERVED)

    # Available. `uuid_cache` reserves it on the way out.
    return UUIDResponse(uuid=uuid, is_available=Availability.AVAILABLE)


@router.delete("/uuid_cache", tags=['Accessor'])
async def wipe_uuid_cache() -> dict[str, int]:
    """Remove every reserved UUID. Run it after a new MLoS version is loaded, when the reserved
    UUIDs have been adopted into it. Not used by the frontend."""
    cleared = await run_in_threadpool(clear_uuid_cache)
    return {'cleared': cleared}


@router.post("/uuid_batch_checker", tags=['Accessor'], response_model=UUIDResponses)
@uuid_cache
async def batch_check_uuid_exist(uuids: list[UUID]) -> UUIDResponses:

    settlements_table = CONFIG['DATASETS']['settlements']

    def check_all() -> list[UUIDResponse]:
        reader = ReadDBData(settlements_table, False)
        distinct = list(dict.fromkeys(str(uuid) for uuid in uuids))
        in_mlos = {guid for guid in distinct if reader.record_exists({'eha_guid': [guid]})}
        # One lookup for everything not in the MLoS, rather than one per UUID.
        reserved = search_uuid_cache_many(guid for guid in distinct if guid not in in_mlos)

        results = []
        for uuid in uuids:
            guid = str(uuid)
            if guid in in_mlos:
                results.append(UUIDResponse(uuid=uuid, is_available=Availability.NOT_AVAILABLE, reason=Reasons.IN_MLOS))
            elif guid in reserved:
                results.append(UUIDResponse(uuid=uuid, is_available=Availability.NOT_AVAILABLE, reason=Reasons.RESERVED))
            else:
                results.append(UUIDResponse(uuid=uuid, is_available=Availability.AVAILABLE))
        return results

    # Available ones are reserved by `uuid_cache` on the way out.
    return UUIDResponses(response=await run_in_threadpool(check_all))
