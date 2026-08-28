from dataclasses import dataclass
from enum import Enum

from pydantic import BaseModel


@dataclass
class Operations:
    attributes: bool = False
    shift_point: bool = False
    set_global_id: bool = False
    populate_takeoff: bool = False


class State(Enum):
    Abia = 'Abia'
    Adamawa = 'Adamawa'
    Akwa_Ibom = 'Akwa Ibom'
    Anambra = 'Anambra'
    Bauchi = 'Bauchi'
    Bayelsa = 'Bayelsa'
    Benue = 'Benue'
    Borno = 'Borno'
    Cross_River = 'Cross River'
    Delta = 'Delta'
    Ebonyi = 'Ebonyi'
    Edo = 'Edo'
    Ekiti = 'Ekiti'
    Enugu = 'Enugu'
    FCT = 'FCT'
    Gombe = 'Gombe'
    Imo = 'Imo'
    Jigawa = 'Jigawa'
    Kaduna = 'Kaduna'
    Kano = 'Kano'
    Katsina = 'Katsina'
    Kebbi = 'Kebbi'
    Kogi = 'Kogi'
    Kwara = 'Kwara'
    Lagos = 'Lagos'
    Nasarawa = 'Nasarawa'
    Niger = 'Niger'
    Ogun = 'Ogun'
    Ondo = 'Ondo'
    Osun = 'Osun'
    Oyo = 'Oyo'
    Plateau = 'Plateau'
    Rivers = 'Rivers'
    Sokoto = 'Sokoto'
    Taraba = 'Taraba'
    Yobe = 'Yobe'
    Zamfara = 'Zamfara'


    @property
    def state_code(self):
        from toolbox.configs import CONFIG
        return CONFIG['STATE_CODES'][self.name]


class CampaignDay(BaseModel):
    analysis_day: int
    is_mop_up: bool


class Extensions(Enum):
    CSV = 'csv'
    SQLITE = 'sqlite'
    EXCEL = 'xlsx'
    KML = 'kml'
    KMZ = 'kmz'
    GPKG = 'gpkg'

    @property
    def extension(self):
        if self.EXCEL:
            return [f".{self.value}", f'.{self.value}s']

        return self.value


class Policy(Enum):
    MLOS = 'MLOS'
    MP = 'MP'


class TriangulationMethod(Enum):
    COORDS = 'COORDS'
    SETTLEMENT = 'SETTLEMENT'
    BOTH = 'BOTH'


class Scheme(Enum):
    VISITATION='VISITATION'
    COVERAGE='COVERAGE'
    QC='QC'
