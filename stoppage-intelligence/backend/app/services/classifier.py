import logging

from app.config import KNOWN_FUNCTIONAL_POI_TYPES, KNOWN_FUNCTIONAL_MAX_DISTANCE_M
from app.spatial.index import POIMatch

logger = logging.getLogger(__name__)


def classify_stop(poi_match: POIMatch | None) -> str:
    """Classify a stoppage based on its nearest POI match.

    Returns: 'known_functional', 'other_legit', or 'unauthorized'
    """
    if poi_match is None:
        return "unauthorized"

    if (
        poi_match.resolved_type in KNOWN_FUNCTIONAL_POI_TYPES
        and poi_match.distance_m <= KNOWN_FUNCTIONAL_MAX_DISTANCE_M
    ):
        return "known_functional"

    # POI exists within search radius but is non-logistics or beyond 500m
    return "other_legit"
