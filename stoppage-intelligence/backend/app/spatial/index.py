import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from app.config import EARTH_RADIUS_KM, POI_SEARCH_RADII_M

logger = logging.getLogger(__name__)


@dataclass
class POIMatch:
    name: str
    resolved_type: str
    lat: float
    lon: float
    distance_m: float
    match_radius_m: float


def _resolve_type_from_tags(row: pd.Series) -> str:
    """Determine POI type from OSM tags."""
    if pd.notna(row.get("amenity")):
        return row["amenity"]
    if pd.notna(row.get("shop")):
        return "shop_" + str(row["shop"])
    if pd.notna(row.get("tourism")):
        return "tourism_" + str(row["tourism"])
    if pd.notna(row.get("highway")):
        return row["highway"]
    if pd.notna(row.get("barrier")):
        return row["barrier"]
    if pd.notna(row.get("landuse")):
        return row["landuse"]
    if pd.notna(row.get("building")):
        return "building_" + str(row["building"])
    return "village/locality"


def _override_type_by_name(name: str, current_type: str) -> str:
    """Override POI type based on name keywords when OSM tags are missing or wrong."""
    if pd.isna(name):
        return current_type
    n = name.lower()

    # Fuel stations
    fuel_kw = [
        "petrol", "petroleum", "diesel", "fuel", "indian oil", "bharat petro",
        "hindustan petro", "hp petrol", "hpcl", "bpcl", "iocl",
        "filling station", "gas station", "petrol bunk", "petrol pump", "lpg gas",
    ]
    if any(k in n for k in fuel_kw) and current_type != "fuel":
        return "fuel"

    # Toll
    toll_kw = ["toll naka", "toll plaza", "toll booth", "toll gate", "toll office", "toll both"]
    if any(k in n for k in toll_kw) and current_type != "toll_booth":
        return "toll_booth"

    # Restaurants / Dhabas
    food_kw = [
        "dhaba", "restaurant", "biryani", "kitchen", "canteen",
        "mess ", "food", "bhojanalaya", "bhojanshala",
    ]
    if any(k in n for k in food_kw) and current_type not in (
        "restaurant", "fast_food", "cafe", "food_court"
    ):
        return "restaurant/dhaba"

    # Hotels (lodging)
    hotel_kw = ["hotel", "lodge", "resort", "guest house", "guesthouse", "hostel", "inn "]
    if any(k in n for k in hotel_kw) and current_type not in (
        "tourism_hotel", "tourism_guest_house", "tourism_hostel"
    ):
        return "hotel/lodge"

    # Hospitals / Clinics
    health_kw = ["hospital", "phc,", "phc ", "clinic", "medical", "dispensary", "health centre"]
    if any(k in n for k in health_kw) and current_type not in ("hospital", "clinic", "doctors"):
        return "hospital/clinic"

    # Banks / ATMs
    bank_kw = ["bank", "atm"]
    if any(k in n for k in bank_kw) and current_type not in ("bank", "atm"):
        return "bank/atm"

    # Industrial / Factory
    industry_kw = [
        "factory", "plant", "industries", "industrial", "warehouse",
        "cement", "steel", "manufacturing", "ltd", "limited", "pvt", "works",
    ]
    if any(k in n for k in industry_kw) and current_type != "industrial":
        return "industrial/factory"

    # Government / Checkpoints
    govt_kw = ["police", "rto ", "check post", "checkpost", "weigh bridge", "weighbridge"]
    if any(k in n for k in govt_kw):
        return "govt/checkpoint"

    return current_type


class POISpatialIndex:
    """In-memory spatial index over the India POI dataset using scipy cKDTree."""

    def __init__(self, csv_path: str):
        logger.info("Loading POI dataset from %s ...", csv_path)
        self.pois = pd.read_csv(csv_path)
        logger.info("Loaded %d POIs", len(self.pois))

        # Resolve types
        logger.info("Resolving POI types...")
        self.pois["resolved_type"] = self.pois.apply(_resolve_type_from_tags, axis=1)
        self.pois["resolved_type"] = self.pois.apply(
            lambda r: _override_type_by_name(r["name"], r["resolved_type"]), axis=1
        )

        # Build unnamed labels
        self.pois["display_name"] = self.pois.apply(self._build_display_name, axis=1)

        # Drop rows missing coordinates
        self._valid = self.pois.dropna(subset=["lat", "lon"]).copy().reset_index(drop=True)
        logger.info("Building cKDTree over %d valid POIs...", len(self._valid))

        coords = np.radians(self._valid[["lat", "lon"]].values)
        self._tree = cKDTree(coords)
        logger.info("POI spatial index ready.")

    @staticmethod
    def _build_display_name(row: pd.Series) -> str:
        name = row.get("name")
        if pd.notna(name) and str(name).strip():
            return str(name).strip()
        rtype = row.get("resolved_type", "unknown")
        return f"Unnamed {rtype.replace('_', ' ').replace('/', ' / ').title()}"

    def query_nearest(
        self, lat: float, lon: float, radii_m: list[float] | None = None
    ) -> POIMatch | None:
        """Find nearest POI using progressive radius search.

        Returns the nearest POI from the smallest radius that has results,
        or None if nothing found within the largest radius.
        """
        if radii_m is None:
            radii_m = POI_SEARCH_RADII_M

        point = np.radians([lat, lon])

        for radius_m in sorted(radii_m):
            radius_rad = (radius_m / 1000.0) / EARTH_RADIUS_KM
            indices = self._tree.query_ball_point(point, r=radius_rad)

            if indices:
                # Find the single nearest among candidates
                if len(indices) == 1:
                    idx = indices[0]
                    dist = self._haversine_distance(lat, lon, idx)
                else:
                    dists = [self._haversine_distance(lat, lon, i) for i in indices]
                    min_i = int(np.argmin(dists))
                    idx = indices[min_i]
                    dist = dists[min_i]

                poi_row = self._valid.iloc[idx]
                return POIMatch(
                    name=poi_row["display_name"],
                    resolved_type=poi_row["resolved_type"],
                    lat=float(poi_row["lat"]),
                    lon=float(poi_row["lon"]),
                    distance_m=dist,
                    match_radius_m=float(radius_m),
                )

        return None

    def query_all_within(self, lat: float, lon: float, radius_m: float) -> list[POIMatch]:
        """Return all POIs within a given radius."""
        point = np.radians([lat, lon])
        radius_rad = (radius_m / 1000.0) / EARTH_RADIUS_KM
        indices = self._tree.query_ball_point(point, r=radius_rad)

        results = []
        for idx in indices:
            dist = self._haversine_distance(lat, lon, idx)
            poi_row = self._valid.iloc[idx]
            results.append(POIMatch(
                name=poi_row["display_name"],
                resolved_type=poi_row["resolved_type"],
                lat=float(poi_row["lat"]),
                lon=float(poi_row["lon"]),
                distance_m=dist,
                match_radius_m=radius_m,
            ))

        results.sort(key=lambda m: m.distance_m)
        return results

    def _haversine_distance(self, lat1: float, lon1: float, poi_idx: int) -> float:
        """Haversine distance in meters between a point and a POI by index."""
        poi_row = self._valid.iloc[poi_idx]
        lat2, lon2 = poi_row["lat"], poi_row["lon"]

        lat1_r, lon1_r = np.radians(lat1), np.radians(lon1)
        lat2_r, lon2_r = np.radians(lat2), np.radians(lon2)

        dlat = lat2_r - lat1_r
        dlon = lon2_r - lon1_r

        a = np.sin(dlat / 2) ** 2 + np.cos(lat1_r) * np.cos(lat2_r) * np.sin(dlon / 2) ** 2
        c = 2 * np.arcsin(np.sqrt(a))

        return EARTH_RADIUS_KM * c * 1000  # meters
