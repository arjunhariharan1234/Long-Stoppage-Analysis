import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoppageEvent

logger = logging.getLogger(__name__)
router = APIRouter(tags=["events"])


@router.get("/events")
def list_events(
    upload_id: int = Query(...),
    classification: str | None = Query(None),
    route_code: str | None = Query(None),
    trip_id: str | None = Query(None),
    cluster_id: int | None = Query(None),
    valid_only: bool = Query(True),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    """Paginated list of stoppage events with filters."""
    q = db.query(StoppageEvent).filter(StoppageEvent.upload_id == upload_id)

    if valid_only:
        q = q.filter(StoppageEvent.is_valid == True)
    if classification:
        q = q.filter(StoppageEvent.classification == classification)
    if route_code:
        q = q.filter(StoppageEvent.route_code == route_code)
    if trip_id:
        q = q.filter(StoppageEvent.trip_id == trip_id)
    if cluster_id:
        q = q.filter(StoppageEvent.cluster_id == cluster_id)

    total = q.count()
    events = q.order_by(StoppageEvent.event_timestamp.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "events": [
            {
                "id": e.id,
                "external_id": e.external_id,
                "trip_id": e.trip_id,
                "route_code": e.route_code,
                "alert_id": e.alert_id,
                "alert_name": e.alert_name,
                "alert_status": e.alert_status,
                "event_timestamp": e.event_timestamp.isoformat() if e.event_timestamp else None,
                "lat": e.lat,
                "lon": e.lon,
                "nearest_poi_name": e.nearest_poi_name,
                "nearest_poi_type": e.nearest_poi_type,
                "nearest_poi_distance_m": e.nearest_poi_distance_m,
                "classification": e.classification,
                "cluster_id": e.cluster_id,
            }
            for e in events
        ],
    }
