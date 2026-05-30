"""Shared fixtures for brain tests."""
import json
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def cases_parsed():
    """Load the parsed confirmed-theft cases (ground truth)."""
    path = ROOT / "confirmed_thefts" / "cases_parsed.json"
    return json.loads(path.read_text())


@pytest.fixture
def sample_polyline():
    """A short, hand-known encoded polyline.
    Encodes: (26.7619, 80.8514), (26.7625, 80.8520), (26.7630, 80.8530).
    Verified via polyline.encode() — decode round-trips to the same points.
    """
    return "{|ibDghnlNwBwBcBgE"


@pytest.fixture
def sample_trip_row():
    """A synthetic trip row with the columns the brain reads."""
    return {
        "window_trip_id": 54223023,
        "vehicle_number_clean": "UP32QT2997",
        "window_driver_number": 7459901375,
        "window_driver_name": "Suraj",
        "window_transporter": "A&A Associates - Zepto",
        "window_origin": "LKO002M - LKO-DRY-MH MOHANLAL GANJ_1",
        "window_destination": "LKO005S - LKO-Aliganj",
        "window_distance_travelled_km": 92.31,
        "window_google_distance_km": 73.51,
        "window_transit_time_hrs": 3.0,
        "window_stoppage_hrs": 2.05,
        "window_unloading_time_hrs": 0.0,
        "window_geofence_breached": False,
        "window_total_pings": 120,
        "window_closure_mode": "manual",
        "window_auto_closure_type": None,
        "ping_count": 120,
        "ping_polyline": "{|ibDghnlNwBwBcBgE",
    }
