import logging
from datetime import datetime
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# Canonical internal field names
CANONICAL_FIELDS = {
    "event_timestamp",
    "trip_id",
    "external_id",
    "route_code",
    "alert_id",
    "alert_name",
    "alert_status",
    "lat",
    "lon",
}

# Heuristics: patterns in column names → canonical field
_COLUMN_PATTERNS = [
    # Latitude
    (["current_lat", "latitude", "halt_lat", "stop_lat"], "lat"),
    # Longitude
    (["current_long", "current_lon", "longitude", "halt_lon", "halt_long", "stop_lon", "stop_long"], "lon"),
    # Event timestamp
    (["combined created at", "created_at", "alert_created", "event_time", "stoppage_time", "halt_time"], "event_timestamp"),
    # Trip ID
    (["trip id", "trip_id", "tripid"], "trip_id"),
    # External / Unique ID
    (["unique id", "unique_id", "external_id", "movement_id"], "external_id"),
    # Route
    (["route code", "route_code", "routecode"], "route_code"),
    # Alert ID
    (["alert_id", "zoho_alert_combined_view__id"], "alert_id"),
    # Alert name
    (["alert_name", "alert_type"], "alert_name"),
    # Alert status
    (["alert_status"], "alert_status"),
]


def detect_column_mapping(columns: list[str]) -> dict[str, str]:
    """Auto-detect mapping from customer columns to canonical fields.

    Returns: {customer_column: canonical_field}
    """
    mapping = {}
    used_canonical = set()
    cols_lower = {c: c.lower().strip() for c in columns}

    for patterns, canonical in _COLUMN_PATTERNS:
        if canonical in used_canonical:
            continue
        for col, col_low in cols_lower.items():
            if col in mapping:
                continue
            for pattern in patterns:
                if pattern in col_low:
                    mapping[col] = canonical
                    used_canonical.add(canonical)
                    break
            if canonical in used_canonical:
                break

    return mapping


def validate_mapping(mapping: dict[str, str]) -> list[str]:
    """Check that required fields are mapped. Returns list of warnings."""
    warnings = []
    canonical_values = set(mapping.values())

    if "lat" not in canonical_values:
        warnings.append("Missing latitude column mapping — required for spatial analysis")
    if "lon" not in canonical_values:
        warnings.append("Missing longitude column mapping — required for spatial analysis")
    if "event_timestamp" not in canonical_values:
        warnings.append("Missing timestamp column — time intelligence will be limited")
    if "trip_id" not in canonical_values:
        warnings.append("Missing trip ID column — trip-level analytics will be limited")

    return warnings


def parse_file(file_path: Path) -> pd.DataFrame:
    """Read uploaded file (xlsx or csv) into a DataFrame."""
    suffix = file_path.suffix.lower()
    if suffix == ".xlsx":
        df = pd.read_excel(file_path)
    elif suffix in (".csv", ".tsv"):
        sep = "\t" if suffix == ".tsv" else ","
        df = pd.read_csv(file_path, sep=sep)
    else:
        raise ValueError(f"Unsupported file format: {suffix}. Use .xlsx or .csv")

    logger.info("Parsed %d rows, %d columns from %s", len(df), len(df.columns), file_path.name)
    return df


def normalize_events(df: pd.DataFrame, mapping: dict[str, str]) -> pd.DataFrame:
    """Normalize customer DataFrame into canonical event schema.

    Returns DataFrame with canonical column names + validity flags.
    """
    # Reverse mapping: canonical → customer column
    reverse = {v: k for k, v in mapping.items()}

    records = []
    for canonical in CANONICAL_FIELDS:
        customer_col = reverse.get(canonical)
        if customer_col and customer_col in df.columns:
            records.append((canonical, df[customer_col]))
        else:
            records.append((canonical, pd.Series([None] * len(df))))

    result = pd.DataFrame(dict(records))

    # Parse timestamps
    if result["event_timestamp"].notna().any():
        result["event_timestamp"] = pd.to_datetime(result["event_timestamp"], errors="coerce")

    # Parse lat/lon as float
    result["lat"] = pd.to_numeric(result["lat"], errors="coerce")
    result["lon"] = pd.to_numeric(result["lon"], errors="coerce")

    # Validity: must have lat and lon
    result["is_valid"] = result["lat"].notna() & result["lon"].notna()

    # Basic lat/lon range check
    valid_lat = result["lat"].between(-90, 90) | result["lat"].isna()
    valid_lon = result["lon"].between(-180, 180) | result["lon"].isna()
    result.loc[~(valid_lat & valid_lon), "is_valid"] = False

    # Convert IDs to string
    for col in ["trip_id", "external_id", "route_code", "alert_id", "alert_name", "alert_status"]:
        result[col] = result[col].astype(str).replace("nan", None).replace("None", None)

    valid_count = result["is_valid"].sum()
    invalid_count = (~result["is_valid"]).sum()
    logger.info("Normalized: %d valid, %d invalid out of %d total", valid_count, invalid_count, len(result))

    return result
