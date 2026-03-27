import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

from app.config import DBSCAN_MIN_SAMPLES, EARTH_RADIUS_KM

logger = logging.getLogger(__name__)


@dataclass
class ClusterResult:
    cluster_label: int
    centroid_lat: float
    centroid_lon: float
    event_count: int
    distinct_trips: int
    distinct_routes: int
    first_seen: pd.Timestamp | None
    last_seen: pd.Timestamp | None
    peak_hour: int | None
    night_halt_pct: float
    event_indices: list[int]  # indices into the input DataFrame


def cluster_stoppages(
    events_df: pd.DataFrame,
    radius_m: int = 500,
    min_samples: int = DBSCAN_MIN_SAMPLES,
) -> tuple[list[ClusterResult], pd.Series]:
    """Cluster stoppage events using DBSCAN with haversine distance.

    Args:
        events_df: DataFrame with columns: lat, lon, trip_id, route_code, event_timestamp.
                   Must contain only valid rows (non-null lat/lon).
        radius_m: Cluster radius in meters.
        min_samples: Minimum events to form a cluster.

    Returns:
        (list of ClusterResult, Series of cluster labels indexed like events_df)
    """
    n = len(events_df)
    logger.info(
        "Clustering %d events at radius=%dm, min_samples=%d",
        n, radius_m, min_samples,
    )

    if n == 0:
        return [], pd.Series(dtype=int)

    # Prepare coordinates in radians for haversine
    coords = np.radians(events_df[["lat", "lon"]].values)
    eps_rad = (radius_m / 1000.0) / EARTH_RADIUS_KM

    db = DBSCAN(
        eps=eps_rad,
        min_samples=min_samples,
        algorithm="ball_tree",
        metric="haversine",
    )
    labels = db.fit_predict(coords)
    label_series = pd.Series(labels, index=events_df.index)

    unique_labels = set(labels)
    unique_labels.discard(-1)  # noise

    noise_count = int((labels == -1).sum())
    logger.info(
        "DBSCAN found %d clusters + %d noise points",
        len(unique_labels), noise_count,
    )

    # Build ClusterResult for each cluster
    clusters = []
    for label in sorted(unique_labels):
        mask = labels == label
        cluster_events = events_df[mask]
        idx_list = list(events_df.index[mask])

        centroid_lat = float(cluster_events["lat"].mean())
        centroid_lon = float(cluster_events["lon"].mean())
        event_count = int(mask.sum())

        distinct_trips = int(cluster_events["trip_id"].nunique())
        distinct_routes = int(cluster_events["route_code"].nunique())

        # Time intelligence
        ts = cluster_events["event_timestamp"].dropna()
        first_seen = ts.min() if len(ts) > 0 else None
        last_seen = ts.max() if len(ts) > 0 else None

        if len(ts) > 0:
            hours = ts.dt.hour
            peak_hour = int(hours.mode().iloc[0]) if len(hours.mode()) > 0 else None
            night_count = int(((hours >= 20) | (hours < 6)).sum())
            night_halt_pct = round(night_count / len(ts) * 100, 1)
        else:
            peak_hour = None
            night_halt_pct = 0.0

        clusters.append(ClusterResult(
            cluster_label=int(label),
            centroid_lat=centroid_lat,
            centroid_lon=centroid_lon,
            event_count=event_count,
            distinct_trips=distinct_trips,
            distinct_routes=distinct_routes,
            first_seen=first_seen,
            last_seen=last_seen,
            peak_hour=peak_hour,
            night_halt_pct=night_halt_pct,
            event_indices=idx_list,
        ))

    clusters.sort(key=lambda c: c.event_count, reverse=True)

    logger.info(
        "Cluster summary: %d clusters, largest=%d events, smallest=%d events",
        len(clusters),
        clusters[0].event_count if clusters else 0,
        clusters[-1].event_count if clusters else 0,
    )

    return clusters, label_series
