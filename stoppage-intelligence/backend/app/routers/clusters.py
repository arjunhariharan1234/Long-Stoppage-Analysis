import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Cluster, StoppageEvent

logger = logging.getLogger(__name__)
router = APIRouter(tags=["clusters"])


@router.get("/clusters")
def list_clusters(
    upload_id: int = Query(...),
    radius_m: int = Query(500),
    classification: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    """List clusters for an upload at a given radius."""
    q = db.query(Cluster).filter(
        Cluster.upload_id == upload_id,
        Cluster.radius_meters == radius_m,
    )
    if classification:
        q = q.filter(Cluster.classification == classification)

    total = q.count()
    clusters = q.order_by(Cluster.event_count.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "radius_m": radius_m,
        "clusters": [
            {
                "id": c.id,
                "centroid_lat": c.centroid_lat,
                "centroid_lon": c.centroid_lon,
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
            }
            for c in clusters
        ],
    }


@router.get("/clusters/{cluster_id}")
def get_cluster_detail(
    cluster_id: int,
    db: Session = Depends(get_db),
):
    """Get cluster detail including member events."""
    cluster = db.query(Cluster).filter(Cluster.id == cluster_id).first()
    if not cluster:
        raise HTTPException(404, "Cluster not found")

    # Get member events (only for default 500m radius clusters that have event assignment)
    events = (
        db.query(StoppageEvent)
        .filter(StoppageEvent.cluster_id == cluster_id)
        .order_by(StoppageEvent.event_timestamp.desc())
        .limit(100)
        .all()
    )

    return {
        "id": cluster.id,
        "upload_id": cluster.upload_id,
        "radius_meters": cluster.radius_meters,
        "centroid_lat": cluster.centroid_lat,
        "centroid_lon": cluster.centroid_lon,
        "event_count": cluster.event_count,
        "distinct_trips": cluster.distinct_trips,
        "distinct_routes": cluster.distinct_routes,
        "classification": cluster.classification,
        "poi_name": cluster.poi_name,
        "poi_type": cluster.poi_type,
        "poi_distance_m": cluster.poi_distance_m,
        "poi_match_radius_m": cluster.poi_match_radius_m,
        "first_seen": cluster.first_seen.isoformat() if cluster.first_seen else None,
        "last_seen": cluster.last_seen.isoformat() if cluster.last_seen else None,
        "peak_hour": cluster.peak_hour,
        "night_halt_pct": cluster.night_halt_pct,
        "events": [
            {
                "id": e.id,
                "external_id": e.external_id,
                "trip_id": e.trip_id,
                "route_code": e.route_code,
                "event_timestamp": e.event_timestamp.isoformat() if e.event_timestamp else None,
                "lat": e.lat,
                "lon": e.lon,
            }
            for e in events
        ],
    }
