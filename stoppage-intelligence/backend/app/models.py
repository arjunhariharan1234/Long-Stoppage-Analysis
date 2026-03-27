from datetime import datetime

from sqlalchemy import (
    Column, Integer, Float, String, DateTime, Text, ForeignKey, Boolean, JSON
)
from sqlalchemy.orm import relationship

from app.database import Base


class Upload(Base):
    __tablename__ = "uploads"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    row_count = Column(Integer)
    valid_row_count = Column(Integer)
    invalid_row_count = Column(Integer)
    status = Column(String, default="pending")  # pending / processing / complete / error
    column_mapping = Column(JSON)
    error_message = Column(Text)

    events = relationship("StoppageEvent", back_populates="upload", cascade="all, delete-orphan")
    clusters = relationship("Cluster", back_populates="upload", cascade="all, delete-orphan")


class StoppageEvent(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    upload_id = Column(Integer, ForeignKey("uploads.id"), nullable=False, index=True)
    external_id = Column(String, index=True)
    trip_id = Column(String, index=True)
    route_code = Column(String, index=True)
    alert_id = Column(String)
    alert_name = Column(String)
    alert_status = Column(String)
    event_timestamp = Column(DateTime, index=True)
    lat = Column(Float)
    lon = Column(Float)
    is_valid = Column(Boolean, default=True)

    # POI enrichment (per-event level)
    nearest_poi_name = Column(String)
    nearest_poi_type = Column(String)
    nearest_poi_lat = Column(Float)
    nearest_poi_lon = Column(Float)
    nearest_poi_distance_m = Column(Float)
    poi_match_radius_m = Column(Float)
    classification = Column(String)  # known_functional / other_legit / unauthorized

    # Cluster assignment
    cluster_id = Column(Integer, ForeignKey("clusters.id"), index=True)

    upload = relationship("Upload", back_populates="events")
    cluster = relationship("Cluster", back_populates="events")


class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(Integer, primary_key=True, index=True)
    upload_id = Column(Integer, ForeignKey("uploads.id"), nullable=False, index=True)
    radius_meters = Column(Integer, nullable=False)
    centroid_lat = Column(Float, nullable=False)
    centroid_lon = Column(Float, nullable=False)
    event_count = Column(Integer)
    distinct_trips = Column(Integer)
    distinct_routes = Column(Integer)

    # POI enrichment (cluster-level)
    poi_name = Column(String)
    poi_type = Column(String)
    poi_lat = Column(Float)
    poi_lon = Column(Float)
    poi_distance_m = Column(Float)
    poi_match_radius_m = Column(Float)

    # Classification
    classification = Column(String)  # known_functional / other_legit / unauthorized

    # Time intelligence
    first_seen = Column(DateTime)
    last_seen = Column(DateTime)
    peak_hour = Column(Integer)
    night_halt_pct = Column(Float)

    upload = relationship("Upload", back_populates="clusters")
    events = relationship("StoppageEvent", back_populates="cluster")
