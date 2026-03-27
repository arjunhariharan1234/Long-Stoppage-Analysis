import logging

from sqlalchemy.orm import Session

from app.models import StoppageEvent, Cluster
from app.spatial.index import POISpatialIndex
from app.services.classifier import classify_stop

logger = logging.getLogger(__name__)


def enrich_events(
    db: Session,
    upload_id: int,
    poi_index: POISpatialIndex,
    batch_size: int = 1000,
) -> dict:
    """Enrich all valid events for an upload with nearest POI + classification."""
    events = (
        db.query(StoppageEvent)
        .filter(StoppageEvent.upload_id == upload_id, StoppageEvent.is_valid == True)
        .all()
    )

    total = len(events)
    logger.info("Enriching %d events with POI data...", total)

    stats = {"known_functional": 0, "other_legit": 0, "unauthorized": 0}
    updates = []

    for i, event in enumerate(events):
        match = poi_index.query_nearest(event.lat, event.lon)

        event.nearest_poi_name = match.name if match else None
        event.nearest_poi_type = match.resolved_type if match else None
        event.nearest_poi_lat = match.lat if match else None
        event.nearest_poi_lon = match.lon if match else None
        event.nearest_poi_distance_m = round(match.distance_m, 1) if match else None
        event.poi_match_radius_m = match.match_radius_m if match else None

        classification = classify_stop(match)
        event.classification = classification
        stats[classification] += 1

        if (i + 1) % batch_size == 0:
            db.flush()
            logger.info("  Enriched %d / %d events...", i + 1, total)

    db.flush()
    logger.info(
        "Event enrichment complete: %d known_functional, %d other_legit, %d unauthorized",
        stats["known_functional"], stats["other_legit"], stats["unauthorized"],
    )
    return stats


def enrich_clusters(
    db: Session,
    upload_id: int,
    poi_index: POISpatialIndex,
) -> dict:
    """Enrich all clusters for an upload with nearest POI + classification."""
    clusters = (
        db.query(Cluster)
        .filter(Cluster.upload_id == upload_id)
        .all()
    )

    logger.info("Enriching %d clusters with POI data...", len(clusters))

    stats = {"known_functional": 0, "other_legit": 0, "unauthorized": 0}

    for cluster in clusters:
        match = poi_index.query_nearest(cluster.centroid_lat, cluster.centroid_lon)

        cluster.poi_name = match.name if match else None
        cluster.poi_type = match.resolved_type if match else None
        cluster.poi_lat = match.lat if match else None
        cluster.poi_lon = match.lon if match else None
        cluster.poi_distance_m = round(match.distance_m, 1) if match else None
        cluster.poi_match_radius_m = match.match_radius_m if match else None

        classification = classify_stop(match)
        cluster.classification = classification
        stats[classification] += 1

    db.flush()
    logger.info(
        "Cluster enrichment complete: %d known_functional, %d other_legit, %d unauthorized",
        stats["known_functional"], stats["other_legit"], stats["unauthorized"],
    )
    return stats
