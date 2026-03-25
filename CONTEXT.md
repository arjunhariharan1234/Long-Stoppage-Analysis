# Long Stoppage Analysis - Project Context

## Overview

This project is part of **Freight Tiger's** ML/AI initiative to reduce noise and prioritize significant alerts in the **Control Centre**. The managed services team faces high alert volumes (e.g., ~3.9L long stoppage alerts per week) and needs an intelligent system to filter routine stoppages from genuinely risky ones.

The core goal: **build a Priority & Escalation Framework** that classifies long stoppages as routine or unexpected based on location context, time sensitivity, and trip attributes.

## Problem Statement

- Long Stoppage alerts are the highest-volume alert type (~3,93,318/week as of Jul 2025).
- Not all stoppages are equally significant — a halt at a fuel station is routine; a halt in an isolated area may indicate theft or breakdown.
- The control centre cannot manually triage this volume, leading to agent fatigue and missed critical alerts.

## Approach: Context-Aware Alert Prioritization

### 1. Halt Master / POI Enrichment

Enrich each stoppage location with nearby Points of Interest (POIs) to classify it as **routine** or **unexpected**.

**POI categories tracked:**
- Fuel Stations
- Toll Gates / Toll Booths
- Dhabas (roadside restaurants)
- Rest Areas / Truck Stops
- Warehouses / Industrial Areas
- Alternate Consignee Locations

**Data sources:**
- OpenStreetMap (via `pyrosm` from `.osm.pbf` files) — primary, offline POI extraction
- Google Nearby Places API — fallback for locations not in the halt master

### 2. Trip State Classification

Determine vehicle state at time of stoppage:
- Still at origin or destination
- In transit
- Diverted
- Moving in reverse
- Incorrect asset

This suppresses false positives (e.g., route deviation alert when the trip hasn't started).

### 3. Time Sensitivity Scoring

Variables that modulate alert severity:

| Factor | Logic |
|---|---|
| **Short vs Long Haul** | 90-min halt on 1,100km trip = routine; on 100km trip = risky |
| **TAT (Turnaround Time)** | Score higher if stoppage occurs when TAT is mostly consumed |
| **Night-Time Halts** | Halts between 20:00–06:00 near dhabas/fuel stations = likely rest; lower sensitivity |
| **STA Breach Risk** | If STA buffer < 1hr and stoppage > 60 mins, raise severity |
| **ETA Breach Projection** | If ETA + halt duration > SLA, increase severity regardless of location |

### 4. Additional Constraints (TBD)

- State-wise driving curfews / entry bans stored in halt master
- Alert sequence correlation (e.g., Route Deviation + Long Stoppage at unknown location = high priority)

## Repository Structure

```
.
├── CONTEXT.md                          # This file
├── .gitignore                          # Excludes .osm.pbf, .DS_Store, checkpoints
├── Stoppage Intelligence Database - Sheet1.csv
│       Source data: route-level stoppage clusters with lat/lng,
│       trip counts, transit times, route polylines, zone info, tags
├── LongStoppageAnalysis.ipynb
│       POI extraction pipeline using pyrosm + scipy cKDTree.
│       Reads OSM PBF → extracts logistics-relevant POIs →
│       spatial index → finds nearby places within 2km of each cluster
├── Jsw Steel Red Zone (Halt Formation).ipynb
│       End-to-end halt analysis for JSW Steel:
│       - Fetches trips from MongoDB
│       - Cleans pings and forms halts (speed < threshold)
│       - Clusters halts using DBSCAN
│       - Enriches clusters with OSM/Google Places nearby POIs
│       - Reverse geocodes halt locations
│       - Generates reports and sends email alerts
│       - Visualizes trips/halts on Folium maps
├── cluster_data.json                   # Clustered halt data (JSON)
├── cluster_nearby_places.csv           # Output: clusters enriched with nearby POIs
├── india_logistics_pois.csv            # Cached logistics-relevant POIs from OSM
├── india_all_pois.csv                  # All POIs extracted from OSM
├── stoppage_dashboard.html             # Interactive Folium map dashboard
├── Reducing Noise and Prioritizing Significant Alerts in Control Centre (1).pdf
│       Product/design document outlining the full alert prioritization framework
└── india-260305.osm.pbf               # OpenStreetMap data for India (git-ignored, ~1.6GB)
```

## Key Data Schema

### Stoppage Intelligence Database (input)

| Column | Description |
|---|---|
| `origin_cluster_ftn` / `destination_cluster_ftn` | Origin/destination cluster identifiers |
| `Vehicle_type` | Type of vehicle |
| `primary_route_id` | Route identifier |
| `total_trip_count` / `num_trips_in_route` | Trip volume on this route |
| `median_transit_time` / `median_running_time` / `median_stoppage_time` | Time metrics |
| `median_transit_distance` / `median_google_distance` | Distance metrics |
| `origin_zone` / `destination_zone` | Geographic zones |
| `cluster_id` / `cluster_lat` / `cluster_lng` | Stoppage cluster location |
| `total_halts_count` | Number of halts in this cluster |
| `Tags` | Descriptive tags for the cluster |

### Cluster Nearby Places (output)

Extends the input with:
| Column | Description |
|---|---|
| `nearby_place_name` | Name of the nearby POI |
| `nearby_amenity` / `nearby_highway` / `nearby_barrier` / `nearby_landuse` | OSM category tags |
| `nearby_place_lat` / `nearby_place_lon` | POI coordinates |
| `search_radius_km` | Search radius used (default 2km) |

## Tech Stack

- **Python 3.13** — primary language
- **pandas / numpy** — data processing
- **pyrosm** — OpenStreetMap PBF parsing
- **scipy (cKDTree)** — spatial nearest-neighbor queries
- **scikit-learn (DBSCAN)** — halt clustering
- **geopandas / shapely** — geospatial operations, route buffers
- **folium** — interactive map visualizations
- **geopy** — reverse geocoding (Nominatim)
- **pymongo** — MongoDB connectivity for trip/ping data
- **matplotlib / seaborn** — plotting
- **mlflow** — experiment tracking
- **Google Places API** — fallback POI enrichment

## Alert Types in Scope

| Alert Type | How Context Helps |
|---|---|
| **Long Stoppage** | Ignore if at fuel station or dhaba; escalate if in remote area or diversion path |
| **Diversion** | Prioritize if away from known route or consignee cluster |
| **Detention** | Prioritize if beyond SLA at consignee; ignore if still loading/unloading |

## Related Resources

- **Product Doc**: `Reducing Noise and Prioritizing Significant Alerts in Control Centre (1).pdf` in this repo
- **Alert Volume Source**: Metabase (referenced in product doc)
- **Data Platform**: Databricks Genie — Journey Self Serve Analytics space (tables: `journey_analytics`, `load_analytics`, `stop_mis`, `planning`, `epod_analytics`)
