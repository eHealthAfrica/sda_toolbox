from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter

router = APIRouter()

@dataclass
class UUIDResponse:
    uuid: str
    exists: bool


@router.get("/uuid_check", tags=['MLoS'],  response_model=UUIDResponse)
async def uuid_exist(uuid: UUID) -> UUIDResponse:
    raise NotImplementedError


@router.get("/uuid_batch_checker", tags=['MLoS'], response_model=UUIDResponse)
async def batch_check_uuid_exist(uuids: list[UUID]) -> list[UUIDResponse]:
    raise NotImplementedError