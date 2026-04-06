import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Upload, StoppageEvent, Cluster
from app.config import CLUSTER_RADII_M
from app.services.databricks_connector import fetch_last_n_days, is_configured
from app.services.ingest import detect_column_mapping, normalize_events
from app.services.clustering import cluster_stoppages
from app.services.poi_lookup import enrich_events, enrich_clusters

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live"])


@router.get("/live/status")
def live_status():
    """Check if Databricks connector is configured."""
    return {
        "configured": is_configured(),
        "message": "Databricks SQL Warehouse is configured" if is_configured()
                   else "Set DATABRICKS_HOST, DATABRICKS_HTTP_PATH, DATABRICKS_TOKEN env vars",
    }


@router.post("/live/fetch")
def fetch_live_data(
    request: Request,
    days: int = Query(7, ge=1, le=90),
    customer_id: int = Query(1182),
    db: Session = Depends(get_db),
):
    """Fetch latest stoppage data from Databricks and run full pipeline."""
    if not is_configured():
        raise HTTPException(
            503,
            "Databricks SQL Warehouse not configured. "
            "Set DATABRICKS_HOST, DATABRICKS_HTTP_PATH, DATABRICKS_TOKEN.",
        )

    try:
        # Fetch from Databricks
        logger.info("Fetching last %d days for customer %d...", days, customer_id)
        df = fetch_last_n_days(days=days, customer_id=customer_id)

        if df.empty:
            return {"status": "empty", "message": "No data returned from Databricks for this period"}

        # Create upload record
        filename = f"live_customer_{customer_id}_{days}d.csv"
        upload = Upload(
            filename=filename,
            row_count=len(df),
            status="processing",
            column_mapping={},
        )
        db.add(upload)
        db.commit()
        db.refresh(upload)

        # Detect mapping and normalize
        columns = list(df.columns)
        mapping = detect_column_mapping(columns)
        upload.column_mapping = mapping

        normalized = normalize_events(df, mapping)
        valid_count = int(normalized["is_valid"].sum())
        invalid_count = int((~normalized["is_valid"]).sum())

        # Store events
        import pandas as pd
        events = []
        for _, row in normalized.iterrows():
            event = StoppageEvent(
                upload_id=upload.id,
                external_id=row.get("external_id"),
                trip_id=row.get("trip_id"),
                route_code=row.get("route_code"),
                alert_id=row.get("alert_id"),
                alert_name=row.get("alert_name"),
                alert_status=row.get("alert_status"),
                event_timestamp=row.get("event_timestamp") if row.get("event_timestamp") is not None and str(row.get("event_timestamp")) != "NaT" else None,
                lat=float(row["lat"]) if row["is_valid"] else None,
                lon=float(row["lon"]) if row["is_valid"] else None,
                is_valid=bool(row["is_valid"]),
            )
            events.append(event)

        db.bulk_save_objects(events)
        db.commit()

        upload.valid_row_count = valid_count
        upload.invalid_row_count = invalid_count

        # Clustering
        db_events = (
            db.query(StoppageEvent)
            .filter(StoppageEvent.upload_id == upload.id, StoppageEvent.is_valid == True)
            .all()
        )
        events_df = pd.DataFrame([{
            "db_id": e.id, "lat": e.lat, "lon": e.lon,
            "trip_id": e.trip_id, "route_code": e.route_code,
            "event_timestamp": e.event_timestamp,
        } for e in db_events])

        cluster_summary = {}
        for radius_m in CLUSTER_RADII_M:
            clusters_result, labels = cluster_stoppages(events_df, radius_m=radius_m)
            for cr in clusters_result:
                cluster_obj = Cluster(
                    upload_id=upload.id, radius_meters=radius_m,
                    centroid_lat=cr.centroid_lat, centroid_lon=cr.centroid_lon,
                    event_count=cr.event_count, distinct_trips=cr.distinct_trips,
                    distinct_routes=cr.distinct_routes, first_seen=cr.first_seen,
                    last_seen=cr.last_seen, peak_hour=cr.peak_hour,
                    night_halt_pct=cr.night_halt_pct,
                )
                db.add(cluster_obj)
                db.flush()
                event_db_ids = [int(events_df.iloc[i]["db_id"]) for i in cr.event_indices]
                if radius_m == 500:
                    db.query(StoppageEvent).filter(
                        StoppageEvent.id.in_(event_db_ids)
                    ).update({StoppageEvent.cluster_id: cluster_obj.id}, synchronize_session=False)
            cluster_summary[radius_m] = len(clusters_result)

        db.commit()

        # POI enrichment
        from app.spatial.lazy import get_poi_index
        poi_index = get_poi_index()
        event_stats = enrich_events(db, upload.id, poi_index)
        cluster_stats = enrich_clusters(db, upload.id, poi_index)

        upload.status = "complete"
        db.commit()

        return {
            "upload_id": upload.id,
            "status": "complete",
            "source": "databricks_live",
            "customer_id": customer_id,
            "days": days,
            "total_rows": len(df),
            "valid_events": valid_count,
            "invalid_events": invalid_count,
            "clusters": cluster_summary,
            "event_classification": event_stats,
            "cluster_classification": cluster_stats,
        }

    except Exception as e:
        logger.exception("Live fetch failed")
        if upload and upload.id:
            upload.status = "error"
            upload.error_message = str(e)
            db.commit()
        raise HTTPException(500, f"Live data fetch failed: {e}")
