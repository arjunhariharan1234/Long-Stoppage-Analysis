from fastapi import APIRouter, Query

from app.spatial.lazy import get_poi_index
from app.schemas import POIMatchResponse

router = APIRouter(tags=["poi"])


@router.get("/poi/nearest", response_model=POIMatchResponse | None)
def get_nearest_poi(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Find the nearest POI to a given lat/lon using progressive radius search."""
    poi_index = get_poi_index()
    match = poi_index.query_nearest(lat, lon)
    if match is None:
        return None
    return POIMatchResponse(
        name=match.name,
        resolved_type=match.resolved_type,
        lat=match.lat,
        lon=match.lon,
        distance_m=round(match.distance_m, 1),
        match_radius_m=match.match_radius_m,
    )


@router.get("/poi/nearby", response_model=list[POIMatchResponse])
def get_nearby_pois(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(2000, ge=100, le=10000),
):
    """Find all POIs within a given radius of a lat/lon."""
    poi_index = get_poi_index()
    matches = poi_index.query_all_within(lat, lon, radius_m)
    return [
        POIMatchResponse(
            name=m.name,
            resolved_type=m.resolved_type,
            lat=m.lat,
            lon=m.lon,
            distance_m=round(m.distance_m, 1),
            match_radius_m=m.match_radius_m,
        )
        for m in matches
    ]
