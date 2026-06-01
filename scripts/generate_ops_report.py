"""Generate the top-5-cases ops handoff report.

Produces:
  - report/zepto-suspected-trips-report.md   (markdown report)
  - report/case-1-map.png … case-5-map.png  (Google Static Maps screenshots)

The report is operations-team-readable: plain English, no model/codified
jargon, no "the brain" — uses "we" throughout. Each case includes:
  - When it happened
  - Who was driving (driver + transporter profile from rollups)
  - Origin → destination
  - Why we want this trip investigated (plain English signals)
  - Map (origin marker, dest marker, route trace, halt clusters)
  - Recommended next steps

Usage: python3 scripts/generate_ops_report.py
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

import requests

ROOT = Path(__file__).resolve().parents[1]
BRAIN_DIR = ROOT / "stoppage-intelligence" / "frontend" / "public" / "zepto" / "brain"
TRIPS_JSON = ROOT / "stoppage-intelligence" / "frontend" / "public" / "zepto" / "entities" / "trips.json"
ENV_FILE = ROOT / ".env"
OUT_DIR = ROOT / "report"

# -------- env (Google Maps API key) -----------------------------------------
def _load_env_key(name: str) -> str:
    for line in ENV_FILE.read_text().splitlines():
        if line.strip().startswith(f"{name}="):
            return line.strip().split("=", 1)[1].strip().strip('"')
    return ""

GOOGLE_KEY = _load_env_key("GOOGLE_API_KEY")
if not GOOGLE_KEY:
    print("[report] WARNING: GOOGLE_API_KEY missing from .env — maps will be skipped", file=sys.stderr)


# -------- helpers ------------------------------------------------------------
def _first_token(s: str | None) -> str:
    return (s or "").strip().split()[0] if s else ""


def _ts(s: dict) -> str:
    return s.get("trip_closure_time") or s.get("first_ping_outside_origin") or ""


def _fmt_date(iso: str) -> str:
    if not iso:
        return "—"
    try:
        d = datetime.fromisoformat(iso.replace("Z", ""))
        return d.strftime("%d %b %Y, %I:%M %p")
    except Exception:
        return iso[:16]


def _short_loc(s: str | None) -> str:
    """Strip the leading warehouse code and return the human part."""
    if not s:
        return "—"
    tail = s.split(" - ", 1)[-1] if " - " in s else s
    return tail.strip() or s


def _decode_polyline(raw: str | None) -> list[tuple[float, float]]:
    if not raw or not isinstance(raw, str):
        return []
    raw = raw.strip()
    if raw.startswith("["):
        try:
            arr = json.loads(raw)
            return [(float(p[0]), float(p[1])) for p in arr if len(p) >= 2]
        except Exception:
            return []
    # Google encoded — not used in this dataset but supported
    try:
        import polyline as _p
        return _p.decode(raw)
    except Exception:
        return []


def _downsample(points: list[tuple[float, float]], n: int = 80) -> list[tuple[float, float]]:
    """Keep first, last, and ~n evenly spaced intermediates so the URL fits."""
    if len(points) <= n:
        return points
    step = len(points) / n
    sampled: list[tuple[float, float]] = []
    for i in range(n):
        sampled.append(points[int(i * step)])
    sampled.append(points[-1])
    return sampled


# -------- warehouse code → lat/lng fallback (from trips.json) ----------------
_WAREHOUSE_COORDS: dict[str, tuple[float, float]] = {}
def _load_warehouse_coords() -> dict[str, tuple[float, float]]:
    if _WAREHOUSE_COORDS:
        return _WAREHOUSE_COORDS
    if not TRIPS_JSON.exists():
        return _WAREHOUSE_COORDS
    data = json.loads(TRIPS_JSON.read_text())
    trips = data.get("trips", []) if isinstance(data, dict) else data
    for t in trips:
        oc = _first_token(t.get("origin"))
        dc = _first_token(t.get("destination"))
        if oc and t.get("origin_lat") is not None and t.get("origin_lng") is not None:
            _WAREHOUSE_COORDS.setdefault(oc, (t["origin_lat"], t["origin_lng"]))
        if dc and t.get("destination_lat") is not None and t.get("destination_lng") is not None:
            _WAREHOUSE_COORDS.setdefault(dc, (t["destination_lat"], t["destination_lng"]))
    return _WAREHOUSE_COORDS


def _resolve_endpoints(s: dict) -> tuple[tuple[float, float] | None, tuple[float, float] | None]:
    o_lat, o_lng = s.get("origin_lat"), s.get("origin_lng")
    d_lat, d_lng = s.get("destination_lat"), s.get("destination_lng")
    if o_lat is None or o_lng is None:
        hit = _load_warehouse_coords().get(_first_token(s.get("origin")))
        if hit:
            o_lat, o_lng = hit
    if d_lat is None or d_lng is None:
        hit = _load_warehouse_coords().get(_first_token(s.get("destination")))
        if hit:
            d_lat, d_lng = hit
    o = (o_lat, o_lng) if (o_lat is not None and o_lng is not None) else None
    d = (d_lat, d_lng) if (d_lat is not None and d_lng is not None) else None
    return o, d


# -------- Map image generator (OSM tiles via staticmap) ----------------------
def render_map(s: dict, out_path: Path, width: int = 900, height: int = 540) -> bool:
    """Render a Google-Maps-style static map using OSM tiles (no API key)."""
    try:
        from staticmap import StaticMap, CircleMarker, Line, IconMarker
    except ImportError:
        print("[report] staticmap not installed", file=sys.stderr)
        return False
    origin, dest = _resolve_endpoints(s)
    if not origin or not dest:
        return False
    halts = s.get("halt_clusters") or []
    poly_pts = _decode_polyline(s.get("ping_polyline", ""))

    m = StaticMap(width, height, url_template="https://a.tile.openstreetmap.org/{z}/{x}/{y}.png")
    # Route trace (light blue line under everything)
    if len(poly_pts) >= 2:
        # staticmap takes [(lng, lat), ...]
        line_pts = [(p[1], p[0]) for p in poly_pts]
        m.add_line(Line(line_pts, "#2563eb", 4))
    # Halt clusters (orange dots) — render before A/B so endpoints stay on top
    for h in halts[:30]:
        m.add_marker(CircleMarker((h["lng"], h["lat"]), "#ea580c", 9))
    # Origin (green) + Destination (red)
    m.add_marker(CircleMarker((origin[1], origin[0]), "#16a34a", 14))
    m.add_marker(CircleMarker((dest[1], dest[0]), "#dc2626", 14))
    try:
        image = m.render()
        image.save(str(out_path))
        return True
    except Exception as e:
        print(f"[report] render error: {e}", file=sys.stderr)
        return False


# -------- pick top-5 most-recent distinct patterns ---------------------------
def top_n_recent(scores: list[dict], n: int = 5) -> list[dict]:
    by_pattern: dict[tuple[str, str, str], dict] = {}
    for s in scores:
        if s.get("tier") != "high":
            continue
        k = (s.get("vehicle"), _first_token(s.get("origin")), _first_token(s.get("destination")))
        prev = by_pattern.get(k)
        if not prev or _ts(s) > _ts(prev):
            by_pattern[k] = s
    ranked = sorted(by_pattern.values(), key=lambda s: (_ts(s), s["brain_score"]), reverse=True)
    return ranked[:n]


# -------- write the markdown report -----------------------------------------
def render_report(top: list[dict], rollups: dict, out_path: Path) -> None:
    today = datetime.utcnow().strftime("%d %b %Y")
    lines: list[str] = []
    lines.append("# Suspected Trips — Operations Handoff")
    lines.append("")
    lines.append(f"**Prepared:** {today}  ")
    lines.append(f"**Cases:** Top 5 most-recent high-risk trips we want your operations team to review.")
    lines.append("")
    lines.append("> We have flagged these trips because their behaviour matches patterns we have seen in past confirmed thefts on Zepto's network. Each case below is a single trip; the report explains why we surfaced it, who was driving, and what we recommend you check on the ground.")
    lines.append("")
    lines.append("---")
    lines.append("")

    # quick top-of-page table for the ops reviewer
    lines.append("## At-a-glance")
    lines.append("")
    lines.append("| # | Date | Driver | Vehicle | Transporter | Route | Why we flagged it |")
    lines.append("|---|---|---|---|---|---|---|")
    for i, s in enumerate(top, 1):
        date = _fmt_date(_ts(s)).split(",")[0]
        why_count = len(s.get("matched_signals", []))
        route = f"{_short_loc(s.get('origin'))} → {_short_loc(s.get('destination'))}"
        lines.append(
            f"| {i} | {date} | {s.get('driver_name','—')} | {s.get('vehicle','—')} "
            f"| {s.get('transporter','—')} | {route} | {why_count} patterns matched |"
        )
    lines.append("")
    lines.append("---")
    lines.append("")

    # driver / vehicle / transporter rollup helpers
    by_driver = {r.get("driver_number"): r for r in rollups.get("drivers", [])}
    by_vehicle = {r.get("vehicle"): r for r in rollups.get("vehicles", [])}
    by_transp = {r.get("transporter"): r for r in rollups.get("transporters", [])}

    for i, s in enumerate(top, 1):
        date_str = _fmt_date(_ts(s))
        lines.append(f"## Case {i} · {s.get('driver_name','—')} on {s.get('vehicle','—')}")
        lines.append("")
        lines.append(f"**When:** {date_str}  ")
        lines.append(f"**Trip ID:** `{s['trip_id']}`  ")
        lines.append(f"**Severity:** **HIGH** (our risk score: {s['brain_score']} / 113)  ")
        lines.append("")

        # map image
        rel_img = f"case-{i}-map.png"
        img_path = OUT_DIR / rel_img
        if render_map(s, img_path):
            lines.append(f"![Map for case {i}]({rel_img})")
            lines.append("")
            lines.append("> Green dot = origin · Red dot = destination · Blue line = actual route driven · Orange dots = locations where the truck stopped during the trip.")
            lines.append("")
        else:
            lines.append("_Map unavailable for this trip — GPS path was not recorded._")
            lines.append("")

        # Why we flagged
        lines.append("### Why we want this trip investigated")
        lines.append("")
        signals = sorted(s.get("matched_signals", []), key=lambda m: -m.get("weight", 0))
        if not signals:
            lines.append("_No specific patterns fired — review only if other surfaces flag this entity._")
        for m in signals:
            text = m.get("human_text") or m.get("name", "")
            lines.append(f"- **{text}**")
        sim = (s.get("similar_cases") or [])
        if sim and sim[0].get("city"):
            pct = int(sim[0].get("similarity", 0) * 100)
            lines.append("")
            lines.append(f"> This trip's behaviour is **{pct}% similar to a confirmed past theft in {sim[0]['city']}** handled by {sim[0].get('transporter','an unknown transporter')}. We recommend you compare what happened on this trip with the operations record for that earlier incident.")
        lines.append("")

        # route + ops stats
        lines.append("### Route and operational stats")
        lines.append("")
        lines.append("| | |")
        lines.append("|---|---|")
        lines.append(f"| **Origin** | {s.get('origin','—')} |")
        lines.append(f"| **Destination** | {s.get('destination','—')} |")
        if s.get("transit_distance_km") is not None and s.get("google_distance_km") is not None:
            extra = max(0, s["transit_distance_km"] - s["google_distance_km"])
            lines.append(f"| **Distance driven** | {s['transit_distance_km']:.1f} km (planned: {s['google_distance_km']:.1f} km · extra: {extra:.1f} km) |")
        if s.get("transit_time_hrs") is not None:
            lines.append(f"| **Transit time** | {s['transit_time_hrs']:.1f} hours |")
        if s.get("stoppage_hrs") is not None:
            lines.append(f"| **Time stopped during transit** | {s['stoppage_hrs']:.1f} hours |")
        if s.get("loading_time_hrs") is not None:
            lines.append(f"| **Time spent loading at origin** | {s['loading_time_hrs']:.1f} hours |")
        if s.get("unloading_time_hrs") is not None:
            unload = s["unloading_time_hrs"]
            unload_str = f"under 6 minutes ⚠️" if unload < 0.1 else f"{unload * 60:.0f} minutes"
            lines.append(f"| **Time spent unloading at destination** | {unload_str} |")
        if s.get("eta_breach_hrs") is not None and s["eta_breach_hrs"] > 0:
            lines.append(f"| **Late vs planned ETA** | {s['eta_breach_hrs']:.1f} hours late |")
        if s.get("total_pings") is not None:
            lines.append(f"| **GPS pings recorded** | {s['total_pings']} |")
        if s.get("destination_entry") is None or s.get("destination_entry") == "":
            lines.append(f"| **Destination arrival recorded?** | No — the system never confirmed arrival ⚠️ |")
        else:
            lines.append(f"| **Destination arrival recorded?** | Yes ({_fmt_date(s['destination_entry'])}) |")
        if s.get("alerts_text"):
            lines.append(f"| **Platform alerts during the trip** | {s['alerts_text']} |")
        lines.append("")

        # Driver profile
        lines.append("### Driver profile")
        lines.append("")
        d_r = by_driver.get(s.get("driver_number"))
        lines.append(f"**Name:** {s.get('driver_name','—')}  ")
        lines.append(f"**Phone:** {s.get('driver_number','—')}  ")
        if d_r:
            lines.append(f"**Total trips we have on record:** {d_r['trips']}  ")
            lines.append(f"**Trips we have flagged for review:** {d_r['trips_with_brain_hit']} (of {d_r['trips']})  ")
            lines.append(f"**Average risk score across all their trips:** {d_r['risk_score']}  ")
        else:
            lines.append("_No prior trips for this driver on record._  ")
        lines.append("")

        # Transporter profile
        lines.append("### Transporter profile")
        lines.append("")
        t_r = by_transp.get(s.get("transporter"))
        lines.append(f"**Branch:** {s.get('transporter','—')}  ")
        if t_r:
            lines.append(f"**Total trips we have on record:** {t_r['trips']}  ")
            lines.append(f"**Trips we have flagged for review:** {t_r['trips_with_brain_hit']} (of {t_r['trips']})  ")
            lines.append(f"**Average risk score across all their trips:** {t_r['risk_score']}  ")
        else:
            lines.append("_No prior trips for this transporter on record._  ")
        lines.append("")

        # Vehicle quick reference
        v_r = by_vehicle.get(s.get("vehicle"))
        if v_r:
            lines.append("### Vehicle profile")
            lines.append("")
            lines.append(f"**Vehicle number:** {s.get('vehicle','—')}  ")
            lines.append(f"**Total trips on record for this vehicle:** {v_r['trips']}  ")
            lines.append(f"**Trips flagged for review:** {v_r['trips_with_brain_hit']}  ")
            lines.append(f"**Average risk score:** {v_r['risk_score']}  ")
            lines.append("")

        # Recommended next steps
        lines.append("### What we recommend you check")
        lines.append("")
        recs = []
        # Build context-aware recommendations from the actual signals + stats
        sig_ids = {m["id"] for m in signals}
        if "S-01" in sig_ids or "S-09" in sig_ids:
            recs.append("**Pull the actual route taken** and compare with the planned route. Ask the driver to account for the extra distance.")
        if "S-03" in sig_ids:
            recs.append("**Review the halt log** for this trip — identify every stop longer than 30 minutes and ask the supervisor whether it was scheduled.")
        if "S-10" in sig_ids:
            recs.append("**Confirm offload at the destination** — pull the delivery receipt / POD and verify physical handover happened.")
        if "S-15" in sig_ids:
            recs.append("**Verify arrival at destination** — the system never recorded the truck inside the destination geofence. Ask the destination dock supervisor whether this trip was actually received.")
        if "S-16" in sig_ids:
            recs.append("**Investigate the delay** — the trip arrived hours past the planned ETA. Ask the driver to account for the lost time.")
        if "S-17" in sig_ids:
            recs.append("**Review the in-trip platform alerts** — alerts were raised during this trip but may not have been actioned.")
        if "S-19" in sig_ids:
            recs.append("**Cross-check against past theft cases on this lane** — this same origin → destination route has had a confirmed theft before. Treat this trip as elevated-risk by default.")
        if not recs:
            recs.append("Open the trip and review the GPS path and halt log against the schedule.")
        for r in recs:
            lines.append(f"- {r}")
        lines.append("")
        lines.append("---")
        lines.append("")

    lines.append("## How to read this report")
    lines.append("")
    lines.append("- Each case is a single trip we surfaced for review based on patterns we have seen in past confirmed thefts on the Zepto network.")
    lines.append("- We are not claiming a theft happened on these trips — we are saying their behaviour matches the *kind* of behaviour we have seen in past confirmed theft cases, and we recommend you check.")
    lines.append("- A risk score of 70 or higher means the trip lands in the top 20% by behavioural risk.")
    lines.append("- Recommendations are conservative — they ask the right questions, not jump to conclusions.")
    lines.append("")
    lines.append("If your team finds genuine cause for concern on any of these trips, please share the case ID and what you found back to us — every confirmation helps us tune what we surface.")
    lines.append("")

    out_path.write_text("\n".join(lines))
    print(f"[report] wrote {out_path}")


# -------- main --------------------------------------------------------------
def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    scores = json.loads((BRAIN_DIR / "brain_scores.json").read_text())["scores"]
    rollups = json.loads((BRAIN_DIR / "brain_entity_rollups.json").read_text())
    top = top_n_recent(scores, n=5)
    print(f"[report] selected {len(top)} cases:")
    for i, s in enumerate(top, 1):
        print(f"  #{i} trip {s['trip_id']} · {_fmt_date(_ts(s))} · {s.get('driver_name','?')} · {s.get('vehicle','?')}")
    render_report(top, rollups, OUT_DIR / "zepto-suspected-trips-report.md")


if __name__ == "__main__":
    main()
