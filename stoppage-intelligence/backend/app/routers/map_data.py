import logging
from collections import Counter

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import Cluster, StoppageEvent

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
    """Return clusters as GeoJSON FeatureCollection with top route codes."""
    q = db.query(Cluster).filter(
        Cluster.upload_id == upload_id,
        Cluster.radius_meters == radius_m,
    )
    if classification:
        q = q.filter(Cluster.classification == classification)
    if poi_type:
        q = q.filter(Cluster.poi_type == poi_type)

    clusters = q.all()

    # For 500m clusters (which have event assignments), get top routes per cluster
    cluster_ids = [c.id for c in clusters if radius_m == 500]
    route_map: dict[int, list[tuple[str, int]]] = {}

    if cluster_ids:
        # Query top routes per cluster in one go
        route_rows = (
            db.query(
                StoppageEvent.cluster_id,
                StoppageEvent.route_code,
                func.count(StoppageEvent.id).label("cnt"),
            )
            .filter(
                StoppageEvent.cluster_id.in_(cluster_ids),
                StoppageEvent.route_code.isnot(None),
            )
            .group_by(StoppageEvent.cluster_id, StoppageEvent.route_code)
            .order_by(StoppageEvent.cluster_id, func.count(StoppageEvent.id).desc())
            .all()
        )

        for cid, route, cnt in route_rows:
            if cid not in route_map:
                route_map[cid] = []
            if len(route_map[cid]) < 3:  # top 3 routes
                route_map[cid].append((route, cnt))

    features = []
    for c in clusters:
        top_routes = route_map.get(c.id, [])
        # Extract dispatch branch from route codes (prefix before '-')
        branches = []
        for route, cnt in top_routes:
            branch = route.split("-")[0] if "-" in route else route
            branches.append(branch)
        unique_branches = list(dict.fromkeys(branches))  # dedupe preserving order

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
                "top_routes": [r[0] for r in top_routes],
                "top_route_counts": [r[1] for r in top_routes],
                "dispatch_branches": unique_branches,
                "route_label": " | ".join(
                    f"{r[0]}({r[1]})" for r in top_routes
                ) if top_routes else "",
                "branch_label": " | ".join(unique_branches) if unique_branches else "",
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }
