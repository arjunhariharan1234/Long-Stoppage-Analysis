# Stoppage Intelligence Platform — Architecture

## Overview

The Stoppage Intelligence Platform analyzes long stoppage alerts for logistics fleets. It ingests stoppage data, clusters halt locations using DBSCAN, enriches them with 1.2M Points of Interest from OpenStreetMap, and classifies each halt as **known functional**, **other legit**, or **unauthorized**.

**Live URL:** https://frontend-two-smoky-51.vercel.app

---

## Architecture Diagram

```
                        +---------------------------+
                        |    User's Browser          |
                        +---------------------------+
                                   |
                    +--------------+--------------+
                    |                             |
            (pre-loaded data)              (new uploads)
                    |                             |
        +-----------v-----------+    +------------v-----------+
        |   Vercel CDN          |    |   Render Backend       |
        |   (Static JSON)      |    |   (FastAPI + Docker)   |
        |                       |    |                        |
        |  /data/summary.json   |    |  POST /api/upload      |
        |  /data/hourly.json    |    |  GET  /api/analytics/* |
        |  /data/clusters-*.json|    |  GET  /api/clusters/*  |
        |  /data/top-clusters-* |    |  GET  /api/map/*       |
        |  /data/poi-breakdown  |    |                        |
        |  /data/route-breakdown|    |  SQLite + cKDTree      |
        +-----------------------+    +------------------------+
```

## Design Principles

1. **Static-first**: Pre-computed analysis is served as static JSON from Vercel's CDN. No backend needed for viewing existing results. Loads instantly.
2. **Backend-optional**: The Render backend is only needed for new file uploads and live analysis. It can be offline without affecting the pre-loaded demo.
3. **Heavy processing runs locally**: DBSCAN clustering, POI enrichment, and classification run on the developer's machine (unlimited RAM), not on free cloud tiers with 512MB limits.
4. **Lazy loading**: The 1.2M POI spatial index loads only when a new upload triggers POI enrichment, not at server startup.

---

## Components

### 1. Frontend (Vercel)

**Stack:** React + TypeScript, Vite, MapLibre GL, deck.gl, Recharts, Tailwind CSS

**Deployment:** Vercel (free tier), auto-deploys from `main` branch

**Root directory:** `stoppage-intelligence/frontend`

**Key files:**
| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app — loads static JSON first, falls back to backend |
| `src/api/static.ts` | Static JSON loader from `/data/` directory |
| `src/api/client.ts` | Axios client for backend API |
| `src/pages/LandingPage.tsx` | Animated landing with KPIs and CTA |
| `src/pages/UploadStep.tsx` | File upload with truck animation |
| `src/pages/ResultsView.tsx` | Dashboard with tabs (Map, Insights, Data) |
| `src/components/MapTab.tsx` | MapLibre + deck.gl hexbin visualization |
| `src/components/InsightsTab.tsx` | Charts, tables, Google Maps embed |
| `src/components/DataTab.tsx` | Paginated event data table |
| `public/data/*.json` | Pre-computed static analysis data |

**Data loading strategy:**
```
isStaticUpload(uploadId)?
  ├── YES → fetch from /data/*.json (instant, CDN-served)
  └── NO  → fetch from Render backend API (requires server)
```

### 2. Backend (Render)

**Stack:** Python 3.13, FastAPI, SQLAlchemy, pandas, scikit-learn, scipy

**Deployment:** Render (free tier), Docker, auto-deploys from `main` branch

**Root directory:** `stoppage-intelligence/backend`

**Key files:**
| File | Purpose |
|------|---------|
| `app/main.py` | FastAPI app, lifespan, CORS |
| `app/config.py` | All configuration (DB, POI path, clustering params) |
| `app/database.py` | SQLAlchemy engine, sessions, WAL pragma |
| `app/models.py` | ORM models: Upload, StoppageEvent, Cluster |
| `app/routers/upload.py` | Upload + auto-process pipeline |
| `app/routers/analytics.py` | Summary, hourly, POI breakdown, route stats |
| `app/routers/clusters.py` | Cluster list and detail endpoints |
| `app/routers/map_data.py` | GeoJSON cluster data for map rendering |
| `app/spatial/index.py` | POISpatialIndex: cKDTree over 1.2M POIs |
| `app/spatial/lazy.py` | Lazy loader — loads POI index on first use |
| `app/services/clustering.py` | DBSCAN clustering (haversine, configurable radii) |
| `app/services/poi_lookup.py` | Batch POI enrichment for events and clusters |
| `app/services/classifier.py` | Classification rules |
| `app/services/seed.py` | Pre-seed DB from enriched CSV (disabled on Render) |
| `Dockerfile` | Docker image with POI data + seed CSV |

**API Endpoints:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Health check |
| POST | `/api/upload?auto_process=true` | Upload + full pipeline in one request |
| GET | `/api/uploads` | List all uploads |
| GET | `/api/analytics/summary` | KPIs, classification breakdown |
| GET | `/api/analytics/hourly` | Hour-of-day distribution |
| GET | `/api/analytics/poi-breakdown` | Clusters by POI type |
| GET | `/api/analytics/route-breakdown` | Top routes by stoppage count |
| GET | `/api/analytics/top-clusters` | Top clusters, filterable by classification |
| GET | `/api/map/clusters` | GeoJSON for map rendering |
| GET | `/api/clusters/{id}` | Cluster detail with member events |

### 3. Pre-computed Data Pipeline

**Runs locally** (not on cloud) via a Python script that:

1. Reads the enriched xlsx/csv (74,782 rows with POI data already matched)
2. Creates SQLite DB with Upload, Events, Clusters
3. Runs DBSCAN clustering at 500m radius
4. Classifies events and clusters
5. Exports all API responses as static JSON to `frontend/public/data/`

**Files produced:**
| File | Size | Content |
|------|------|---------|
| `uploads.json` | 206B | Upload metadata |
| `summary.json` | 410B | KPIs, classification counts |
| `hourly.json` | 704B | 24-hour distribution |
| `poi-breakdown.json` | 4.6KB | POI type breakdown |
| `route-breakdown.json` | 1.3KB | Top 20 routes |
| `top-clusters-all.json` | 5.9KB | Top 20 clusters (all types) |
| `top-clusters-known_functional.json` | 5.9KB | Top 20 functional stops |
| `top-clusters-other_legit.json` | 6.0KB | Top 20 legit stops |
| `top-clusters-unauthorized.json` | 6.1KB | Top 20 unauthorized stops |
| `clusters-geojson.json` | 652KB | All 1,917 clusters as GeoJSON |
| **Total** | **~680KB** | |

---

## Data Flow

### Pre-loaded Analysis (Static)

```
Developer machine:
  jsw_steel_10months_with_poi.xlsx (74K rows, pre-enriched)
  → seed.py → SQLite DB
  → export script → 11 JSON files
  → git push → Vercel CDN

User loads the site:
  Browser → Vercel CDN → /data/*.json → Instant render
```

### New Upload Flow (Dynamic)

```
User drops file in browser:
  → POST /api/upload?auto_process=true (Render backend)
  → Parse CSV/XLSX
  → Normalize events
  → DBSCAN clustering (200m, 500m, 1km, 2km)
  → Lazy-load POI index (1.2M locations, first use only)
  → POI enrichment (progressive radius: 200m → 500m → 1km → 2km)
  → Classification (known_functional / other_legit / unauthorized)
  → Return results
  → Frontend renders dashboard
```

---

## Classification Logic

| Classification | Rule | Example |
|----------------|------|---------|
| **Known Functional** | POI type is logistics-relevant AND distance <= 500m | Fuel station 200m away |
| **Other Legit** | POI exists within 2km but non-logistics or > 500m | Hospital 800m away |
| **Unauthorized** | No POI within 2km | Middle of nowhere |

**Logistics-relevant POI types:** fuel, restaurant, restaurant/dhaba, fast_food, cafe, truck_stop, rest_area, parking, toll_booth, industrial, industrial/factory, warehouse, charging_station, gate

---

## POI Spatial Index

- **Source:** OpenStreetMap India extract
- **Size:** 1,227,498 POIs
- **Index:** scipy cKDTree over radian coordinates
- **Load time:** ~5s (lazy, only on first POI query)
- **Query time:** <1ms per point
- **Search strategy:** Progressive radius (200m → 500m → 1km → 2km)
- **Name overrides:** Keyword-based corrections (e.g., "Indian Oil" → fuel, "dhaba" → restaurant)

---

## Clustering (DBSCAN)

- **Algorithm:** scikit-learn DBSCAN with `metric=haversine`, `algorithm=ball_tree`
- **Radii:** 200m, 500m (default), 1km, 2km
- **Min samples:** 5 events to form a cluster
- **Time intelligence per cluster:** first_seen, last_seen, peak_hour, night_halt_pct

---

## Deployment

### Vercel (Frontend)
- **Plan:** Free (Hobby)
- **Build:** `npm run build` (Vite)
- **Root:** `stoppage-intelligence/frontend`
- **Env:** `VITE_API_URL` = Render backend URL
- **Static data:** Served from `public/data/` at build time

### Render (Backend)
- **Plan:** Free
- **Runtime:** Docker (Python 3.13-slim)
- **Memory:** 512MB (seed disabled, POI lazy-loaded)
- **Env:** `SKIP_SEED=1`, `DATABASE_URL`, `POI_CSV_PATH`, `UPLOAD_DIR`
- **Health check:** `/api/health` (60s timeout)
- **Cold start:** ~10-15s (no POI loading at startup)
- **Spin down:** After 15min inactivity (free tier)

### GitHub
- **Repo:** https://github.com/arjunhariharan1234/Long-Stoppage-Analysis
- **Branch:** `main` (auto-deploys to both Vercel and Render)

---

## Directory Structure

```
Long-Stoppage-Analysis/
├── architecture.md                    # This file
├── CONTEXT.md                         # Project context and dev log
├── render.yaml                        # Render blueprint
├── jsw_steel_10months_with_poi.xlsx   # Enriched source data (74K rows)
├── jsw_steel_10months.csv             # Raw 10-month data (79K rows)
├── india_all_pois.csv                 # Full POI dataset (1.2M rows)
│
└── stoppage-intelligence/
    ├── backend/
    │   ├── Dockerfile
    │   ├── Procfile
    │   ├── requirements.txt
    │   ├── app/
    │   │   ├── main.py
    │   │   ├── config.py
    │   │   ├── database.py
    │   │   ├── models.py
    │   │   ├── schemas.py
    │   │   ├── routers/          # upload, poi, clusters, analytics, map, events
    │   │   ├── services/         # ingest, clustering, poi_lookup, classifier, seed
    │   │   └── spatial/          # index.py (cKDTree), lazy.py (lazy loader)
    │   └── data/
    │       ├── india_all_pois.csv.gz     # Compressed POI dataset (19MB)
    │       └── jsw_steel_seed.csv.gz     # Compressed seed data (3.4MB)
    │
    └── frontend/
        ├── package.json
        ├── vite.config.ts
        ├── public/
        │   └── data/             # Pre-computed static JSON (680KB total)
        │       ├── uploads.json
        │       ├── summary.json
        │       ├── hourly.json
        │       ├── poi-breakdown.json
        │       ├── route-breakdown.json
        │       ├── top-clusters-*.json
        │       └── clusters-geojson.json
        └── src/
            ├── App.tsx
            ├── api/
            │   ├── client.ts     # Backend API client
            │   └── static.ts     # Static JSON loader
            ├── pages/
            │   ├── LandingPage.tsx
            │   ├── UploadStep.tsx
            │   └── ResultsView.tsx
            └── components/
                ├── MapTab.tsx
                ├── InsightsTab.tsx
                └── DataTab.tsx
```

---

## How to Update Pre-computed Data

When you have new stoppage data to analyze:

```bash
# 1. Run the pipeline locally
cd stoppage-intelligence/backend
python3 -c "
import app.models
from app.database import init_db
init_db()
from app.services.seed import seed_if_empty
seed_if_empty()
"

# 2. Export static JSON (run the export script)
python3 export_static.py  # exports to frontend/public/data/

# 3. Push to GitHub — Vercel auto-deploys
git add -A && git commit -m 'Update analysis data' && git push
```

---

## Performance

| Metric | Value |
|--------|-------|
| Frontend initial load | <1s (static JSON from CDN) |
| Landing page render | Instant (no backend call) |
| Insights tab load | <200ms (11 static JSON files) |
| Map render | <500ms (652KB GeoJSON, 1917 features) |
| Backend cold start | 10-15s (Render free tier) |
| New file upload (22K rows) | ~60-90s (cluster + POI + classify) |
| Local pipeline (74K rows) | 5.5s |
| POI index load (first use) | ~5s |
| POI query | <1ms |

---

## JSW Steel Analysis Summary

| Metric | Value |
|--------|-------|
| Total events | 74,782 |
| Valid events | 74,782 |
| Distinct routes | 617 |
| Distinct trips | 32,634 |
| Clusters (500m) | 1,917 |
| Known functional | Fuel, toll, gate, restaurant stops |
| Unauthorized | No POI within 2km — highest risk |
| Time range | 10 months of long stoppage data |
