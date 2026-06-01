# Final prompt — Top 5 suspected trips · Zepto ops handoff

> Paste this **entire file** into Claude as a single message. It contains the
> role briefing, metric definitions (so the report can answer "where does this
> number come from?"), all five case data blocks, and the output format.

---

## ROLE & VOICE

You are writing a customer-facing operations handoff report for Zepto's
operations team. The report explains 5 trips we want their team to physically
investigate on the ground.

**Voice rules (non-negotiable):**

- Use **"we"** ("we flagged this trip", "we recommend you check") — never
  "the brain", "the model", "the algorithm", "the system", "AI" or any
  ML/data-science jargon.
- Plain English, ops-manager level. No technical terms like "stoppage share",
  "detour ratio", "behavioural feature vector".
- We never claim a theft happened. We say their behaviour matches what we
  have seen in past confirmed thefts and we want operations to check.
- Every calculated number must be explainable — when in doubt, include a
  one-line "how we got this" note next to it.
- Tone: confident, conservative, action-oriented. Like a senior ops lead
  briefing a junior ops lead.

**Output:**
- One markdown report.
- Title + 1-paragraph executive summary up top.
- Then the five cases, each as its own section with the same structure.
- Then a single shared "How to read these numbers" appendix at the end
  (cite this appendix from each case when you reference a calculated metric).

---

## METRIC DEFINITIONS — include this as an appendix in the report

The customer will ask "what does this number mean and where does it come
from?" for every figure on the page. Include this block verbatim (or close)
as **Appendix A · How to read these numbers** at the end of the report.

### How the trip-level metrics are calculated

- **Risk score (0–113):** The sum of weights assigned to behavioural patterns
  that matched on this single trip. Each pattern (detour, stoppage,
  unloading, ETA breach, missing arrival, etc.) carries a fixed weight; the
  score is just their sum on this trip. 0 = no patterns matched. 113 = every
  one of the nine active patterns matched simultaneously. A trip is tagged
  **HIGH** if its score is in the **top 20% of all trips we scored** in the
  current cohort.
- **Distance driven (km):** Total kilometres travelled, summed from FT's
  platform telemetry across every GPS ping the truck reported. Comes from
  the FT control-room dataset, not from us.
- **Distance planned (km):** The Google Maps driving distance from the origin
  warehouse to the destination warehouse — what the route *should* have been.
- **Extra distance:** `distance driven − distance planned`. Anything above
  15 km on a short city route is a meaningful detour.
- **Transit time (hours):** Time between gate-out from origin and trip
  closure — wall-clock duration of the trip.
- **Time stopped during transit:** Total hours the truck was stationary
  mid-trip (excluding loading and unloading windows). FT platform aggregate.
- **Time spent loading at origin:** From dock-in at origin to gate-out.
  FT platform aggregate.
- **Time spent unloading at destination:** From destination entry (dock-in)
  to trip closure. FT platform aggregate. **Under 6 minutes** after a
  multi-hour transit is structurally suspicious — cargo cannot be physically
  offloaded that fast.
- **Late vs planned ETA:** Trip closure time minus Google Maps ETA.
- **GPS pings recorded:** Raw count of pings the vehicle's tracker reported
  during this trip. A trip can have a high ping count (300+) and still have
  no exportable point-by-point path if the polyline trace wasn't preserved
  — the **aggregates above are independent of the path being visualisable**.
- **Halt cluster locations:** Spatial clusters we detect by grouping
  consecutive nearby GPS pings on the trip's path. Each cluster is one
  stationary period. Reported with lat/lng and ping count (longer dwell =
  more pings).

### How the entity profiles are calculated

For every driver / vehicle / transporter:

- **Trips on record:** Total number of their trips in the data we received
  from FT (covers Dec 2025 onwards).
- **Trips we flagged for review:** Count of their trips whose **risk score
  landed in our HIGH tier** (top 20% by score). Most of the trips on record
  for any given party will not be flagged.
- **Average risk score:** The arithmetic mean of the risk score across all
  their trips, including the unflagged clean trips. A low average (e.g. 8)
  with a few flagged trips means "most trips clean, occasional pattern
  match". A high average (e.g. 63) means "consistent pattern match across
  every trip we have for them" — far more concerning.

### How we measure "behavioural similarity to a past confirmed theft case"

For each of 13 confirmed past theft cases on the Zepto network, we extracted
a fingerprint of the behaviour observed (detour shape, halt pattern,
unloading speed, etc.). For every new trip we compute the same fingerprint
and report how close it is to each past case. The match percentage in this
report is the highest single similarity across all 13 cases — i.e., "this
trip behaves most like Case X, at N%". 100% match = the trip's behavioural
fingerprint is identical to a confirmed theft case. It is **not** a
probability of theft — it is a statement of behavioural shape.

### Why we have movement metrics without map coordinates (Case 1)

In Case 1, we have transit distance, stoppage time, ping count and ETA
breach — but no origin/destination coordinates and no map. The metrics
come from FT's platform-level trip telemetry, which records the running
totals (distance, time, pings, alerts) for every trip regardless of whether
the raw GPS point-by-point trail is exportable. **The truck was tracked
end-to-end**; we just don't have the path geometry to render a map.
The destination warehouse site code (BLR092S) is also not in our
coordinate reference table — so we can't pin the destination on a map,
but operations can still look up the warehouse address from their site
master.

---

## CASE DATA — write one section per case using this exact shape

For each case below, produce a report section with this structure:

1. **One-line headline** — date, who, what's most striking about it
2. **Quick links** — Open in product, Driver/Vehicle/Transporter profile,
   Google Maps route (where coords available)
3. **Why we want this investigated** — bullet list of pattern matches in
   plain English (from the data below)
4. **Route** — origin → destination as plain text
5. **What the numbers show** — operational stats as a small table, every
   non-obvious number cross-referenced to Appendix A
6. **Who was driving it** — driver and transporter profile in 2-3 lines each
7. **What this looks like in the past** — the similar past confirmed-theft
   case
8. **Three things we recommend ops check on the ground** — concrete,
   actionable questions

### Case 1

```
When            13 Apr 2026, 04:53 AM
Trip ID         54697494
Severity        HIGH (score 36 / 113)

Driver          Akshaya
Driver phone    7899467106
Vehicle         KA05AQ5752
Transporter     JL TRANSPORT

Origin          BLR065M - BLR-Nelamangala-DRYMH
Origin coords   not on record
Destination     BLR092S - BLR-JAYANAGAR New
Dest coords     not on record
Map availability  NO map — coordinates not in our reference; metrics
                  still valid (see Appendix A · "Why we have movement
                  metrics without map coordinates")

Distance driven           44.3 km
Distance planned          27.4 km
Extra distance            16.9 km
Transit time              1.4 h
Time stopped during transit  0.1 h
Time loading at origin    1.5 h
Time unloading at dest    403 minutes  ← this is the trip closure window;
                                          405 mins is structurally long
                                          for a city trip
Late vs planned ETA       6.7 h
GPS pings recorded        305
Arrival at destination    Yes
Platform alerts during trip  detention_origin, detention_destination,
                              route_deviation, sta_breach
```

Patterns matched (plain English):
- Truck drove much further than the planned route (25%+ extra)
- Trip arrived 4+ hours after the planned ETA
- Truck drove at least 15 km more than planned
- The platform raised alerts during the trip — detention at origin,
  detention at destination, route deviation, schedule breach

Most-similar past confirmed-theft case:
- City: Patiala
- Transporter (past): Navneet Enterprises
- Behavioural similarity: 96%
- Past investigator notes: "supervisors opened locks, gray area theft"

Driver profile: 298 trips on record · 6 flagged · avg risk 8
Transporter profile: 128 trips on record · 0 previously flagged · avg risk 4
Vehicle profile: 2 trips on record · 0 previously flagged · avg risk 18

Quick links:
- Product: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#suspected/54697494
- Driver: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?driver=7899467106
- Vehicle: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?vehicle=KA05AQ5752
- Transporter: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?transporter=JL+TRANSPORT
- Google Maps route: NOT AVAILABLE (no coordinates)

### Case 2

```
When            06 Apr 2026, 03:20 PM
Trip ID         54404420
Severity        HIGH (score 63 / 113)

Driver          Suraj
Driver phone    7459901375
Vehicle         UP32QT2997
Transporter     A&A Associates

Origin          LKO002M - LKO-DRY-MH MOHANLAL GANJ_1
Origin coords   26.65376, 80.90495
Destination     LKO005S - LKO-Aliganj
Dest coords     26.65371, 80.9051

Distance driven           52.9 km
Distance planned          36.6 km
Extra distance            16.3 km
Transit time              2.9 h
Time stopped during transit  1.3 h
Time loading at origin    1.2 h
Time unloading at dest    181 minutes
Late vs planned ETA       3.3 h
GPS pings recorded        230
Arrival at destination    Yes
Halt clusters detected    8
```

Halt clusters (lat, lng, pings stopped):
1. 26.76199, 80.85143 — 117 pings
2. 26.898094, 80.944124 — 90 pings
3. 26.931247, 80.943835 — 50 pings
4. 26.653752, 80.904943 — 32 pings
5. 26.653719, 80.905094 — 7 pings
6. 26.655172, 80.905498 — 6 pings
7. 26.764168, 80.826846 — 5 pings
8. 26.815, 80.816694 — 5 pings

Patterns matched (plain English):
- **This origin → destination route has been hit before** — a past confirmed
  theft happened on the exact same lane
- Truck spent more time stopped than moving — over 40% of the trip was stationary
- Truck drove much further than the planned route (25%+ extra)
- Truck drove at least 15 km more than planned

Most-similar past confirmed-theft case:
- City: Lucknow
- Transporter (past): A&A Associates (same transporter as this trip)
- Behavioural similarity: 100%
- Past investigator notes: "suspicious halts, blacklisted driver, narcotics"

Driver profile: 6 trips on record · **6 flagged** · avg risk 63
Transporter profile: 248 trips on record · 45 flagged · avg risk 19
Vehicle profile: 7 trips on record · **7 flagged** · avg risk 63

Quick links:
- Product: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#suspected/54404420
- Driver: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?driver=7459901375
- Vehicle: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?vehicle=UP32QT2997
- Transporter: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?transporter=A%26A+Associates
- Google Maps route: https://www.google.com/maps/dir/?api=1&origin=26.65376,80.90495&destination=26.65371,80.9051&waypoints=26.76199,80.85143|26.898094,80.944124|26.931247,80.943835|26.653752,80.904943|26.653719,80.905094|26.655172,80.905498|26.764168,80.826846|26.815,80.816694&travelmode=driving

### Case 3

```
When            15 Mar 2026, 12:30 AM
Trip ID         53345393
Severity        HIGH (score 74 / 113)

Driver          Akshaya
Driver phone    7899467106
Vehicle         KA53AC0119
Transporter     SLN TRANSPORTS

Origin          BLR065M - BLR-Nelamangala-DRYMH
Origin coords   12.88685, 77.45889
Destination     BLR274S - BLR-RR NAGAR New
Dest coords     13.08395, 77.45754

Distance driven           79.2 km        ← almost 3× planned distance
Distance planned          28.5 km
Extra distance            50.7 km
Transit time              13.8 h
Time stopped during transit  11.0 h
Time loading at origin    14.4 h         ← extreme — 14 h to load a single trip
Time unloading at dest    under 6 minutes ← structurally suspicious
Late vs planned ETA       14.8 h
GPS pings recorded        551
Arrival at destination    NO — never recorded by the system
Halt clusters detected    7
```

Halt clusters (lat, lng, pings):
1. 12.887073, 77.458683 — 93 pings (origin yard, while loading)
2. 13.084051, 77.458151 — 83 pings
3. 13.059177, 77.465767 — 35 pings
4. 13.086623, 77.447162 — 31 pings
5. 13.05698, 77.471821 — 14 pings
6. 13.003043, 77.530885 — 11 pings
7. 13.083941, 77.457539 — 7 pings

Patterns matched (plain English):
- Truck spent more time stopped than moving — over 40% of the trip was stationary
- Truck drove much further than the planned route (50 km extra on a 28 km route)
- Cargo "unloaded" in under 6 minutes after a 14-hour transit — too fast for legitimate handover
- Trip arrived 14+ hours after the planned ETA
- No record of the truck arriving at destination — trip was closed without a confirmed dock-in event
- Truck drove at least 15 km more than planned
- Loading at the origin took 14+ hours — much longer than normal

Most-similar past confirmed-theft case:
- City: Delhi
- Transporter (past): Maa Durga Transport
- Behavioural similarity: 91%
- Past investigator notes: "CCTV confirmed totes theft"

Driver profile: 298 trips on record · 6 flagged · avg risk 8
Transporter profile: 664 trips on record · 15 flagged · avg risk 10
Vehicle profile: 127 trips on record · 2 flagged · avg risk 8

Quick links:
- Product: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#suspected/53345393
- Driver: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?driver=7899467106
- Vehicle: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?vehicle=KA53AC0119
- Transporter: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?transporter=SLN+TRANSPORTS
- Google Maps route: https://www.google.com/maps/dir/?api=1&origin=12.88685,77.45889&destination=13.08395,77.45754&waypoints=12.887073,77.458683|13.084051,77.458151|13.059177,77.465767|13.086623,77.447162|13.05698,77.471821|13.003043,77.530885|13.083941,77.457539&travelmode=driving

### Case 4

```
When            09 Mar 2026, 10:31 AM
Trip ID         53073962
Severity        HIGH (score 49 / 113)

Driver          AZAM
Driver phone    8482843165
Vehicle         MH04LY2701
Transporter     Oorja

Origin          MUM054S - MUM-Borivali
Origin coords   19.27237, 72.88288
Destination     MUM-DRY-MH-SHAKTI / MUM-SS-MH-SHAKTI
Dest coords     19.32967, 73.10145

Distance driven           35.2 km
Distance planned          57.2 km   ← drove *less* than planned — short-routed
Extra distance            0 km
Transit time              8.5 h
Time stopped during transit  7.3 h  ← 86% of transit stopped
Time loading at origin    0.0 h
Time unloading at dest    under 6 minutes
Late vs planned ETA       6.7 h
GPS pings recorded        248
Arrival at destination    NO — never recorded
Halt clusters detected    1 (218 pings at the destination — truck never moved after arriving)
```

Patterns matched (plain English):
- Truck spent more time stopped than moving — over 40% of the trip was stationary
- Cargo "unloaded" in under 6 minutes after a multi-hour transit
- Trip arrived 4+ hours after the planned ETA
- No record of the truck arriving at destination — trip was closed without a confirmed dock-in event

Most-similar past confirmed-theft case:
- City: Patiala
- Transporter (past): Navneet Enterprises
- Behavioural similarity: 94%
- Past investigator notes: "supervisors opened locks, gray area theft"

Driver profile: 740 trips on record · **76 flagged** · avg risk 19
Transporter profile: 624 trips on record · **72 flagged** · avg risk 17
Vehicle profile: 1,260 trips on record · **152 flagged** · avg risk 18

Quick links:
- Product: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#suspected/53073962
- Driver: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?driver=8482843165
- Vehicle: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?vehicle=MH04LY2701
- Transporter: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?transporter=Oorja
- Google Maps route: https://www.google.com/maps/dir/?api=1&origin=19.27237,72.88288&destination=19.32967,73.10145&travelmode=driving

### Case 5

```
When            06 Mar 2026, 05:01 PM
Trip ID         52937710
Severity        HIGH (score 54 / 113)

Driver          dayaram
Driver phone    9928266411
Vehicle         RJ14GT3961
Transporter     NENCY ROAD LINES

Origin          JAI030M - KWPL_JAI-FRESH-MH
Origin coords   26.8127, 75.6689
Destination     JAI003S - JAI-Bani Park
Dest coords     26.81272, 75.66896

Distance driven           46.6 km
Distance planned          25.5 km
Extra distance            21.1 km
Transit time              2.0 h
Time stopped during transit  0.0 h
Time loading at origin    15.4 h     ← extreme load dwell at origin
Time unloading at dest    under 6 minutes
Late vs planned ETA       15.0 h
GPS pings recorded        51         ← sparse tracking — only 51 pings over the trip
Arrival at destination    NO — never recorded
Halt clusters detected    2
```

Halt clusters (lat, lng, pings):
1. 26.812639, 75.668871 — 15 pings (origin)
2. 26.907461, 75.830109 — 8 pings (off-route)

Patterns matched (plain English):
- Truck drove much further than the planned route (25%+ extra)
- Cargo "unloaded" in under 6 minutes after a multi-hour transit
- Trip arrived 15+ hours after the planned ETA
- No record of the truck arriving at destination — trip was closed without a confirmed dock-in event
- Truck drove at least 15 km more than planned
- Loading at the origin took 15+ hours — much longer than normal

Most-similar past confirmed-theft case:
- City: Lucknow
- Transporter (past): A&A Associates
- Behavioural similarity: 99%
- Past investigator notes: "suspected en-route theft"

Driver profile: 56 trips on record · 1 flagged · avg risk 10
Transporter profile: 70 trips on record · 2 flagged · avg risk 13
Vehicle profile: 56 trips on record · 1 flagged · avg risk 10

Quick links:
- Product: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#suspected/52937710
- Driver: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?driver=9928266411
- Vehicle: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?vehicle=RJ14GT3961
- Transporter: https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/#investigate?transporter=NENCY+ROAD+LINES
- Google Maps route: https://www.google.com/maps/dir/?api=1&origin=26.8127,75.6689&destination=26.81272,75.66896&waypoints=26.812639,75.668871|26.907461,75.830109&travelmode=driving

---

## OUTPUT FORMAT

Produce one markdown file with this top-level structure:

```
# Suspected trips — operations handoff (5 cases)
Prepared <today's date>

## Executive summary
[2–3 sentences. What these 5 trips have in common. What we want Zepto ops to do.]

## At-a-glance
[A single table with rows = 5 cases, columns = date, driver, vehicle,
 transporter, route summary, risk score, headline reason. Link the Trip ID
 cell to the "Open in product" URL.]

## Case 1 — <one-line headline>
[Full structured section using the case-data shape above:
  - Quick links (bullet list with the 5 URLs)
  - Why we want this investigated (bullets)
  - Route (origin → destination as plain text)
  - What the numbers show (small table, with footnote references to Appendix A
    for any non-obvious metric)
  - Who was driving (Driver profile + Transporter profile paragraphs)
  - What this looks like in the past (the similar past case + behavioural similarity)
  - Three things we recommend ops check on the ground (specific, actionable bullets)
]

## Case 2 — …
## Case 3 — …
## Case 4 — …
## Case 5 — …

## Appendix A · How to read these numbers
[Reproduce the "METRIC DEFINITIONS" block above. Customers will reference this
 when they ask "where did 25%+ come from?" or "what is risk score?"]

## Appendix B · How we built this watchlist
[Two short paragraphs:
  (1) We received the dataset of past confirmed thefts on the Zepto network
      and extracted the behavioural patterns those trips had in common.
  (2) We applied the same pattern checks to every trip in your network for
      the last month and surfaced the ones that match those patterns. We are
      not claiming a theft happened on these trips — we are saying their
      behaviour looks like the past confirmed cases and we recommend
      operations check.
]
```

**Length target:** ~6–8 pages printed.

**Numbers in tables:** keep them readable. When a number is striking
(50 km detour on a 28 km route, 6-minute unloading after 14 h transit),
italicise or bold it.

**Recommendations for ops:** be specific and physical. Examples of good
recommendations:

- "Pull the delivery receipt / POD for this trip and confirm a physical
  handover was signed for at <destination>."
- "Ask the destination dock supervisor whether the truck was actually
  received on <date>; the system never recorded a dock-in event."
- "Compare this trip's route in Google Maps (link above) with the planned
  route — ask the driver to account for the extra 50 km on a 28 km lane."
- "Cross-check this driver's other trips for the same week — the linked
  driver profile in the product shows their history."

Avoid generic recommendations like "investigate this driver" — give the
ops team a specific question to take to the ground.

---

## STOP CONDITIONS

- If a metric isn't explained in Appendix A, do **not** invent a definition
  — either remove the metric or note that it needs definition.
- If you don't have a Google Maps link for a case (Case 1), say so plainly
  in that case's quick-links block — don't link to a broken URL.
- Keep the "we" voice rigorously. If you catch yourself writing "the system
  detected" or "the model identified", rewrite as "we observed" or "we
  flagged".
- Do not promise the customer that a theft happened on these trips.
