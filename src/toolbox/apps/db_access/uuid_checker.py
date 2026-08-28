from dataclasses import dataclass
from enum import Enum
from uuid import UUID

from fastapi import APIRouter

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
    found = ReadDBData(settlements_table, False).record_exists({'eha_guid': [str(uuid)]})
    exists: Exists = Exists.EXISTS if found else Exists.NO
    return UUIDResponse(
        uuid=uuid,
        exists=exists
    )


@router.post("/uuid_batch_checker", tags=['Accessor'], response_model=UUIDResponses)
async def batch_check_uuid_exist(uuids: list[UUID]) -> UUIDResponses:

    settlements_table = CONFIG['DATASETS']['settlements']
    reader = ReadDBData(settlements_table, False)
    results = []
    for uuid in uuids:
        found = reader.record_exists({'eha_guid': [str(uuid)]})
        exists: Exists = Exists.EXISTS if found else Exists.NO
        response = UUIDResponse(uuid=uuid, exists=exists)
        results.append(response)

    responses = UUIDResponses(response=results)

    return responses
