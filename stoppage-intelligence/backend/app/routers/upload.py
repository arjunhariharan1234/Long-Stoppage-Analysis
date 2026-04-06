import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import UPLOAD_DIR, CLUSTER_RADII_M
from app.database import get_db
from app.models import Upload, StoppageEvent, Cluster
from app.services.ingest import (
    parse_file, detect_column_mapping, validate_mapping, normalize_events,
)
from app.services.clustering import cluster_stoppages
from app.services.poi_lookup import enrich_events, enrich_clusters

logger = logging.getLogger(__name__)
router = APIRouter(tags=["upload"])


@router.post("/upload")
def upload_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload a stoppage file. Returns proposed column mapping and preview."""
    # Validate extension
    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".xlsx", ".csv", ".tsv"):
        raise HTTPException(400, f"Unsupported file type: {suffix}. Use .xlsx or .csv")

    # Save to disk
    dest = UPLOAD_DIR / file.filename
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    logger.info("Saved upload to %s", dest)

    # Parse and detect schema
    try:
        df = parse_file(dest)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse file: {e}")

    columns = list(df.columns)
    proposed_mapping = detect_column_mapping(columns)
    warnings = validate_mapping(proposed_mapping)

    # Preview rows (first 5, as dicts)
    preview = df.head(5).fillna("").to_dict(orient="records")

    # Create upload record
    upload = Upload(
        filename=file.filename,
        row_count=len(df),
        status="pending",
        column_mapping=proposed_mapping,
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)

    return {
        "upload_id": upload.id,
        "filename": file.filename,
        "row_count": len(df),
        "columns": columns,
        "proposed_mapping": proposed_mapping,
        "warnings": warnings,
        "preview": preview,
    }


@router.post("/upload/{upload_id}/confirm")
def confirm_and_process(
    upload_id: int,
    request: Request,
    mapping_override: dict[str, str] | None = None,
    db: Session = Depends(get_db),
):
    """Confirm column mapping and process the file: normalize → store events."""
    upload = db.query(Upload).filter(Upload.id == upload_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found")
    if upload.status not in ("pending", "error"):
        raise HTTPException(400, f"Upload already in status: {upload.status}")

    upload.status = "processing"
    db.commit()

    try:
        # Use override mapping if provided, else use auto-detected
        mapping = mapping_override or upload.column_mapping
        upload.column_mapping = mapping
        logger.info("Processing upload %d (%s) with mapping: %s", upload.id, upload.filename, mapping)

        # Parse file
        file_path = UPLOAD_DIR / upload.filename
        df = parse_file(file_path)

        # Normalize
        normalized = normalize_events(df, mapping)

        valid_count = int(normalized["is_valid"].sum())
        invalid_count = int((~normalized["is_valid"]).sum())

        # Store events in database
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

        logger.info(
            "Upload %d: %d valid, %d invalid events stored. Starting clustering...",
            upload.id, valid_count, invalid_count,
        )

        # --- Clustering ---
        # Reload valid events from DB to get their IDs
        db_events = (
            db.query(StoppageEvent)
            .filter(StoppageEvent.upload_id == upload.id, StoppageEvent.is_valid == True)
            .all()
        )
        import pandas as pd
        events_df = pd.DataFrame([{
            "db_id": e.id,
            "lat": e.lat,
            "lon": e.lon,
            "trip_id": e.trip_id,
            "route_code": e.route_code,
            "event_timestamp": e.event_timestamp,
        } for e in db_events])

        cluster_summary = {}
        for radius_m in CLUSTER_RADII_M:
            clusters_result, labels = cluster_stoppages(events_df, radius_m=radius_m)

            for cr in clusters_result:
                cluster_obj = Cluster(
                    upload_id=upload.id,
                    radius_meters=radius_m,
                    centroid_lat=cr.centroid_lat,
                    centroid_lon=cr.centroid_lon,
                    event_count=cr.event_count,
                    distinct_trips=cr.distinct_trips,
                    distinct_routes=cr.distinct_routes,
                    first_seen=cr.first_seen,
                    last_seen=cr.last_seen,
                    peak_hour=cr.peak_hour,
                    night_halt_pct=cr.night_halt_pct,
                )
                db.add(cluster_obj)
                db.flush()  # get cluster_obj.id

                # Assign events to cluster
                event_db_ids = [int(events_df.iloc[i]["db_id"]) for i in cr.event_indices]
                if radius_m == 500:  # default radius: assign cluster_id on events
                    db.query(StoppageEvent).filter(
                        StoppageEvent.id.in_(event_db_ids)
                    ).update({StoppageEvent.cluster_id: cluster_obj.id}, synchronize_session=False)

            cluster_summary[radius_m] = len(clusters_result)
            logger.info("Clustering at %dm: %d clusters", radius_m, len(clusters_result))

        db.commit()

        # --- POI Enrichment + Classification ---
        from app.spatial.lazy import get_poi_index
        poi_index = get_poi_index()

        logger.info("Enriching events with POI data...")
        event_stats = enrich_events(db, upload.id, poi_index)

        logger.info("Enriching clusters with POI data...")
        cluster_stats = enrich_clusters(db, upload.id, poi_index)

        upload.status = "complete"
        db.commit()

        return {
            "upload_id": upload.id,
            "status": "complete",
            "total_rows": upload.row_count,
            "valid_events": valid_count,
            "invalid_events": invalid_count,
            "clusters": cluster_summary,
            "event_classification": event_stats,
            "cluster_classification": cluster_stats,
            "message": f"Processed {valid_count} events → clustered → enriched → classified",
        }

    except Exception as e:
        logger.exception("Failed to process upload %d", upload.id)
        upload.status = "error"
        upload.error_message = str(e)
        db.commit()
        raise HTTPException(500, f"Processing failed: {e}")


@router.get("/uploads")
def list_uploads(db: Session = Depends(get_db)):
    """List all uploads with status."""
    uploads = db.query(Upload).order_by(Upload.uploaded_at.desc()).all()
    return {
        "uploads": [
            {
                "id": u.id,
                "filename": u.filename,
                "uploaded_at": u.uploaded_at.isoformat() if u.uploaded_at else None,
                "row_count": u.row_count,
                "valid_row_count": u.valid_row_count,
                "invalid_row_count": u.invalid_row_count,
                "status": u.status,
            }
            for u in uploads
        ]
    }


@router.get("/uploads/{upload_id}")
def get_upload(upload_id: int, db: Session = Depends(get_db)):
    """Get upload details including event counts."""
    upload = db.query(Upload).filter(Upload.id == upload_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found")

    event_count = db.query(StoppageEvent).filter(StoppageEvent.upload_id == upload_id).count()
    valid_events = db.query(StoppageEvent).filter(
        StoppageEvent.upload_id == upload_id, StoppageEvent.is_valid == True
    ).count()

    return {
        "id": upload.id,
        "filename": upload.filename,
        "uploaded_at": upload.uploaded_at.isoformat() if upload.uploaded_at else None,
        "row_count": upload.row_count,
        "valid_row_count": upload.valid_row_count,
        "invalid_row_count": upload.invalid_row_count,
        "status": upload.status,
        "column_mapping": upload.column_mapping,
        "total_events_in_db": event_count,
        "valid_events_in_db": valid_events,
    }
