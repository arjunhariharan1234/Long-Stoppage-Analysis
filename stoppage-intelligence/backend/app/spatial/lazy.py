import logging
import threading

from app.config import POI_CSV_PATH
from app.spatial.index import POISpatialIndex

logger = logging.getLogger(__name__)

_poi_index: POISpatialIndex | None = None
_poi_lock = threading.Lock()


def get_poi_index() -> POISpatialIndex:
    """Lazy-load the POI spatial index on first use."""
    global _poi_index
    if _poi_index is None:
        with _poi_lock:
            if _poi_index is None:
                logger.info("Loading POI spatial index (first use)...")
                _poi_index = POISpatialIndex(POI_CSV_PATH)
                logger.info("POI index loaded: %d entries.", len(_poi_index.pois))
    return _poi_index


def is_poi_loaded() -> bool:
    return _poi_index is not None


def get_poi_count() -> int:
    return len(_poi_index.pois) if _poi_index is not None else 0
