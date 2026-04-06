"""
Seed script — pre-loads the JSW Steel enriched stoppage data into the database.

Designed for speed: vectorised pandas operations + bulk inserts.
Target: <30 s for ~75 K rows.
"""

import logging
import time
from datetime import datetime

import numpy as np
import pandas as pd
from sqlalchemy import insert

from app.config import (
    SEED_DATA_PATH,
    KNOWN_FUNCTIONAL_POI_TYPES,
    KNOWN_FUNCTIONAL_MAX_DISTANCE_M,
    DEFAULT_CLUSTER_RADIUS_M,
)
from app.database import SessionLocal
from app.models import Upload, StoppageEvent, Cluster
from app.services.clustering import cluster_stoppages

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Column mapping: xlsx column -> model field
# ---------------------------------------------------------------------------
_COL_MAP = {
    "Unique ID": "external_id",
    "Trip Id": "trip_id",
    "Route Code": "route_code",
    "zoho_alert_combined_view__ID": "alert_id",
    "zoho_alert_combined_view__ALERT_NAME": "alert_name",
    "zoho_alert_combined_view__CURRENT_LAT": "lat",
    "zoho_alert_combined_view__CURRENT_LONG": "lon",
    "Combined Created At": "event_timestamp",
    "poi_name": "nearest_poi_name",
    "poi_amenity_type": "nearest_poi_type",
    "poi_lat": "nearest_poi_lat",
    "poi_lon": "nearest_poi_lon",
    "distance_to_poi_m": "nearest_poi_distance_m",
}


def _classify_vectorised(poi_type: pd.Series, distance: pd.Series) -> pd.Series:
    """Return classification Series using fully vectorised logic."""
    poi_type_lower = poi_type.fillna("").str.strip().str.lower()

    is_no_poi = (
        poi_type_lower.isin({"no poi within 2km", ""})
        | poi_type.isna()
    )

    is_known_type = poi_type_lower.isin(KNOWN_FUNCTIONAL_POI_TYPES)
    within_range = distance.fillna(9999) <= KNOWN_FUNCTIONAL_MAX_DISTANCE_M

    classification = pd.Series("other_legit", index=poi_type.index)
    classification = classification.where(~is_no_poi, "unauthorized")
    classification = classification.where(
        ~(is_known_type & within_range) | is_no_poi, "known_functional"
    )

    return classification


def _bulk_insert(db, table, records: list[dict], chunk_size: int = 5000) -> None:
    """Insert records in chunks to avoid SQLite variable limit."""
    for i in range(0, len(records), chunk_size):
        db.execute(insert(table), records[i : i + chunk_size])
    db.flush()


def seed_if_empty() -> None:
    """Load JSW Steel enriched data into the DB if no uploads exist yet."""
    db = SessionLocal()
    try:
        existing = db.query(Upload).count()
        if existing > 0:
            logger.info("Database already has %d upload(s) — skipping seed.", existing)
            return

        t0 = time.perf_counter()
        logger.info("Seeding database from %s ...", SEED_DATA_PATH)

        # ------------------------------------------------------------------
        # 1. Read the xlsx file
        # ------------------------------------------------------------------
        t_read = time.perf_counter()
        if SEED_DATA_PATH.endswith((".csv", ".csv.gz")):
            df = pd.read_csv(SEED_DATA_PATH)
        else:
            df = pd.read_excel(SEED_DATA_PATH, engine="openpyxl")
        logger.info(
            "Read %d rows in %.1f s", len(df), time.perf_counter() - t_read
        )

        # ------------------------------------------------------------------
        # 2. Create Upload record
        # ------------------------------------------------------------------
        upload = Upload(
            filename="jsw_steel_long_stoppages.xlsx",
            uploaded_at=datetime.utcnow(),
            row_count=len(df),
            status="complete",
        )
        db.add(upload)
        db.flush()  # get upload.id
        upload_id = upload.id

        # ------------------------------------------------------------------
        # 3. Rename columns and build events DataFrame
        # ------------------------------------------------------------------
        ev = df.rename(columns=_COL_MAP)

        # Parse event_timestamp
        ev["event_timestamp"] = pd.to_datetime(
            ev["event_timestamp"], errors="coerce"
        )

        # Validity: lat/lon must exist
        ev["is_valid"] = ev["lat"].notna() & ev["lon"].notna()

        # Handle unnamed POIs: NaN name + valid type -> "Unnamed {type}"
        has_type = (
            ev["nearest_poi_type"].notna()
            & ~ev["nearest_poi_type"].str.strip().str.lower().isin(
                {"no poi within 2km", ""}
            )
        )
        unnamed_mask = ev["nearest_poi_name"].isna() & has_type
        ev.loc[unnamed_mask, "nearest_poi_name"] = (
            "Unnamed " + ev.loc[unnamed_mask, "nearest_poi_type"].astype(str)
        )

        # Classification (vectorised)
        ev["classification"] = _classify_vectorised(
            ev["nearest_poi_type"], ev["nearest_poi_distance_m"]
        )

        # poi_match_radius_m: the search radius that found the POI (use distance bucket)
        ev["poi_match_radius_m"] = np.where(
            ev["nearest_poi_distance_m"].isna(), None,
            np.where(ev["nearest_poi_distance_m"] <= 200, 200,
            np.where(ev["nearest_poi_distance_m"] <= 500, 500,
            np.where(ev["nearest_poi_distance_m"] <= 1000, 1000, 2000)))
        )

        ev["upload_id"] = upload_id

        # Select only model fields
        event_fields = [
            "upload_id", "external_id", "trip_id", "route_code",
            "alert_id", "alert_name", "event_timestamp",
            "lat", "lon", "is_valid",
            "nearest_poi_name", "nearest_poi_type",
            "nearest_poi_lat", "nearest_poi_lon", "nearest_poi_distance_m",
            "poi_match_radius_m", "classification",
        ]
        ev_insert = ev[event_fields].copy()

        # Replace NaN/NaT with None for SQLite compatibility
        ev_insert = ev_insert.where(ev_insert.notna(), None)

        # Convert timestamps to Python datetime
        if ev_insert["event_timestamp"].dtype != object:
            ev_insert["event_timestamp"] = ev_insert["event_timestamp"].apply(
                lambda x: x.to_pydatetime() if pd.notna(x) else None
            )

        valid_count = int(ev["is_valid"].sum())
        invalid_count = len(ev) - valid_count
        upload.valid_row_count = valid_count
        upload.invalid_row_count = invalid_count

        # ------------------------------------------------------------------
        # 4. Bulk insert events
        # ------------------------------------------------------------------
        t_ins = time.perf_counter()
        records = ev_insert.to_dict(orient="records")
        _bulk_insert(db, StoppageEvent.__table__, records)
        db.commit()
        logger.info(
            "Inserted %d events in %.1f s", len(records), time.perf_counter() - t_ins
        )

        # ------------------------------------------------------------------
        # 5. Cluster at 500 m only
        # ------------------------------------------------------------------
        t_clust = time.perf_counter()
        valid_ev = ev[ev["is_valid"]].copy()
        valid_ev = valid_ev.reset_index(drop=True)

        cluster_results, label_series = cluster_stoppages(
            valid_ev, radius_m=DEFAULT_CLUSTER_RADIUS_M
        )
        logger.info(
            "Clustering produced %d clusters in %.1f s",
            len(cluster_results), time.perf_counter() - t_clust,
        )

        # ------------------------------------------------------------------
        # 6. Build cluster records with majority classification
        # ------------------------------------------------------------------
        if cluster_results:
            cluster_records = []
            # We need to map DBSCAN cluster labels back to event DB IDs.
            # Events were inserted in order; fetch their IDs.
            event_ids = [
                r[0]
                for r in db.query(StoppageEvent.id)
                .filter(StoppageEvent.upload_id == upload_id)
                .order_by(StoppageEvent.id)
                .all()
            ]
            # Build a mapping from valid_ev index to event DB id.
            # valid_ev was built from ev[is_valid] — we need the original df indices.
            valid_mask = ev["is_valid"].values
            valid_positions = np.where(valid_mask)[0]  # positions in original ev

            for cr in cluster_results:
                # Majority classification
                cluster_classifications = valid_ev.loc[
                    cr.event_indices, "classification"
                ]
                majority_class = cluster_classifications.mode().iloc[0]

                # Majority POI info
                cluster_poi_types = valid_ev.loc[
                    cr.event_indices, "nearest_poi_type"
                ].dropna()
                if len(cluster_poi_types) > 0:
                    poi_type = cluster_poi_types.mode().iloc[0]
                else:
                    poi_type = None

                cluster_poi_names = valid_ev.loc[
                    cr.event_indices, "nearest_poi_name"
                ].dropna()
                poi_name = cluster_poi_names.mode().iloc[0] if len(cluster_poi_names) > 0 else None

                cluster_poi_dist = valid_ev.loc[
                    cr.event_indices, "nearest_poi_distance_m"
                ].dropna()
                poi_dist = float(cluster_poi_dist.median()) if len(cluster_poi_dist) > 0 else None

                # Nearest POI lat/lon (from centroid's closest event)
                cluster_poi_lat = valid_ev.loc[
                    cr.event_indices, "nearest_poi_lat"
                ].dropna()
                poi_lat = float(cluster_poi_lat.median()) if len(cluster_poi_lat) > 0 else None

                cluster_poi_lon = valid_ev.loc[
                    cr.event_indices, "nearest_poi_lon"
                ].dropna()
                poi_lon = float(cluster_poi_lon.median()) if len(cluster_poi_lon) > 0 else None

                cluster_records.append({
                    "upload_id": upload_id,
                    "radius_meters": DEFAULT_CLUSTER_RADIUS_M,
                    "centroid_lat": cr.centroid_lat,
                    "centroid_lon": cr.centroid_lon,
                    "event_count": cr.event_count,
                    "distinct_trips": cr.distinct_trips,
                    "distinct_routes": cr.distinct_routes,
                    "poi_name": poi_name,
                    "poi_type": poi_type,
                    "poi_lat": poi_lat,
                    "poi_lon": poi_lon,
                    "poi_distance_m": poi_dist,
                    "poi_match_radius_m": DEFAULT_CLUSTER_RADIUS_M,
                    "classification": majority_class,
                    "first_seen": cr.first_seen.to_pydatetime() if cr.first_seen and pd.notna(cr.first_seen) else None,
                    "last_seen": cr.last_seen.to_pydatetime() if cr.last_seen and pd.notna(cr.last_seen) else None,
                    "peak_hour": cr.peak_hour,
                    "night_halt_pct": cr.night_halt_pct,
                })

            t_cins = time.perf_counter()
            _bulk_insert(db, Cluster.__table__, cluster_records)
            db.commit()
            logger.info(
                "Inserted %d clusters in %.1f s",
                len(cluster_records), time.perf_counter() - t_cins,
            )

            # ------------------------------------------------------------------
            # 7. Assign cluster_id to events
            # ------------------------------------------------------------------
            t_assign = time.perf_counter()
            # Fetch cluster DB IDs in insertion order
            cluster_db_ids = [
                r[0]
                for r in db.query(Cluster.id)
                .filter(Cluster.upload_id == upload_id)
                .order_by(Cluster.id)
                .all()
            ]

            # Build update list: for each cluster, update its member events
            for cr, cluster_db_id in zip(cluster_results, cluster_db_ids):
                # Map valid_ev indices -> original ev positions -> event DB IDs
                member_db_ids = [event_ids[valid_positions[i]] for i in cr.event_indices]
                db.query(StoppageEvent).filter(
                    StoppageEvent.id.in_(member_db_ids)
                ).update(
                    {StoppageEvent.cluster_id: cluster_db_id},
                    synchronize_session=False,
                )

            db.commit()
            logger.info(
                "Assigned cluster IDs to events in %.1f s",
                time.perf_counter() - t_assign,
            )

        total = time.perf_counter() - t0
        logger.info(
            "Seed complete: %d events, %d clusters in %.1f s",
            len(records), len(cluster_results) if cluster_results else 0, total,
        )

    except Exception:
        db.rollback()
        logger.exception("Seed failed — continuing without seed data")
    finally:
        db.close()
