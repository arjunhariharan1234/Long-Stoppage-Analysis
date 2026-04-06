import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent.parent  # Long Stoppage Analysis directory

# Database
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{BASE_DIR / 'data' / 'stoppage_intelligence.db'}",
)

# POI dataset — use gzipped version if available (for deployment), else raw CSV
_default_poi = str(BASE_DIR / "data" / "india_all_pois.csv.gz")
if not os.path.exists(_default_poi):
    _default_poi = str(PROJECT_ROOT / "india_all_pois.csv")
POI_CSV_PATH = os.environ.get("POI_CSV_PATH", _default_poi)

# Upload directory
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(BASE_DIR / "data" / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Clustering defaults
CLUSTER_RADII_M = [200, 500, 1000, 2000]
DEFAULT_CLUSTER_RADIUS_M = 500
DBSCAN_MIN_SAMPLES = 5

# POI search radii (progressive, in meters)
POI_SEARCH_RADII_M = [200, 500, 1000, 2000]

# Classification: POI types considered "known functional" for logistics
KNOWN_FUNCTIONAL_POI_TYPES = {
    "fuel",
    "restaurant",
    "restaurant/dhaba",
    "fast_food",
    "cafe",
    "truck_stop",
    "rest_area",
    "parking",
    "toll_booth",
    "industrial",
    "industrial/factory",
    "warehouse",
    "charging_station",
    "gate",
}

# Max distance (meters) for "known functional" classification
KNOWN_FUNCTIONAL_MAX_DISTANCE_M = 500

EARTH_RADIUS_KM = 6371.0

# Seed data — pre-enriched JSW Steel stoppage file (prefer compressed CSV)
_default_seed = str(BASE_DIR / "data" / "jsw_steel_seed.csv.gz")
if not os.path.exists(_default_seed):
    _default_seed = str(PROJECT_ROOT / "jsw_steel_10months_with_poi.xlsx")
SEED_DATA_PATH = os.environ.get("SEED_DATA_PATH", _default_seed)
