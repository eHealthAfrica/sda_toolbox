from dataclasses import dataclass
from enum import Enum
from uuid import UUID

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from toolbox.configs import CONFIG
from toolbox.access import ReadDBData

router = APIRouter()

class Exists(Enum):
    EXISTS = 'EXISTS'
    NO = 'NOT EXISTS'


@dataclass
class UUIDResponse:
    uuid: UUID
    exists: Exists

@dataclass
class UUIDResponses:
    response: list[UUIDResponse]


@router.get("/uuid_check", tags=['Accessor'],  response_model=UUIDResponse)
async def uuid_exist(uuid: UUID) -> UUIDResponse:
    settlements_table = CONFIG['DATASETS']['settlements']
    # Database calls block, so they run in a worker thread; this is not a heavy job, so it does not queue behind them.
    found = await run_in_threadpool(lambda: ReadDBData(settlements_table, False).record_exists({'eha_guid': [str(uuid)]}))
    exists: Exists = Exists.EXISTS if found else Exists.NO
    return UUIDResponse(
        uuid=uuid,
        exists=exists
    )


@router.post("/uuid_batch_checker", tags=['Accessor'], response_model=UUIDResponses)
async def batch_check_uuid_exist(uuids: list[UUID]) -> UUIDResponses:

    settlements_table = CONFIG['DATASETS']['settlements']

    def check_all() -> list[UUIDResponse]:
        reader = ReadDBData(settlements_table, False)
        results = []
        for uuid in uuids:
            found = reader.record_exists({'eha_guid': [str(uuid)]})
            exists: Exists = Exists.EXISTS if found else Exists.NO
            results.append(UUIDResponse(uuid=uuid, exists=exists))
        return results

    responses = UUIDResponses(response=await run_in_threadpool(check_all))

    return responses
