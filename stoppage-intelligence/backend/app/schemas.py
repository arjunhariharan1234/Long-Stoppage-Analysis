from datetime import datetime

from pydantic import BaseModel


class UploadResponse(BaseModel):
    id: int
    filename: str
    status: str
    row_count: int | None
    valid_row_count: int | None
    invalid_row_count: int | None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class POIMatchResponse(BaseModel):
    name: str
    resolved_type: str
    lat: float
    lon: float
    distance_m: float
    match_radius_m: float


class POIQueryRequest(BaseModel):
    lat: float
    lon: float
    radius_m: float | None = None


class HealthResponse(BaseModel):
    status: str
    poi_count: int
    db_status: str
