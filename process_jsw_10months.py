import pandas as pd
import numpy as np
from scipy.spatial import cKDTree
from tqdm import tqdm

EARTH_RADIUS_KM = 6371.0
SEARCH_RADIUS_KM = 2.0

INPUT_FILE = "jsw_steel_10months.csv"
POI_FILE = "india_all_pois.csv.gz"
OUTPUT_FILE = "jsw_steel_10months_with_poi.xlsx"


def determine_place_type(row):
    if pd.notna(row.get("amenity")) and row["amenity"] != "":
        return row["amenity"]
    if pd.notna(row.get("shop")) and row["shop"] != "":
        return row["shop"]
    if pd.notna(row.get("tourism")) and row["tourism"] != "":
        return "tourism_" + str(row["tourism"])
    if pd.notna(row.get("highway")) and row["highway"] != "":
        return row["highway"]
    if pd.notna(row.get("barrier")) and row["barrier"] != "":
        return row["barrier"]
    if pd.notna(row.get("landuse")) and row["landuse"] != "":
        return row["landuse"]
    if pd.notna(row.get("building")) and row["building"] != "":
        return row["building"]
    return "Unidentified"


def haversine_m(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * 1000 * np.arcsin(np.sqrt(a))


def main():
    print("Loading POIs...")
    pois = pd.read_csv(POI_FILE)
    pois = pois.dropna(subset=["lat", "lon"])
    pois["place_type"] = pois.apply(determine_place_type, axis=1)
    print(f"  {len(pois)} POIs loaded")

    print("Building spatial index...")
    poi_coords_rad = np.radians(pois[["lat", "lon"]].values)
    tree = cKDTree(poi_coords_rad)

    print("Loading stoppages...")
    df = pd.read_csv(INPUT_FILE)
    print(f"  {len(df)} stoppages loaded")

    # Drop rows with missing lat/lon
    df = df.dropna(subset=[
        "zoho_alert_combined_view__CURRENT_LAT",
        "zoho_alert_combined_view__CURRENT_LONG"
    ]).reset_index(drop=True)

    radius_rad = SEARCH_RADIUS_KM / EARTH_RADIUS_KM

    poi_names = pois["name"].values
    poi_types = pois["place_type"].values
    poi_lats = pois["lat"].values
    poi_lons = pois["lon"].values

    result_poi_name = []
    result_poi_type = []
    result_poi_lat = []
    result_poi_lon = []
    result_distance = []

    lats = df["zoho_alert_combined_view__CURRENT_LAT"].values
    lons = df["zoho_alert_combined_view__CURRENT_LONG"].values

    print("Finding nearest POIs...")
    for i in tqdm(range(len(df))):
        lat, lon = lats[i], lons[i]
        point_rad = np.radians([lat, lon])

        idxs = tree.query_ball_point(point_rad, r=radius_rad)

        if len(idxs) == 0:
            result_poi_name.append("No POI within 2km")
            result_poi_type.append("No POI within 2km")
            result_poi_lat.append(np.nan)
            result_poi_lon.append(np.nan)
            result_distance.append(np.nan)
        else:
            distances = np.array([
                haversine_m(lat, lon, poi_lats[j], poi_lons[j])
                for j in idxs
            ])
            nearest_idx = idxs[np.argmin(distances)]
            result_poi_name.append(poi_names[nearest_idx])
            result_poi_type.append(poi_types[nearest_idx])
            result_poi_lat.append(poi_lats[nearest_idx])
            result_poi_lon.append(poi_lons[nearest_idx])
            result_distance.append(round(np.min(distances), 1))

    df["poi_name"] = result_poi_name
    df["poi_amenity_type"] = result_poi_type
    df["poi_lat"] = result_poi_lat
    df["poi_lon"] = result_poi_lon
    df["distance_to_poi_m"] = result_distance

    # Select output columns matching reference format
    output_cols = [
        "Unique ID",
        "Combined Created At",
        "Trip Id",
        "Route Code",
        "zoho_alert_combined_view__ID",
        "zoho_alert_combined_view__ALERT_NAME",
        "zoho_alert_combined_view__CURRENT_LAT",
        "zoho_alert_combined_view__CURRENT_LONG",
        "poi_name",
        "poi_amenity_type",
        "poi_lat",
        "poi_lon",
        "distance_to_poi_m",
    ]

    out = df[output_cols]
    out.to_excel(OUTPUT_FILE, index=False, engine="openpyxl")
    print(f"\nDone! Output saved to {OUTPUT_FILE}")
    print(f"  Total rows: {len(out)}")
    print(f"  With POI: {(out['poi_amenity_type'] != 'No POI within 2km').sum()}")
    print(f"  No POI within 2km: {(out['poi_amenity_type'] == 'No POI within 2km').sum()}")
    print(f"\nPOI type distribution:")
    print(out["poi_amenity_type"].value_counts().head(20).to_string())


if __name__ == "__main__":
    main()
