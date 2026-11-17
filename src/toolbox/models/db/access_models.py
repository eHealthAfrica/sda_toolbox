from dataclasses import dataclass
from enum import Enum
from uuid import UUID


class Availability(Enum):
    NOT_AVAILABLE = 'Not Available'
    AVAILABLE = 'Available'


class Reasons(Enum):
    IN_MLOS = 'In MLOS'
    RESERVED = 'Reserved'


@dataclass
class UUIDResponse:
    uuid: UUID
    is_available: Availability
    reason: Reasons | None = None

@dataclass
class UUIDResponses:
    response: list[UUIDResponse]

