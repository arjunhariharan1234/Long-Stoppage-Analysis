import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case, extract

from app.database import get_db
from app.models import StoppageEvent, Cluster, Upload

logger = logging.getLogger(__name__)
router = APIRouter(tags=["analytics"])


@router.get("/analytics/summary")
def get_summary(
    upload_id: int = Query(...),
    radius_m: int = Query(500),
    db: Session = Depends(get_db),
):
    """KPI summary for an upload."""
    upload = db.query(Upload).filter(Upload.id == upload_id).first()

    total_events = db.query(StoppageEvent).filter(
        StoppageEvent.upload_id == upload_id
    ).count()
    valid_events = db.query(StoppageEvent).filter(
        StoppageEvent.upload_id == upload_id, StoppageEvent.is_valid == True
    ).count()

    # Classification breakdown (event-level)
    event_class = (
        db.query(
            StoppageEvent.classification,
            func.count(StoppageEvent.id),
        )
        .filter(StoppageEvent.upload_id == upload_id, StoppageEvent.is_valid == True)
        .group_by(StoppageEvent.classification)
        .all()
    )

    # Cluster counts at requested radius
    total_clusters = db.query(Cluster).filter(
        Cluster.upload_id == upload_id, Cluster.radius_meters == radius_m
    ).count()

    cluster_class = (
        db.query(
            Cluster.classification,
            func.count(Cluster.id),
        )
        .filter(Cluster.upload_id == upload_id, Cluster.radius_meters == radius_m)
        .group_by(Cluster.classification)
        .all()
    )

    distinct_trips = db.query(func.count(func.distinct(StoppageEvent.trip_id))).filter(
        StoppageEvent.upload_id == upload_id, StoppageEvent.is_valid == True
    ).scalar()

    distinct_routes = db.query(func.count(func.distinct(StoppageEvent.route_code))).filter(
        StoppageEvent.upload_id == upload_id, StoppageEvent.is_valid == True
    ).scalar()

    return {
        "upload_id": upload_id,
        "filename": upload.filename if upload else None,
        "total_events": total_events,
        "valid_events": valid_events,
        "invalid_events": total_events - valid_events,
        "distinct_trips": distinct_trips,
        "distinct_routes": distinct_routes,
        "total_clusters": total_clusters,
        "radius_m": radius_m,
        "event_classification": {row[0] or "unclassified": row[1] for row in event_class},
        "cluster_classification": {row[0] or "unclassified": row[1] for row in cluster_class},
    }


@router.get("/analytics/top-clusters")
def get_top_clusters(
    upload_id: int = Query(...),
    radius_m: int = Query(500),
    classification: str | None = Query(None),
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
):
    """Top clusters by event count."""
    q = db.query(Cluster).filter(
        Cluster.upload_id == upload_id,
        Cluster.radius_meters == radius_m,
    )
    if classification:
        q = q.filter(Cluster.classification == classification)

    clusters = q.order_by(Cluster.event_count.desc()).limit(limit).all()

    return {
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
                "peak_hour": c.peak_hour,
                "night_halt_pct": c.night_halt_pct,
            }
            for c in clusters
        ]
    }


@router.get("/analytics/poi-breakdown")
def get_poi_breakdown(
    upload_id: int = Query(...),
    radius_m: int = Query(500),
    db: Session = Depends(get_db),
):
    """Breakdown of clusters by POI type."""
    rows = (
        db.query(
            Cluster.poi_type,
            func.count(Cluster.id).label("cluster_count"),
            func.sum(Cluster.event_count).label("total_events"),
        )
        .filter(Cluster.upload_id == upload_id, Cluster.radius_meters == radius_m)
        .group_by(Cluster.poi_type)
        .order_by(func.sum(Cluster.event_count).desc())
        .all()
    )

    return {
        "breakdown": [
            {
                "poi_type": row[0] or "No POI",
                "cluster_count": row[1],
                "total_events": row[2],
            }
            for row in rows
        ]
    }


@router.get("/analytics/hourly")
def get_hourly_distribution(
    upload_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Hour-of-day distribution of stoppage events."""
    rows = (
        db.query(
            extract("hour", StoppageEvent.event_timestamp).label("hour"),
            func.count(StoppageEvent.id),
        )
        .filter(
            StoppageEvent.upload_id == upload_id,
            StoppageEvent.is_valid == True,
            StoppageEvent.event_timestamp.isnot(None),
        )
        .group_by("hour")
        .order_by("hour")
        .all()
    )

    # Fill all 24 hours
    hour_map = {int(r[0]): r[1] for r in rows if r[0] is not None}
    distribution = [{"hour": h, "count": hour_map.get(h, 0)} for h in range(24)]

    return {"distribution": distribution}


@router.get("/analytics/route-breakdown")
def get_route_breakdown(
    upload_id: int = Query(...),
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
):
    """Top routes by stoppage count."""
    rows = (
        db.query(
            StoppageEvent.route_code,
            func.count(StoppageEvent.id).label("event_count"),
            func.count(func.distinct(StoppageEvent.trip_id)).label("trip_count"),
        )
        .filter(
            StoppageEvent.upload_id == upload_id,
            StoppageEvent.is_valid == True,
        )
        .group_by(StoppageEvent.route_code)
        .order_by(func.count(StoppageEvent.id).desc())
        .limit(limit)
        .all()
    )

    return {
        "routes": [
            {
                "route_code": row[0],
                "event_count": row[1],
                "trip_count": row[2],
            }
            for row in rows
        ]
    }
