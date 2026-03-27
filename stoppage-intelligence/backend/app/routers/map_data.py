import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Cluster

logger = logging.getLogger(__name__)
router = APIRouter(tags=["map"])


@router.get("/map/clusters")
def get_map_clusters(
    upload_id: int = Query(...),
    radius_m: int = Query(500),
    classification: str | None = Query(None),
    poi_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return clusters as GeoJSON FeatureCollection for map rendering."""
    q = db.query(Cluster).filter(
        Cluster.upload_id == upload_id,
        Cluster.radius_meters == radius_m,
    )
    if classification:
        q = q.filter(Cluster.classification == classification)
    if poi_type:
        q = q.filter(Cluster.poi_type == poi_type)

    clusters = q.all()

    features = []
    for c in clusters:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [c.centroid_lon, c.centroid_lat],
            },
            "properties": {
                "id": c.id,
                "event_count": c.event_count,
                "distinct_trips": c.distinct_trips,
                "distinct_routes": c.distinct_routes,
                "classification": c.classification,
                "poi_name": c.poi_name,
                "poi_type": c.poi_type,
                "poi_distance_m": c.poi_distance_m,
                "first_seen": c.first_seen.isoformat() if c.first_seen else None,
                "last_seen": c.last_seen.isoformat() if c.last_seen else None,
                "peak_hour": c.peak_hour,
                "night_halt_pct": c.night_halt_pct,
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }
