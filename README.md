# Long Stoppage Intelligence — Stakeholder Overview

This document describes **what the project delivers for the business**, how it supports **loss prevention and movement integrity**, and the **meaning of the data** you see in reports and dashboards. For technical architecture and deployment detail, see [architecture.md](./architecture.md).

---

## Outcomes stakeholders can expect

**1. Signal instead of noise in long-stoppage alerts**  
Long stoppages are one of the highest-volume alert types in fleet control operations. The platform turns raw “vehicle stopped a long time” events into **prioritized insight**: which stops are plausibly routine (fuel, toll, gate, rest) versus which occur **away from any credible place-of-business** and deserve attention first.

**2. Repeatable locations, not one-off dots**  
Individual GPS points are hard to act on. The system **clusters** nearby halts so operations and security teams can see **where the fleet habitually stops**, how often, on which routes, and at what times—supporting targeted checks, route reviews, and yard or corridor conversations with transporters.

**3. A single place to review impact**  
Through the web experience (map, charts, and tabular data), stakeholders can answer: *How much of our stoppage volume is “explained” by known functional places? How much is in ambiguous or empty areas? Which routes and clusters drive that risk?* That framing supports **KPIs for alert quality, investigation load, and follow-up closure**.

**4. Scalable ingestion**  
New periods or customers can be analyzed by **uploading** structured stoppage extracts; the same classification and clustering logic applies consistently, so comparisons over time and across fleets stay **methodologically aligned**.

**5. Faster path from data to decision**  
Pre-computed analysis can be served instantly for standard demos and benchmarks; optional backend processing supports **fresh uploads** without changing how leaders read the results.

---

## Vision: supporting pilferage and movement-risk insight across the network

Pilferage and cargo loss rarely advertise themselves in a single alert. They often show up as **patterns**: vehicles stopping for extended periods in **locations that do not match normal logistics** (no fuel, no toll, no plant gate, no recognized rest infrastructure), **repeated use of the same unofficial spots**, or **concentrations on certain routes or night-time halts**.

This platform is designed as the **analytical layer** on top of long-stoppage alerts so that:

- **Movements** (trips, routes, and unique movement identifiers in the source data) can be traced to **where** those movements halt for long durations, not only **that** they halted.
- **Clusters** reveal **habitual unofficial stopping behavior**—the kind of geography that teams often investigate when reconciling shortages, seal breaks, or unexplained dwell time.
- **Classification** (known functional vs other legitimate context vs unauthorized / no POI match) gives a **first-pass hypothesis** about intent: routine operations versus stops that lack an obvious legitimate explanation in map and POI data.
- **Time and route dimensions** (hour-of-day, first/last seen, route breakdowns) help prioritize **when and which corridors** to audit, brief transporters, or align with gate, weighbridge, or CCTV checks.

The vision is **not** to replace human investigation or legal process, but to **concentrate attention** on movements and places where pilferage-related risk is structurally higher—so security, operations, and customer success teams share a **common map of risk** rather than scrolling thousands of undifferentiated alerts.

---

## How to read “impact” in this project

| Lens | What to look at |
|------|------------------|
| **Volume** | Total events, valid events, and how many clusters they form—concentration vs spread of halts. |
| **Risk mix** | Share of stops classified as **unauthorized** (no POI within search radius) vs **known functional** vs **other legit**—shift in this mix over time is a direct outcome indicator. |
| **Place** | Map and POI breakdown: which amenity types explain the most halts; where “unidentified” clusters sit geographically. |
| **Movement & route** | Route and trip distinct counts per cluster, top routes by stoppage—useful for carrier- and lane-level reviews. |
| **Time** | Hourly distribution and cluster-level night-halt share—useful for staffing investigations and pattern detection. |

Technical implementation detail (DBSCAN radii, POI source, deployment URLs) is documented in [architecture.md](./architecture.md).

---

## Data dictionary

### A. Source / upload fields (customer file)

These columns (or names detected as equivalent—see ingestion heuristics in the backend) are the **minimum conceptual model** for each long-stoppage alert row.

| Field (conceptual) | Typical source column label | Description |
|--------------------|----------------------------|-------------|
| **Event timestamp** | `Combined Created At`, or names containing `created_at`, `halt_time`, etc. | When the stoppage alert was raised or recorded. Drives time-of-day and trend analysis. |
| **Trip ID** | `Trip Id`, `trip_id` | Identifier for the trip leg; used for trip-level frequency and cluster membership context. |
| **External / unique ID** | `Unique ID`, `unique_id`, `movement_id` | Customer’s unique reference for the movement or record; useful for tracing back to TMS or control-room systems. |
| **Route code** | `Route Code`, `route_code` | Route or lane grouping for aggregate reporting and top-route charts. |
| **Alert ID** | `zoho_alert_combined_view__ID`, `alert_id` | Identifier of the alert instance in the source system. |
| **Alert name** | `zoho_alert_combined_view__ALERT_NAME`, `alert_name` | Alert type or label from the source (e.g. long stoppage). |
| **Alert status** | `alert_status` | Optional workflow state from the source, if provided. |
| **Latitude** | `zoho_alert_combined_view__CURRENT_LAT`, or names containing `latitude`, `halt_lat` | Halt location — required for clustering and map display. |
| **Longitude** | `zoho_alert_combined_view__CURRENT_LONG`, or names containing `longitude`, `halt_lon` | Halt location — required for clustering and map display. |

### B. POI enrichment fields (per event or from pre-enriched files)

After POI lookup (OpenStreetMap-based index, nearest feature within search radii):

| Field (internal / export) | Description |
|---------------------------|-------------|
| **Nearest POI name** | Name of the matched point of interest, if any. |
| **Nearest POI type** | Derived category (amenity, shop, highway, etc.) used for classification. |
| **POI coordinates** | Latitude / longitude of the matched POI. |
| **Distance to POI (m)** | Great-circle distance from halt to matched POI. |
| **POI match radius (m)** | Radius used when the match was made (progressive search in live pipeline: e.g. 200 m up to 2 km). |

### C. Classification values (event and cluster)

| Value | Business meaning |
|-------|------------------|
| **known_functional** | Halt is near a **logistics-relevant** POI type within a **short distance** (e.g. fuel, toll, gate, truck stop, rest area, parking, industrial)—treated as **routine operational** context. |
| **other_legit** | A POI exists within the wider search radius but is **not** treated as core logistics infrastructure, or is farther than the functional threshold—**plausibly legitimate** but not “standard fleet stop” (e.g. some civic or retail categories). |
| **unauthorized** | **No POI** matched within the configured maximum radius—halt is in **unmapped or empty** context relative to the POI database; **flagged as highest attention** for risk workflows (including pilferage-related investigation). |

*Exact type lists and distance thresholds are configuration-driven; see [architecture.md](./architecture.md) classification table.*

### D. Cluster-level derived fields

| Field | Description |
|-------|-------------|
| **Cluster ID** | Stable identifier for a spatial group of events at a given clustering radius. |
| **Radius (m)** | DBSCAN neighborhood radius used to form the cluster (e.g. 500 m). |
| **Centroid lat / lon** | Representative location of the cluster for mapping. |
| **Event count** | Number of stoppage events in the cluster. |
| **Distinct trips / routes** | How many different trips and routes touch this location—indicates **breadth of exposure** across movements. |
| **Cluster POI name / type / distance** | Aggregate POI context associated with the cluster for labeling and classification. |
| **Cluster classification** | Classification applied at cluster level (aligned with event-level rules). |
| **First seen / last seen** | Time window of activity at this cluster. |
| **Peak hour** | Hour bucket with maximum activity (0–23). |
| **Night halt %** | Share of events in the cluster occurring in defined night hours—useful for **after-hours risk** narratives. |

### E. Pre-computed dashboard assets (static JSON)

These files power the public dashboard without calling the API; names may evolve but roles are:

| Asset | Role |
|-------|------|
| `uploads.json` | Metadata about the seeded upload (filename, row counts). |
| `summary.json` | Headline KPIs and classification counts. |
| `hourly.json` | Distribution of stoppages by hour of day. |
| `poi-breakdown.json` | Counts by POI / place type. |
| `route-breakdown.json` | Top routes by stoppage volume. |
| `top-clusters-*.json` | Top clusters overall or filtered by classification. |
| `clusters-geojson.json` | Geographic features for map layers (points / hex / heat views). |

---

## Repository layout (high level)

- **`stoppage-intelligence/frontend`** — React dashboard (map, insights, data table).  
- **`stoppage-intelligence/backend`** — FastAPI service for uploads and live analysis.  
- **`architecture.md`** — System design, APIs, clustering, and deployment.  
- **`CONTEXT.md`** — Product and initiative context (e.g. control-centre alert volumes).  
- **Root scripts / data** — Local enrichment and sample pipelines (e.g. POI join scripts, sample extracts).

---

## Disclaimer

Classifications are **model- and map-based heuristics**. They do not, by themselves, prove theft, pilferage, or policy violation. They exist to **prioritize human review** and align teams on **where and when** long stoppages deviate from obvious legitimate geography.
