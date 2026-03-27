# Long Stoppage Analysis - Project Context

## Overview

This project is part of **Freight Tiger's** ML/AI initiative to reduce noise and prioritize significant alerts in the **Control Centre**. The managed services team faces high alert volumes (e.g., ~3.9L long stoppage alerts per week) and needs an intelligent system to filter routine stoppages from genuinely risky ones.

The core goal: **build a Stoppage Intelligence Platform** that ingests stoppage alert data, clusters halt locations, enriches them with POI intelligence, and classifies each halt as known functional, other legit, or unauthorized.

## Problem Statement

- Long Stoppage alerts are the highest-volume alert type (~3,93,318/week as of Jul 2025).
- Not all stoppages are equally significant — a halt at a fuel station is routine; a halt in an isolated area may indicate theft or breakdown.
- The control centre cannot manually triage this volume, leading to agent fatigue and missed critical alerts.
- Customers today know vehicles are stopping but don't know: where stoppages repeatedly happen, whether those locations are legitimate, what type of place each cluster represents, or which clusters represent operational risk.

## Product: Stoppage Intelligence Platform

### Core Workflow

```
Uploaded File / Live Alert Feed
→ Schema validation
→ Normalize stoppage records
→ Spatial clustering (DBSCAN at configurable radii)
→ Nearest POI lookup (progressive: 200m → 500m → 1km → 2km)
→ Stop classification (Known Functional / Other Legit / Unauthorized)
→ Analytics + Map rendering
→ Customer review and filtering
```

### Input: Customer Upload Schema

The platform ingests **alert-level stoppage data** (not raw GPS pings):

| Customer Column | Internal Field | Description |
|---|---|---|
| `Combined Created At` | `event_timestamp` | Stoppage/alert timestamp |
| `Trip Id` | `trip_id` | Trip identifier |
| `Unique ID` | `external_id` | Unique trip/movement reference |
| `Route Code` | `route_code` | Route grouping |
| `zoho_alert_combined_view → ID` | `alert_id` | Alert instance identifier |
| `zoho_alert_combined_view → ALERT_NAME` | `alert_name` | Alert type |
| `zoho_alert_combined_view → CURRENT_LAT` | `lat` | Halt latitude |
| `zoho_alert_combined_view → CURRENT_LONG` | `lon` | Halt longitude |

### Classification Logic

| Classification | Rule |
|---|---|
| **Known Functional Stop** | POI within 500m of type: fuel, restaurant, toll_booth, truck_stop, rest_area, parking, industrial, gate |
| **Other Legit Stop** | POI exists within 2km but is non-logistics (shop, hospital, village, temple, etc.) |
| **Unauthorized Stop** | No POI within 2km — highest risk, surfaced aggressively in UI |

### POI Intelligence Layer

India-wide POI dataset from OpenStreetMap: **1,227,498 POIs** with name-based type override logic for accurate classification (e.g., "Indian Oil" → fuel, "Dharamtar Toll Naka" → toll_booth).

---

## Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Upload   │  │  Map     │  │  Insights         │  │
│  │  Page     │  │  View    │  │  Dashboard        │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │ REST API
┌────────────────────┴────────────────────────────────┐
│                FastAPI Backend                        │
│  ┌──────────────────────────────────────────────┐    │
│  │  Routers: upload, poi, clusters, analytics,  │    │
│  │           map, events                        │    │
│  └──────────────────┬───────────────────────────┘    │
│  ┌──────────────────┴───────────────────────────┐    │
│  │  Services: ingest, clustering, poi_lookup,   │    │
│  │            classifier, pipeline              │    │
│  └──────────────────┬───────────────────────────┘    │
│  ┌──────────────────┴──────┐  ┌─────────────────┐   │
│  │  SQLite Database        │  │  POI Spatial     │   │
│  │  (uploads, events,      │  │  Index (cKDTree) │   │
│  │   clusters)             │  │  1.2M POIs       │   │
│  └─────────────────────────┘  └─────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React + TypeScript, MapLibre GL / deck.gl, Recharts, Tailwind CSS, Vite |
| **Backend** | Python 3.13, FastAPI, SQLAlchemy, Pydantic |
| **Database** | SQLite (WAL mode) — Phase 1, upgradeable to PostgreSQL/PostGIS |
| **Spatial** | scipy cKDTree (POI lookup), scikit-learn DBSCAN (clustering) |
| **POI Data** | OpenStreetMap extract — `india_all_pois.csv` (1.2M rows) |

### Directory Structure

```
stoppage-intelligence/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI app, lifespan (POI index load), CORS
│   │   ├── config.py               # Settings: DB path, POI path, radii, classification rules
│   │   ├── database.py             # SQLAlchemy engine, session, WAL pragma
│   │   ├── models.py               # ORM: Upload, StoppageEvent, Cluster
│   │   ├── schemas.py              # Pydantic request/response models
│   │   ├── routers/
│   │   │   ├── upload.py           # POST /api/upload (file ingest + validation)
│   │   │   ├── poi.py              # GET /api/poi/nearest, GET /api/poi/nearby
│   │   │   ├── clusters.py         # GET /api/clusters, GET /api/clusters/{id}
│   │   │   ├── analytics.py        # GET /api/analytics/summary, /breakdown
│   │   │   ├── map.py              # GET /api/map/clusters (GeoJSON)
│   │   │   └── events.py           # GET /api/events (paginated, filtered)
│   │   ├── services/
│   │   │   ├── ingest.py           # File parsing, schema detection, normalization
│   │   │   ├── clustering.py       # DBSCAN at configurable radii (haversine)
│   │   │   ├── poi_lookup.py       # Batch POI enrichment for events/clusters
│   │   │   ├── classifier.py       # Known Functional / Other Legit / Unauthorized
│   │   │   └── pipeline.py         # Orchestrator: ingest → cluster → POI → classify
│   │   └── spatial/
│   │       └── index.py            # POISpatialIndex: cKDTree, progressive radius search
│   ├── data/
│   │   ├── uploads/                # Uploaded customer files
│   │   └── stoppage_intelligence.db # SQLite database
│   ├── tests/
│   └── requirements.txt
├── frontend/                       # React app (Step 6-8)
│   └── src/
│       ├── pages/                  # UploadPage, MapView, InsightsDashboard
│       └── components/             # FileUploader, MapCanvas, FilterBar, ClusterDetailPanel
└── scripts/
```

### Database Schema

**uploads**
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| filename | TEXT | Original filename |
| uploaded_at | DATETIME | Upload timestamp |
| row_count | INTEGER | Total rows in file |
| valid_row_count | INTEGER | Rows with valid lat/lon |
| invalid_row_count | INTEGER | Rows missing lat/lon |
| status | TEXT | pending / processing / complete / error |
| column_mapping | JSON | Customer column → internal field mapping |
| error_message | TEXT | Error details if failed |

**events** (normalized stoppage alerts)
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| upload_id | FK → uploads | Source upload |
| external_id | TEXT | Original Unique ID |
| trip_id | TEXT | Trip identifier |
| route_code | TEXT | Route grouping |
| alert_id | TEXT | Alert instance ID |
| alert_name | TEXT | Alert type name |
| alert_status | TEXT | Alert status |
| event_timestamp | DATETIME | When the stoppage occurred |
| lat / lon | FLOAT | Halt coordinates |
| is_valid | BOOLEAN | Whether lat/lon are present |
| nearest_poi_name | TEXT | Matched POI name |
| nearest_poi_type | TEXT | Resolved POI category |
| nearest_poi_lat/lon | FLOAT | POI coordinates |
| nearest_poi_distance_m | FLOAT | Distance to nearest POI |
| poi_match_radius_m | FLOAT | Which search radius found it |
| classification | TEXT | known_functional / other_legit / unauthorized |
| cluster_id | FK → clusters | Assigned cluster |

**clusters**
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| upload_id | FK → uploads | Source upload |
| radius_meters | INTEGER | DBSCAN eps used |
| centroid_lat/lon | FLOAT | Cluster center |
| event_count | INTEGER | Stoppages in cluster |
| distinct_trips | INTEGER | Unique trips |
| distinct_routes | INTEGER | Unique routes |
| poi_name / poi_type | TEXT | Best POI match |
| poi_distance_m | FLOAT | Distance to POI |
| classification | TEXT | Cluster-level classification |
| first_seen / last_seen | DATETIME | Time range |
| peak_hour | INTEGER | Most common hour of day |
| night_halt_pct | FLOAT | % of halts between 20:00–06:00 |

### API Endpoints

| Method | Endpoint | Status | Description |
|---|---|---|---|
| GET | `/api/health` | **Done** | Health check + POI count |
| GET | `/api/poi/nearest?lat=&lon=` | **Done** | Progressive radius nearest POI |
| GET | `/api/poi/nearby?lat=&lon=&radius_m=` | **Done** | All POIs within radius |
| GET | `/api/uploads` | **Done** | List uploads with status |
| GET | `/api/uploads/{id}` | **Done** | Upload detail + event counts |
| POST | `/api/upload` | **Done** | Upload file, auto-detect schema, return proposed mapping + preview |
| POST | `/api/upload/{id}/confirm` | **Done** | Confirm mapping, normalize events, store to DB |
| GET | `/api/clusters?upload_id=&radius_m=` | **Done** | Cluster list, filterable by radius/classification |
| GET | `/api/clusters/{id}` | **Done** | Cluster detail + up to 100 member events |
| GET | `/api/map/clusters` | Step 5 | GeoJSON cluster data for map |
| GET | `/api/analytics/summary` | Step 5 | KPIs and totals |
| GET | `/api/analytics/breakdown` | Step 5 | Grouped aggregations |
| GET | `/api/events` | Step 5 | Paginated event list |

### POI Spatial Index Design

The `POISpatialIndex` class (loaded once at server startup, ~5s):
- Loads `india_all_pois.csv` (1,227,498 rows)
- Resolves POI type from OSM tags (amenity → shop → tourism → highway → barrier → landuse → building → village/locality)
- Applies name-based overrides (e.g., "Indian Oil" → fuel, "Dharamtar Toll Naka" → toll_booth, "dhaba" → restaurant/dhaba)
- Builds display names for unnamed POIs (e.g., "Unnamed Fuel Station")
- Constructs scipy cKDTree over radian coordinates
- Supports `query_nearest(lat, lon)` with progressive radius search (200m → 500m → 1km → 2km)
- Supports `query_all_within(lat, lon, radius_m)` for full neighborhood scan
- Returns `POIMatch` dataclass with: name, resolved_type, lat, lon, distance_m, match_radius_m

---

## Development Log

### Step 1: Backend Skeleton + POI Spatial Index — COMPLETE

**What was built:**
- FastAPI application with CORS, lifespan-managed startup
- SQLite database with WAL mode, SQLAlchemy ORM models (Upload, StoppageEvent, Cluster)
- POI Spatial Index singleton loaded at startup from `india_all_pois.csv`
- Two-tier POI type resolution: OSM tag-based + name-based keyword overrides
- REST endpoints: `/api/health`, `/api/poi/nearest`, `/api/poi/nearby`
- Pydantic schemas for request/response validation

**Validated:**
- Health endpoint returns `{"status": "ok", "poi_count": 1227498}`
- `/api/poi/nearest?lat=18.706629&lon=73.034912` → Dharamtar Toll Naka (toll_booth, 367.8m, matched at 500m radius)
- `/api/poi/nearest?lat=16.520224&lon=75.870102` → Gouramma Restaurant (restaurant, 808.5m, matched at 1km radius)
- `/api/poi/nearby` returns sorted list of all POIs within requested radius
- Results match the enriched JSW Steel xlsx output exactly

**Key design decisions:**
- POI index is in-memory (cKDTree) — loads in ~5s, sub-millisecond queries
- Progressive radius search (200m → 500m → 1km → 2km) — smaller radius = stronger signal
- Name-based overrides fix OSM tag gaps (e.g., "Indian Oil" tagged as village/locality in OSM → corrected to fuel)
- SQLite with WAL for Phase 1 — single-writer is fine, concurrent reads during pipeline processing

### Step 2: File Ingest + Schema Validation — COMPLETE

**What was built:**
- `services/ingest.py` — Column auto-detection, schema validation, event normalization
- `routers/upload.py` — Full upload flow: POST /upload → POST /upload/{id}/confirm → GET /uploads

**Ingest pipeline:**
1. File upload saves to `data/uploads/`, parses xlsx/csv
2. Auto-detect columns via keyword matching (e.g., "CURRENT_LAT" → lat, "Trip Id" → trip_id)
3. Returns proposed mapping + 5-row preview + validation warnings
4. On confirm: normalizes all rows, parses timestamps, validates lat/lon ranges, stores to SQLite

**Column detection heuristics:**
- Scans column names for keywords: `current_lat` → lat, `current_long` → lon, `trip id` → trip_id, etc.
- Supports multiple naming conventions for each canonical field
- Returns warnings if critical fields (lat, lon, timestamp) are unmapped

**Validated with JSW Steel file (22,510 rows):**
- Schema auto-detection: 8/8 columns mapped correctly, 0 warnings
- Normalization: 20,467 valid events (have lat/lon), 2,043 invalid (missing coords)
- Matches the earlier manual enrichment analysis exactly
- DB verification: 568 distinct routes, 13,892 distinct trips
- Timestamps parsed correctly, IDs stored as strings
- Invalid events flagged with `is_valid=False`, lat/lon set to NULL

**Key design decisions:**
- Two-step upload flow (upload → preview → confirm) so the UI can show schema mapping for user review
- Mapping overrides supported via confirm endpoint body
- Invalid rows kept in DB (flagged) rather than discarded — customer can review what was dropped
- Bulk insert via `bulk_save_objects` for performance

### Step 3: DBSCAN Clustering Service — COMPLETE

**What was built:**
- `services/clustering.py` — DBSCAN clustering with haversine distance, time intelligence
- `routers/clusters.py` — GET /api/clusters (list, filterable), GET /api/clusters/{id} (detail + events)
- Clustering integrated into upload confirm flow — runs at all 4 radii automatically after ingest

**Clustering pipeline:**
1. After events are stored, reload valid events from DB
2. Run DBSCAN at each configured radius (200m, 500m, 1km, 2km)
3. For each cluster: compute centroid, event count, distinct trips/routes, time intelligence
4. Store Cluster records in DB, assign events to their 500m cluster (default radius)

**Time intelligence per cluster:**
- `first_seen` / `last_seen` — date range of stoppages
- `peak_hour` — most frequent hour of day (mode)
- `night_halt_pct` — % of halts between 20:00–06:00

**Validated with JSW Steel data (20,467 valid events):**

| Radius | Clusters | Noise (unclustered) | Clustered Events |
|--------|----------|---------------------|------------------|
| 200m   | 266      | 13,190              | 7,277            |
| 500m   | 389      | 10,615              | 9,852            |
| 1km    | 463      | 8,187               | 12,280           |
| 2km    | 447      | 6,017               | 14,450           |

- Largest 500m cluster: 2,338 events, 2,229 trips, 124 routes at (18.7339, 73.0620)
- Night halt detection working: Cluster 12 has 47.9% night halts (peak 7PM), Cluster 11 peaks at midnight (49.2%)
- Cluster detail endpoint returns member events (capped at 100)
- Full pipeline (upload → ingest → cluster at 4 radii) completes successfully

**Key design decisions:**
- Cluster at all 4 radii simultaneously — stored as separate records, queryable by radius
- Events assigned to clusters at 500m (default) via cluster_id FK for drill-down
- Noise points (DBSCAN label -1) kept as unclustered events — isolated unauthorized stops need attention
- DBSCAN params: `algorithm=ball_tree`, `metric=haversine`, `min_samples=5`

### Step 4: POI Enrichment + Classification Pipeline — COMPLETE

**What was built:**
- `services/poi_lookup.py` — Batch POI enrichment for events and clusters using the spatial index
- `services/classifier.py` — Classification logic: known_functional / other_legit / unauthorized
- Integrated into upload pipeline — enrichment runs automatically after clustering

**Classification rules:**
- **Known Functional**: POI type in {fuel, restaurant, toll_booth, gate, industrial, parking, rest_area, truck_stop, etc.} AND distance <= 500m
- **Other Legit**: POI found within 2km but non-logistics type or distance > 500m
- **Unauthorized**: No POI found within 2km (max search radius)

**Full pipeline now runs:**
```
Upload → Schema Detection → Normalize → Store Events
→ DBSCAN Clustering (200m/500m/1km/2km)
→ POI Enrichment (events + clusters)
→ Classification (events + clusters)
→ Complete
```

**Validated with JSW Steel data (20,467 valid events):**

Event-level classification:
| Classification | Count | % |
|---|---|---|
| Known Functional | 3,981 | 19.4% |
| Other Legit | 14,793 | 72.3% |
| Unauthorized | 1,693 | 8.3% |

Cluster-level classification (all radii):
| Classification | Count |
|---|---|
| Known Functional | 391 |
| Other Legit | 1,023 |
| Unauthorized | 151 |

At 500m radius: 35 unauthorized clusters identified (highest risk).

**Sample validated results:**
- Cluster 270: known_functional — Unnamed Gate at 326.8m, 589 events, DT-HAI route
- Cluster 268: other_legit — Toranagallu Byepass Cabin (village) at 602.2m, 1,423 events
- Cluster 287: unauthorized — no POI, 32 events, 65.6% night halts, peak at 2AM (suspicious)

**Key design decisions:**
- Progressive radius search ensures closest POI is always used (200m match >> 2km match)
- Events and clusters both enriched independently (event-level for drill-down, cluster-level for map/dashboard)
- Enrichment batched with flush every 1,000 events to avoid memory issues on large uploads
- Haversine distance stored on both events (`nearest_poi_distance_m`) and clusters (`poi_distance_m`)

### Step 5: REST APIs (Map, Clusters, Analytics) — PLANNED

### Step 6: React Frontend — Upload Page — PLANNED

### Step 7: React Frontend — Map View — PLANNED

### Step 8: React Frontend — Insights Dashboard — PLANNED

---

## Research & Notebooks

### Stoppage Intelligence Database (original analysis)

Source: `Stoppage Intelligence Database - Sheet1.csv`
- Route-level stoppage clusters with lat/lng, trip counts, transit times, route polylines, zone info, tags

### LongStoppageAnalysis.ipynb

POI extraction pipeline using pyrosm + scipy cKDTree:
- Reads OSM PBF → extracts logistics-relevant POIs → spatial index → finds nearby places within 2km of each cluster

### Jsw Steel Red Zone (Halt Formation).ipynb

End-to-end halt analysis for JSW Steel (Customer ID 1182):
- Fetches trips from MongoDB, cleans pings, forms halts (speed < threshold)
- Clusters halts using DBSCAN, enriches with OSM/Google Places POIs
- Reverse geocodes halt locations, generates reports, sends email alerts
- Visualizes trips/halts on Folium maps

### JSW Steel POI Enrichment (script output)

File: `jsw_steel_long_stoppages_with_poi.xlsx` (22,510 rows)
- 18,774 matched to POI within 2km
- 1,693 had coordinates but no POI nearby
- 2,043 marked "Unidentified" (missing lat/lon)
- POI types validated with name-based overrides — 0 fuel/toll/food mismatches
- All unnamed POIs given descriptive labels (e.g., "Unnamed Fuel Station")

---

## Related Resources

- **Product Doc**: `Reducing Noise and Prioritizing Significant Alerts in Control Centre (1).pdf`
- **Alert Volume Source**: Metabase (referenced in product doc)
- **Data Platform**: Databricks Genie — Journey Self Serve Analytics space (tables: `journey_analytics`, `load_analytics`, `stop_mis`, `planning`, `epod_analytics`)
- **Server**: `http://localhost:8000` (development)
- **API Docs**: `http://localhost:8000/docs` (Swagger UI auto-generated by FastAPI)
