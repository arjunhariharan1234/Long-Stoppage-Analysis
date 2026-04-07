import logging
import os
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import insert
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session

from app.config import UPLOAD_DIR, DEFAULT_CLUSTER_RADIUS_M, KNOWN_FUNCTIONAL_POI_TYPES, KNOWN_FUNCTIONAL_MAX_DISTANCE_M
from app.database import get_db
from app.models import Upload, StoppageEvent, Cluster
from app.services.ingest import (
    parse_file, detect_column_mapping, validate_mapping, normalize_events,
)
from app.services.clustering import cluster_stoppages

logger = logging.getLogger(__name__)
router = APIRouter(tags=["upload"])

# POI columns that may already exist in uploaded files
_POI_COL_MAP = {
    "poi_name": "nearest_poi_name",
    "poi_amenity_type": "nearest_poi_type",
    "poi_lat": "nearest_poi_lat",
    "poi_lon": "nearest_poi_lon",
    "distance_to_poi_m": "nearest_poi_distance_m",
}


def _classify_series(poi_type: pd.Series, distance: pd.Series) -> pd.Series:
    """Vectorized classification."""
    lower = poi_type.fillna("").str.strip().str.lower()
    no_poi = lower.isin({"no poi within 2km", "", "unidentified"}) | poi_type.isna()
    known = lower.isin(KNOWN_FUNCTIONAL_POI_TYPES) & (distance.fillna(9999) <= KNOWN_FUNCTIONAL_MAX_DISTANCE_M)
    out = pd.Series("other_legit", index=poi_type.index)
    out[no_poi] = "unauthorized"
    out[known & ~no_poi] = "known_functional"
    return out


def _run_pipeline(upload: Upload, df: pd.DataFrame, mapping: dict, db: Session):
    """Lightweight pipeline: normalize → bulk insert → cluster at 500m only.
    Skips POI enrichment to stay within Render 512MB RAM.
    If the file already has POI columns, uses them directly."""
    upload.status = "processing"
    upload.column_mapping = mapping
    db.commit()

    logger.info("Processing upload %d (%s)", upload.id, upload.filename)

    # Normalize
    normalized = normalize_events(df, mapping)
    valid_count = int(normalized["is_valid"].sum())
    invalid_count = int((~normalized["is_valid"]).sum())

    # Check if file already has POI data
    has_poi = "poi_name" in df.columns or "poi_amenity_type" in df.columns
    if has_poi:
        logger.info("File has POI columns — using pre-enriched data")
        for src, dst in _POI_COL_MAP.items():
            if src in df.columns:
                normalized[dst] = df[src].values[:len(normalized)]
        normalized["classification"] = _classify_series(
            normalized.get("nearest_poi_type", pd.Series(dtype=str)),
            normalized.get("nearest_poi_distance_m", pd.Series(dtype=float)),
        )

    # Build records for bulk insert (vectorized, no iterrows)
    normalized["upload_id"] = upload.id
    cols = ["upload_id", "external_id", "trip_id", "route_code",
            "alert_id", "alert_name", "alert_status", "event_timestamp",
            "lat", "lon", "is_valid"]
    if has_poi:
        cols += ["nearest_poi_name", "nearest_poi_type", "nearest_poi_lat",
                 "nearest_poi_lon", "nearest_poi_distance_m", "classification"]

    insert_df = normalized[[c for c in cols if c in normalized.columns]].copy()
    insert_df = insert_df.where(insert_df.notna(), None)

    # Convert timestamps
    if "event_timestamp" in insert_df.columns and insert_df["event_timestamp"].dtype != object:
        insert_df["event_timestamp"] = insert_df["event_timestamp"].apply(
            lambda x: x.to_pydatetime() if pd.notna(x) else None
        )

    records = insert_df.to_dict(orient="records")
    for i in range(0, len(records), 5000):
        db.execute(insert(StoppageEvent.__table__), records[i:i+5000])
    db.flush()
    db.commit()

    upload.valid_row_count = valid_count
    upload.invalid_row_count = invalid_count

    logger.info("Inserted %d events. Clustering at 500m...", len(records))

    # --- Clustering at 500m only ---
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

    radius_m = DEFAULT_CLUSTER_RADIUS_M
    clusters_result, labels = cluster_stoppages(events_df, radius_m=radius_m)

    for cr in clusters_result:
        cluster_obj = Cluster(
            upload_id=upload.id, radius_meters=radius_m,
            centroid_lat=cr.centroid_lat, centroid_lon=cr.centroid_lon,
            event_count=cr.event_count, distinct_trips=cr.distinct_trips,
            distinct_routes=cr.distinct_routes,
            first_seen=cr.first_seen, last_seen=cr.last_seen,
            peak_hour=cr.peak_hour, night_halt_pct=cr.night_halt_pct,
        )
        db.add(cluster_obj)
        db.flush()

        event_db_ids = [int(events_df.iloc[i]["db_id"]) for i in cr.event_indices]
        db.query(StoppageEvent).filter(
            StoppageEvent.id.in_(event_db_ids)
        ).update({StoppageEvent.cluster_id: cluster_obj.id}, synchronize_session=False)

    db.commit()
    logger.info("Created %d clusters at %dm", len(clusters_result), radius_m)

    # --- Lightweight POI enrichment (only if env allows it) ---
    event_stats = {}
    cluster_stats = {}
    if not has_poi and os.environ.get("ENABLE_POI", "0") == "1":
        try:
            from app.spatial.lazy import get_poi_index
            from app.services.poi_lookup import enrich_events, enrich_clusters
            poi_index = get_poi_index()
            event_stats = enrich_events(db, upload.id, poi_index)
            cluster_stats = enrich_clusters(db, upload.id, poi_index)
        except Exception:
            logger.exception("POI enrichment failed — skipping")

    upload.status = "complete"
    db.commit()

    return {
        "upload_id": upload.id,
        "status": "complete",
        "total_rows": upload.row_count,
        "valid_events": valid_count,
        "invalid_events": invalid_count,
        "clusters": {radius_m: len(clusters_result)},
        "event_classification": event_stats,
        "cluster_classification": cluster_stats,
        "message": f"Processed {valid_count} events → {len(clusters_result)} clusters",
    }


@router.post("/upload")
def upload_file(
    file: UploadFile = File(...),
    auto_process: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Upload a stoppage file. Returns proposed column mapping and preview.
    If auto_process=true, runs the full pipeline in one request."""
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

    if auto_process:
        try:
            result = _run_pipeline(upload, df, proposed_mapping, db)
            result["columns"] = columns
            result["proposed_mapping"] = proposed_mapping
            result["warnings"] = warnings
            result["preview"] = preview
            return result
        except Exception as e:
            logger.exception("Failed to process upload %d", upload.id)
            upload.status = "error"
            upload.error_message = str(e)
            db.commit()
            raise HTTPException(500, f"Processing failed: {e}")

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

    try:
        mapping = mapping_override or upload.column_mapping
        file_path = UPLOAD_DIR / upload.filename
        df = parse_file(file_path)
        return _run_pipeline(upload, df, mapping, db)
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
