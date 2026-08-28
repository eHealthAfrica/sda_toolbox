from datetime import datetime

from sqlalchemy import Column, Integer, DateTime, VARCHAR, BigInteger, inspect
from sqlalchemy.orm import mapped_column, declarative_base, Mapped
from shapely.geometry import Polygon, MultiPolygon
from geoalchemy2 import Geometry

from toolbox.configs import CONFIG


Base = declarative_base()

type Boundary = Wards | LGA | States


class Wards(Base):
    __tablename__ = CONFIG['datasets']['ward_boundary']
    id: Mapped[str] = mapped_column(Integer, primary_key=True)
    geom: Mapped[MultiPolygon] = Column(Geometry(geometry_type='POLYGON', srid=4326))
    ogc_fid: Mapped[int] = Column(BigInteger)
    amapcode: Mapped[str] = Column(VARCHAR)
    globalid: Mapped[str] = Column(VARCHAR)
    status: Mapped[str] = Column(VARCHAR)
    lgacode: Mapped[str] = Column(VARCHAR)
    timestamp: Mapped[datetime] = Column(DateTime(timezone=False))
    editor: Mapped[str] = Column(VARCHAR)
    source: Mapped[str] = Column(VARCHAR)
    urban: Mapped[str] = Column(VARCHAR)
    lgacode: Mapped[str] = mapped_column(VARCHAR)
    wardname: Mapped[str] = Column(VARCHAR)
    wardcode: Mapped[str] = Column(VARCHAR)
    lganame: Mapped[str] = Column(VARCHAR)
    state : Mapped[str]= Column(VARCHAR)


class LGA(Base):
    __tablename__ = CONFIG['datasets']['lga_boundary']
    id = Column(Integer, primary_key=True, nullable=False)
    geom: Mapped[MultiPolygon] = Column(Geometry(geometry_type='POLYGON', srid=4326))
    editor: Mapped[str] = Column(VARCHAR)
    lgacode: Mapped[str] = Column(VARCHAR)
    lganame: Mapped[str] = Column(VARCHAR)
    statecode: Mapped[str] = Column(VARCHAR)
    source: Mapped[str] = Column(VARCHAR)
    timestamp: Mapped[datetime] = Column(DateTime(timezone=False))
    globalid: Mapped[str] = Column(VARCHAR)
    amapcode: Mapped[str] = Column(VARCHAR)


class States(Base):
    __tablename__ = CONFIG['datasets']['state_boundary']
    id: Mapped[int] = Column(Integer, primary_key=True, nullable=False)
    geom: Mapped[MultiPolygon] = Column(Geometry(geometry_type='POLYGON', srid=4326))
    ogc_fid: Mapped[int] = Column(BigInteger)
    editor: Mapped[str] = Column(VARCHAR)
    statecode: Mapped[str] = Column(VARCHAR)
    statename: Mapped[str] = Column(VARCHAR)
    capacity: Mapped[int] = Column(BigInteger)
    source: Mapped[str] = Column(VARCHAR)
    timestamp: Mapped[datetime] = Column(DateTime(timezone=False))
    globalid: Mapped[str] = Column(VARCHAR)
    geozone: Mapped[str] = Column(VARCHAR)


class Ta(Base):
    __tablename__ = CONFIG['datasets']['gridded_settlement_extent']


class Voronoi(Base):
    __tablename__ = CONFIG['datasets']['settlement_extent']


def table_exists(boundary: Boundary):
    return inspect(boundary).exists


