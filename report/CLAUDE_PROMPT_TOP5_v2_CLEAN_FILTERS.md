# Final prompt — Top 5 suspected trips · Zepto ops handoff (updated)

> Paste this **entire file** into Claude as a single message. Same structure as the v1 prompt — but all 5 cases now pass a stricter quality filter:
> 1. Origin and destination must be different places (≥5 km apart) — no degenerate same-warehouse round-trips.
> 2. The trip must have a real planned route (≥10 km planned distance).
> 3. The trip must have at least one halt cluster **>2 km from BOTH origin and destination** — i.e., a real in-transit stoppage, not just a slow dock-in at the destination.
> 4. Each case is a distinct driver (no driver appears twice — operations gets 5 different parties to look at).

---

## ROLE & VOICE

You are writing a customer-facing operations handoff report for Zepto's operations team. The report explains 5 trips we want their team to physically investigate on the ground.

**Voice rules (non-negotiable):**
- Use **"we"** ("we flagged this trip", "we recommend you check") — never "the brain", "the model", "the algorithm", "the system", "AI" or any ML/data-science jargon.
- Plain English, ops-manager level. No technical terms like "stoppage share", "detour ratio", "behavioural feature vector".
- We never claim a theft happened. We say their behaviour matches what we have seen in past confirmed thefts and we want operations to check.
- Every calculated number must be explainable — when in doubt, include a one-line "how we got this" note next to it.
- Tone: confident, conservative, action-oriented. Like a senior ops lead briefing a junior ops lead.

**Output:**
- One markdown report. Title + 1-paragraph executive summary, then 5 case sections, then Appendix A (metric definitions) and Appendix B (how we built the watchlist).

---

## METRIC DEFINITIONS — include as Appendix A in the report

### How the trip-level metrics are calculated
- **Risk score (0–113):** The sum of weights assigned to behavioural patterns that matched on this single trip. Each pattern (detour, in-transit stoppage, unloading speed, ETA breach, missing arrival, etc.) carries a fixed weight; the score is just their sum. 0 = no patterns matched. 113 = every one of the nine active patterns matched simultaneously. A trip is tagged **HIGH** if its score is in the **top 20% of all trips we scored** in the current cohort.
- **Distance driven / planned (km):** Driven is summed from FT's platform telemetry across every GPS ping. Planned is the Google Maps driving distance from origin to destination. Extra = driven − planned.
- **Transit time (hours):** Wall-clock duration of the trip — gate-out from origin to trip closure.
- **Time stopped during transit:** Total stationary hours mid-trip (excluding loading and unloading windows). FT platform aggregate.
- **Time spent loading at origin:** From dock-in at origin to gate-out.
- **Time spent unloading at destination:** From destination entry to trip closure. **Under 6 minutes** after a multi-hour transit is structurally suspicious — cargo cannot be physically offloaded that fast.
- **In-transit halt clusters:** Locations where consecutive GPS pings clustered (the truck stopped). We only count clusters that are **>2 km from both origin and destination** — i.e., real on-road stoppages, not warehouse dock dwell.
- **Late vs planned ETA:** Trip closure time minus Google Maps ETA.
- **GPS pings recorded:** Raw count from the vehicle's tracker. A trip can have a high count and still have no exportable path geometry — aggregates above are independent of path visualisation.

### How the entity profiles are calculated
- **Trips on record:** Total trips for this party in the FT data we received (covers Dec 2025 onwards).
- **Trips we flagged for review:** Count whose risk score landed in our HIGH tier (top 20%).
- **Average risk score:** Arithmetic mean across all their trips, including clean ones. Low average (≤10) with a few flagged trips = mostly clean, occasional pattern. High average (50+) = consistent pattern across most trips.

### How we measure "behavioural similarity to a past confirmed theft case"
For each of 13 confirmed past theft cases on the Zepto network, we extracted a behavioural fingerprint (detour shape, halt pattern, unloading speed, etc.). For every new trip we compute the same fingerprint and report the highest single similarity to any past case. 100% = identical fingerprint. **Not** a probability of theft — a statement of behavioural shape.

---

## OUTPUT FORMAT

Produce a single markdown report:

```
# Suspected trips — operations handoff (5 cases)
Prepared <today's date>

## Executive summary
[2-3 sentences. What these 5 trips have in common — all have real in-transit stoppages >2 km from endpoints. What we want Zepto ops to do.]

## At-a-glance table
[5 rows. Columns: date, driver, vehicle, transporter, route, risk score, headline reason.]

## Case 1 — <one-line headline>
[Sections: why we want this investigated · route · what the numbers show · who was driving · what this looks like in the past · 3 things ops should check on the ground]

## Case 2 …
## Case 3 …
## Case 4 …
## Case 5 …

## Appendix A · How to read these numbers
[Reproduce the metric-definitions block above.]

## Appendix B · How we built this watchlist
[Two short paragraphs: (1) we extracted the behavioural patterns common to 13 past confirmed thefts on the Zepto network; (2) we applied the same checks to every recent trip and surfaced the ones whose behaviour matches AND that have real in-transit stoppages worth investigating. We are not claiming theft happened; we recommend operations check.]
```

**Stop conditions:** keep "we" voice rigorously; do not invent metric definitions not in Appendix A; do not claim a theft happened.

---

## CASE DATA

### Case 1

```
When            15 Mar 2026, 12:30 AM
Trip ID         53345393
Severity        HIGH (score 74 / 113)

Driver          Akshaya
Driver phone    7899467106
Vehicle         KA53AC0119
Transporter     SLN TRANSPORTS

Origin          BLR065M - BLR-Nelamangala-DRYMH
Destination     BLR274S-BLR-RR NAGAR New
Route distance  ~22 km straight-line origin→destination

Distance driven          79.2 km
Distance planned         28.5 km
Extra distance           50.7 km
Transit time             13.8 h
Time stopped in transit  11.0 h
Time loading at origin   14.4 h
Time unloading at dest   under 6 minutes (suspicious)
Late vs planned ETA      14.8 h
GPS pings recorded       551
Arrival at destination   NOT recorded
In-transit halt clusters 3 (of 7 total — each is at least 2 km from both origin and destination)
```

**Patterns matched (plain English):**
- The truck spent more time stopped than moving — over 40% of the trip was stationary. That much halt time on a delivery run is unusual.
- The truck drove much further than the planned route — at least 25% extra distance. That kind of detour usually means an unscheduled stop or a route swap mid-trip.
- The cargo was 'unloaded' in under 6 minutes after a multi-hour transit. That's too fast for legitimate offload — usually means the cargo wasn't actually delivered, or was already gone.
- The trip arrived 4+ hours after the planned ETA — far beyond normal traffic variance. That much delay usually means an unaccounted detour or extended stop.
- There's no record of the truck actually arriving at the destination. The trip was closed without a confirmed dock-in event.
- The truck drove at least 15km more than the planned distance. On a short city run, that's a significant detour off the optimal route.
- Loading at the origin took 3+ hours — much longer than normal. That extended dwell is a window where cargo can be swapped or tampered with before the trip even starts.

**Most-similar past confirmed-theft case:** Delhi · Maa Durga Transport · **91% behavioural match**
- Investigator notes from that past case: *"CCTV confirmed totes theft"*

**Where the in-transit halts happened (longest first):**
- (13.059177, 77.465767) — 35 pings · 19.2 km from origin · 2.9 km from destination
- (13.05698, 77.471821) — 14 pings · 19.0 km from origin · 3.4 km from destination
- (13.003043, 77.530885) — 11 pings · 15.1 km from origin · 12.0 km from destination

**Driver profile:** 298 trips on record · 6 flagged for review · average risk score 8
**Transporter profile:** 664 trips on record · 15 flagged · average risk 10
**Vehicle profile:** 127 trips on record · 2 flagged · average risk 8

---

### Case 2

```
When            02 Mar 2026, 06:33 PM
Trip ID         52783162
Severity        HIGH (score 39 / 113)

Driver          Anuj
Driver phone    9515172667
Vehicle         TG07U3765
Transporter     Rans Transline

Origin          VJW003S - VJW-HB Colony
Destination     HYD004M - HYD-MH 3
Route distance  ~255 km straight-line origin→destination

Distance driven          309.2 km
Distance planned         305.2 km
Extra distance           4.0 km
Transit time             16.2 h
Time stopped in transit  8.7 h
Time loading at origin   0.0 h
Time unloading at dest   under 6 minutes (suspicious)
Late vs planned ETA      0.0 h
GPS pings recorded       391
Arrival at destination   NOT recorded
In-transit halt clusters 4 (of 7 total — each is at least 2 km from both origin and destination)
```

**Patterns matched (plain English):**
- The truck spent more time stopped than moving — over 40% of the trip was stationary. That much halt time on a delivery run is unusual.
- The cargo was 'unloaded' in under 6 minutes after a multi-hour transit. That's too fast for legitimate offload — usually means the cargo wasn't actually delivered, or was already gone.
- There's no record of the truck actually arriving at the destination. The trip was closed without a confirmed dock-in event.

**Most-similar past confirmed-theft case:** Bengaluru · GM enterprises · **87% behavioural match**
- Investigator notes from that past case: *"theft confirmed"*

**Where the in-transit halts happened (longest first):**
- (16.884024, 80.162106) — 37 pings · 58.3 km from origin · 197.7 km from destination
- (17.284588, 78.777002) — 9 pings · 208.7 km from origin · 52.1 km from destination
- (17.598411, 78.490775) — 8 pings · 251.1 km from origin · 7.4 km from destination
- (17.145025, 79.594267) — 6 pings · 124.3 km from origin · 130.7 km from destination

**Driver profile:** 64 trips on record · 4 flagged for review · average risk score 18
**Transporter profile:** 60 trips on record · 3 flagged · average risk 17
**Vehicle profile:** 53 trips on record · 3 flagged · average risk 16

---

### Case 3

```
When            23 Feb 2026, 06:33 PM
Trip ID         52434328
Severity        HIGH (score 30 / 113)

Driver          Basava
Driver phone    9945962316
Vehicle         KA05AQ5755
Transporter     JL TRANSPORT

Origin          BLR125S - BLR-Yallapa Garden
Destination     BLR065M - BLR-Nelamangala-DRYMH
Route distance  ~13 km straight-line origin→destination

Distance driven          26.5 km
Distance planned         20.3 km
Extra distance           6.2 km
Transit time             4.2 h
Time stopped in transit  3.2 h
Time loading at origin   0.0 h
Time unloading at dest   33 minutes
Late vs planned ETA      0.7 h
GPS pings recorded       158
Arrival at destination   Yes (23 Feb 2026, 05:58 PM)
In-transit halt clusters 1 (of 3 total — each is at least 2 km from both origin and destination)
```

**Patterns matched (plain English):**
- The truck spent more time stopped than moving — over 40% of the trip was stationary. That much halt time on a delivery run is unusual.
- The truck drove much further than the planned route — at least 25% extra distance. That kind of detour usually means an unscheduled stop or a route swap mid-trip.

**Most-similar past confirmed-theft case:** Lucknow · A&A Associates · **91% behavioural match**
- Investigator notes from that past case: *"suspected en-route theft"*

**Where the in-transit halts happened (longest first):**
- (13.08418, 77.41441) — 100 pings · 16.9 km from origin · 4.7 km from destination

**Driver profile:** 135 trips on record · 0 flagged for review · average risk score 4
**Transporter profile:** 128 trips on record · 0 flagged · average risk 4
**Vehicle profile:** 126 trips on record · 0 flagged · average risk 4

---

### Case 4

```
When            16 Feb 2026, 02:13 PM
Trip ID         52080256
Severity        HIGH (score 30 / 113)

Driver          Vinod
Driver phone    8431295804
Vehicle         KA52B2278
Transporter     GM enterprises

Origin          DEV002S - DEV-MCC
Destination     BLR065M - BLR-Nelamangala-DRYMH
Route distance  ~222 km straight-line origin→destination

Distance driven          240.4 km
Distance planned         247.1 km
Extra distance           0.0 km
Transit time             12.9 h
Time stopped in transit  7.5 h
Time loading at origin   0.0 h
Time unloading at dest   under 6 minutes (suspicious)
Late vs planned ETA      0.4 h
GPS pings recorded       382
Arrival at destination   Yes (16 Feb 2026, 02:10 PM)
In-transit halt clusters 6 (of 6 total — each is at least 2 km from both origin and destination)
```

**Patterns matched (plain English):**
- The truck spent more time stopped than moving — over 40% of the trip was stationary. That much halt time on a delivery run is unusual.
- The cargo was 'unloaded' in under 6 minutes after a multi-hour transit. That's too fast for legitimate offload — usually means the cargo wasn't actually delivered, or was already gone.

**Most-similar past confirmed-theft case:** Noida · JSP logistics · **88% behavioural match**
- Investigator notes from that past case: *"suspected en-route theft"*

**Where the in-transit halts happened (longest first):**
- (14.338239, 76.211876) — 157 pings · 30.7 km from origin · 193.9 km from destination
- (13.067601, 77.448869) — 35 pings · 222.5 km from origin · 2.1 km from destination
- (13.614111, 76.953249) — 8 pings · 142.0 km from origin · 80.4 km from destination
- (13.114223, 77.37533) — 7 pings · 213.1 km from origin · 9.6 km from destination
- (13.276018, 77.193508) — 5 pings · 186.5 km from origin · 35.7 km from destination

**Driver profile:** 275 trips on record · 14 flagged for review · average risk score 16
**Transporter profile:** 111 trips on record · 10 flagged · average risk 16
**Vehicle profile:** 267 trips on record · 14 flagged · average risk 16

---

### Case 5

```
When            10 Feb 2026, 05:03 PM
Trip ID         51798272
Severity        HIGH (score 62 / 113)

Driver          Akash
Driver phone    8544870833
Vehicle         PB65BD2551
Transporter     Navneet Enterprises

Origin          PAT002M - PAT-DRY-MH-RAJPURA_1
Destination     PNK001S - PNK-BUDANPUR
Route distance  ~9 km straight-line origin→destination

Distance driven          47.7 km
Distance planned         43.5 km
Extra distance           4.2 km
Transit time             5.5 h
Time stopped in transit  3.8 h
Time loading at origin   4.3 h
Time unloading at dest   230 minutes
Late vs planned ETA      4.0 h
GPS pings recorded       284
Arrival at destination   Yes (10 Feb 2026, 01:07 PM)
In-transit halt clusters 1 (of 2 total — each is at least 2 km from both origin and destination)
```

**Patterns matched (plain English):**
- This origin → destination route has been hit before. A past confirmed theft happened on the exact same lane.
- The truck spent more time stopped than moving — over 40% of the trip was stationary. That much halt time on a delivery run is unusual.
- The trip arrived 4+ hours after the planned ETA — far beyond normal traffic variance. That much delay usually means an unaccounted detour or extended stop.
- Loading at the origin took 3+ hours — much longer than normal. That extended dwell is a window where cargo can be swapped or tampered with before the trip even starts.

**Most-similar past confirmed-theft case:** Patiala · Navneet Enterprises · **100% behavioural match**
- Investigator notes from that past case: *"supervisors opened locks, gray area theft"*

**Where the in-transit halts happened (longest first):**
- (30.682322, 76.844362) — 112 pings · 22.8 km from origin · 31.7 km from destination

**Driver profile:** 7 trips on record · 5 flagged for review · average risk score 50
**Transporter profile:** 7 trips on record · 5 flagged · average risk 50
**Vehicle profile:** 7 trips on record · 5 flagged · average risk 50

---
