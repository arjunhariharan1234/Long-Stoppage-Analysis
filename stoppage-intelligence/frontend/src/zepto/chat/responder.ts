// Chat responder — routes a user question to deterministic lookups against the
// pre-computed JSON datasets. Each response is structured (cards, metrics, table,
// map) so the chat UI can render rich answers, not just text bubbles.

import type {
  DriverRollup, VehicleRollup, TransporterRollup, RouteRollup, EventRow, Verdict,
} from "../types";

export interface BotMetric {
  label: string;
  value: string;
  tone?: "default" | "warning" | "critical" | "good";
}

export interface BotTableCell {
  text: string;
  align?: "left" | "right";
  emphasis?: boolean;
}

export interface BotTable {
  columns: string[];
  rows: BotTableCell[][];
}

export interface BotResponse {
  intent: string;
  headline: string;
  subhead?: string;
  metrics?: BotMetric[];
  findingPoints?: string[];
  table?: BotTable;
  mapFocus?: { lat: number; lng: number; zoom?: number };
  followups?: string[];
  source?: string;
  notFound?: boolean;
}

export interface ChatData {
  drivers: DriverRollup[];
  vehicles: VehicleRollup[];
  transporters: TransporterRollup[];
  routes: RouteRollup[];
  events: EventRow[];
  verdicts: Verdict[];
}

// ---------- helpers ----------

const VEHICLE_RE = /\b[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{3,4}\b/i;

function fmt(n: number) { return n.toLocaleString("en-IN"); }
function pct(x: number) { return `${Math.round(x * 100)}%`; }
function hr(x: number) { return `${x.toFixed(1)} hr`; }

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function eventsFor(data: ChatData, where: (e: EventRow) => boolean): EventRow[] {
  return data.events.filter(where);
}

function unknownPoiCount(events: EventRow[]): number {
  return events.filter(e => {
    const d = +(e.distance_to_poi_km ?? 0);
    const t = (e.nearest_poi_type || "").toLowerCase();
    return d > 0.3 && !["fuel","toll_booth","restaurant","fast_food","cafe","hotel","motel","rest_area","dhaba","truck_stop","parking"].includes(t);
  }).length;
}

function topRecurringClusters(events: EventRow[], topN = 5) {
  const m = new Map<string, { count: number; lat: number; lng: number; poi: string }>();
  for (const e of events) {
    const cur = m.get(e.cluster_id);
    if (cur) cur.count += 1;
    else m.set(e.cluster_id, { count: 1, lat: e.alert_lat, lng: e.alert_lng, poi: e.nearest_poi_name || "Unmapped" });
  }
  return [...m.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

// ---------- intent: vehicle profile ----------

function vehicleProfile(query: string, data: ChatData): BotResponse | null {
  const match = query.match(VEHICLE_RE);
  if (!match) return null;
  const vehicleNo = match[0].replace(/\s/g, "").toUpperCase();
  const v = data.vehicles.find(x => x.vehicle_number.replace(/\s/g, "").toUpperCase() === vehicleNo);
  if (!v) {
    return {
      intent: "vehicle_profile",
      headline: `No risk profile available for ${vehicleNo}`,
      subhead: "Vehicle isn't in the top-500 risk-ranked vehicles for the analyzed window. It may have very few in-transit halts (< 5) or no halts that triggered scoring.",
      notFound: true,
      source: "zepto_long_stoppage · entity rollup",
      followups: [
        "Show top 10 high-risk reefer vehicles",
        "Which vehicles stop most often at unknown locations?",
      ],
    };
  }
  const myEvents = eventsFor(data, e => e.vehicle_number.replace(/\s/g, "").toUpperCase() === vehicleNo);
  const clusters = topRecurringClusters(myEvents, 4);
  const unknownN = unknownPoiCount(myEvents);
  const focus = clusters[0] ? { lat: clusters[0].lat, lng: clusters[0].lng, zoom: 11 } : undefined;

  return {
    intent: "vehicle_profile",
    headline: `Risk profile — Vehicle ${v.vehicle_number}`,
    subhead: `${v.vehicle_type} · ${v.dedicated === "Yes" ? "Dedicated" : v.dedicated === "No" ? "Non-dedicated" : "Unknown dedication"} · ${v.top_transporter}`,
    metrics: [
      { label: "Risk score", value: `${v.risk_score} / 100`, tone: v.risk_score >= 70 ? "critical" : v.risk_score >= 50 ? "warning" : "default" },
      { label: "In-transit halts", value: fmt(v.halt_count) },
      { label: "Distinct locations", value: fmt(v.unique_clusters) },
      { label: "Drivers seen", value: fmt(v.unique_drivers) },
      { label: "Night share", value: pct(v.night_share), tone: v.night_share >= 0.5 ? "warning" : "default" },
      { label: "Median stop", value: hr(v.median_duration_hrs) },
    ],
    findingPoints: [
      v.night_share >= 0.5 ? `Night-dominant pattern (${pct(v.night_share)} of stops between 22:00–04:00).` : `Stops span day and night; ${pct(v.night_share)} occur overnight.`,
      v.is_reefer ? "Reefer vehicle — every off-grid stop carries cold-chain exposure." : "Dry-cargo vehicle.",
      unknownN > 0 ? `${unknownN} of ${myEvents.length} halts are at locations with no logistics POI within range — review.` : "All halts have a plausible logistics POI nearby.",
      clusters[0] ? `Most-visited spot: ${clusters[0].poi} at ${clusters[0].lat.toFixed(3)}, ${clusters[0].lng.toFixed(3)} — visited ${clusters[0].count} times.` : "",
    ].filter(Boolean) as string[],
    table: clusters.length ? {
      columns: ["Location", "Coords", "Visits"],
      rows: clusters.map(c => [
        { text: c.poi === "Unnamed" ? "Unmapped roadside" : c.poi },
        { text: `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` },
        { text: `${c.count}×`, emphasis: true, align: "right" },
      ]),
    } : undefined,
    mapFocus: focus,
    followups: [
      `Who are the drivers of ${v.vehicle_number}?`,
      `Show trips of ${v.vehicle_number} that stopped > 2 hours`,
      v.top_transporter ? `Risk profile of ${v.top_transporter}` : "Top high-risk transporters",
    ],
    source: `zepto_long_stoppage · entity_rollup.vehicles where vehicle_number = '${v.vehicle_number}'`,
  };
}

// ---------- intent: driver profile ----------

function driverProfile(query: string, data: ChatData): BotResponse | null {
  // match by phone number (10 digits) OR by name fuzzy
  const phoneMatch = query.match(/\b\d{10}\b/);
  let d: DriverRollup | undefined;
  if (phoneMatch) {
    d = data.drivers.find(x => x.driver_number === phoneMatch[0]);
  }
  if (!d) {
    // Try driver name match — look for capitalized words ≥ 3 chars
    const tokens = query.toUpperCase().split(/\W+/).filter(t => t.length >= 3);
    for (const t of tokens) {
      d = data.drivers.find(x => x.driver_name.toUpperCase() === t);
      if (d) break;
    }
    if (!d) {
      for (const t of tokens) {
        d = data.drivers.find(x => x.driver_name.toUpperCase().includes(t));
        if (d) break;
      }
    }
  }
  if (!d) return null;

  const myEvents = eventsFor(data, e => e.driver_number === d!.driver_number);
  const clusters = topRecurringClusters(myEvents, 4);
  const unknownN = unknownPoiCount(myEvents);
  const focus = clusters[0] ? { lat: clusters[0].lat, lng: clusters[0].lng, zoom: 11 } : undefined;

  return {
    intent: "driver_profile",
    headline: `Risk profile — ${d.driver_name} (${d.driver_number})`,
    subhead: `${d.top_transporter || "Multiple transporters"} · ${d.unique_vehicles} vehicles seen · ${d.unique_clusters} distinct halt locations`,
    metrics: [
      { label: "Risk score", value: `${d.risk_score} / 100`, tone: d.risk_score >= 70 ? "critical" : d.risk_score >= 50 ? "warning" : "default" },
      { label: "In-transit halts", value: fmt(d.halt_count) },
      { label: "Night share", value: pct(d.night_share), tone: d.night_share >= 0.5 ? "warning" : "default" },
      { label: "Reefer share", value: pct(d.reefer_share) },
      { label: "Median stop", value: hr(d.median_duration_hrs) },
    ],
    findingPoints: [
      d.unique_vehicles > 3 ? `Drives ${d.unique_vehicles} different vehicles — review whether assignment is consistent with transporter policy.` : `Stable assignment: ${d.unique_vehicles} vehicle(s) only.`,
      d.night_share >= 0.5 ? `${pct(d.night_share)} of halts are between 22:00–04:00 — operating predominantly at night.` : "",
      d.reefer_share >= 0.5 ? `${pct(d.reefer_share)} of halts on reefer cargo — cold-chain accountability applies.` : "",
      unknownN > 0 ? `${unknownN} halts at unknown/non-logistics locations across the period.` : "",
      clusters[0] ? `Most-visited spot: ${clusters[0].poi} (${clusters[0].count}×).` : "",
    ].filter(Boolean) as string[],
    table: clusters.length ? {
      columns: ["Location", "Coords", "Visits"],
      rows: clusters.map(c => [
        { text: c.poi === "Unnamed" ? "Unmapped roadside" : c.poi },
        { text: `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` },
        { text: `${c.count}×`, emphasis: true, align: "right" },
      ]),
    } : undefined,
    mapFocus: focus,
    followups: [
      `Which vehicles has ${d.driver_name} driven?`,
      `Show trips of ${d.driver_name} with halt > 4 hours`,
      `Risk profile of ${d.top_transporter}`,
    ],
    source: `zepto_long_stoppage · entity_rollup.drivers where driver_number = '${d.driver_number}'`,
  };
}

// ---------- intent: transporter profile ----------

function transporterProfile(query: string, data: ChatData): BotResponse | null {
  const tokens = query.toUpperCase().split(/[\s,.!?]+/).filter(t => t.length >= 3);
  let t: TransporterRollup | undefined;
  // best match by substring
  let best: { t: TransporterRollup; score: number } | null = null;
  for (const x of data.transporters) {
    const tn = x.transporter_branch.toUpperCase();
    let score = 0;
    for (const tok of tokens) {
      if (tn.includes(tok)) score += tok.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { t: x, score };
  }
  if (best && best.score >= 5) t = best.t;
  if (!t) return null;

  const myEvents = eventsFor(data, e => e.transporter_branch === t!.transporter_branch);
  const clusters = topRecurringClusters(myEvents, 4);
  const unknownN = unknownPoiCount(myEvents);
  const focus = clusters[0] ? { lat: clusters[0].lat, lng: clusters[0].lng, zoom: 6 } : undefined;

  return {
    intent: "transporter_profile",
    headline: `Risk profile — ${t.transporter_branch}`,
    subhead: `${t.unique_drivers} drivers · ${t.unique_vehicles} vehicles · ${t.unique_clusters} distinct halt locations`,
    metrics: [
      { label: "Risk score", value: `${t.risk_score} / 100`, tone: t.risk_score >= 70 ? "critical" : t.risk_score >= 50 ? "warning" : "default" },
      { label: "In-transit halts", value: fmt(t.halt_count) },
      { label: "Night share", value: pct(t.night_share), tone: t.night_share >= 0.5 ? "warning" : "default" },
      { label: "Reefer share", value: pct(t.reefer_share) },
      { label: "Median stop", value: hr(t.median_duration_hrs) },
    ],
    findingPoints: [
      `${t.unique_drivers} drivers and ${t.unique_vehicles} vehicles contribute to the halt volume.`,
      t.night_share >= 0.4 ? `${pct(t.night_share)} of halts overnight — concentrated operating window.` : "",
      unknownN > 0 ? `${unknownN} halts at unknown/non-logistics locations — candidate for branch-level review.` : "",
      clusters[0] ? `Most-recurring spot: ${clusters[0].poi}, visited ${clusters[0].count} times.` : "",
    ].filter(Boolean) as string[],
    table: clusters.length ? {
      columns: ["Location", "Coords", "Visits"],
      rows: clusters.map(c => [
        { text: c.poi === "Unnamed" ? "Unmapped roadside" : c.poi },
        { text: `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` },
        { text: `${c.count}×`, emphasis: true, align: "right" },
      ]),
    } : undefined,
    mapFocus: focus,
    followups: [
      `Which drivers from ${t.transporter_branch} have the highest risk?`,
      `Show me reefer vehicles of ${t.transporter_branch}`,
      "Compare top 4 transporters by risk",
    ],
    source: `zepto_long_stoppage · entity_rollup.transporters where transporter_branch = '${t.transporter_branch}'`,
  };
}

// ---------- intent: trip lookup ----------

function tripLookup(query: string, data: ChatData): BotResponse | null {
  const m = query.match(/\b\d{7,9}\b/);  // trip_id is 8-digit-ish
  if (!m) return null;
  const trip = m[0];
  const tripEvents = eventsFor(data, e => e.trip_id === trip);
  if (!tripEvents.length) return null;
  const totalHalts = tripEvents.length;
  const totalDur = tripEvents.reduce((acc, e) => acc + (+e.long_stoppage_duration_hrs || 0), 0);
  const e0 = tripEvents[0];
  return {
    intent: "trip_lookup",
    headline: `Trip ${trip} · ${totalHalts} in-transit halts`,
    subhead: `${e0.origin?.split(" - ")[0]} → ${e0.destination?.split(" - ")[0]} · ${e0.driver_name} (${e0.driver_number}) · ${e0.vehicle_number} · ${e0.transporter_branch}`,
    metrics: [
      { label: "Halts", value: fmt(totalHalts) },
      { label: "Total stopped", value: hr(totalDur) },
      { label: "Longest stop", value: hr(Math.max(...tripEvents.map(e => +e.long_stoppage_duration_hrs))) },
      { label: "Vehicle type", value: e0.vehicle_type },
      { label: "Net weight", value: e0.net_weight ? `${Math.round(+e0.net_weight)} kg` : "—" },
    ],
    findingPoints: [],
    table: {
      columns: ["Time", "Duration", "Nearest POI", "POI km", "Escalation"],
      rows: tripEvents
        .sort((a, b) => a.alert_created_at.localeCompare(b.alert_created_at))
        .slice(0, 12)
        .map(e => [
          { text: e.alert_created_at },
          { text: hr(+e.long_stoppage_duration_hrs), align: "right" },
          { text: e.nearest_poi_name || "—" },
          { text: e.distance_to_poi_km != null && e.distance_to_poi_km !== "" ? `${(+e.distance_to_poi_km).toFixed(2)} km` : "—", align: "right" },
          { text: `${e.escalation_level || "—"}`, align: "right" },
        ]),
    },
    mapFocus: { lat: e0.alert_lat, lng: e0.alert_lng, zoom: 9 },
    followups: [
      `Risk profile of ${e0.vehicle_number}`,
      `Risk profile of ${e0.driver_name}`,
      `Risk profile of ${e0.transporter_branch}`,
    ],
    source: `zepto_long_stoppage where trip_id = ${trip}`,
  };
}

// ---------- intent: top-N ----------

function topN(query: string, data: ChatData): BotResponse | null {
  const q = query.toLowerCase();
  const asksTop = /\btop\s+\d+\b|\bhighest\b|\bmost\b|\blist\b|\bshow me\b|\bbiggest\b/.test(q);
  if (!asksTop) return null;
  const num = q.match(/top\s+(\d+)/);
  const N = num ? Math.min(20, Math.max(3, parseInt(num[1]))) : 10;

  if (/reefer/.test(q) && /vehicle/.test(q)) {
    const list = data.vehicles.filter(v => v.is_reefer).slice(0, N);
    return {
      intent: "top_n_vehicles_reefer",
      headline: `Top ${N} high-risk reefer vehicles`,
      subhead: `Sorted by composite risk score across in-transit halts.`,
      table: {
        columns: ["Vehicle", "Type", "Halts", "Locations", "Night %", "Risk"],
        rows: list.map(v => [
          { text: v.vehicle_number, emphasis: true },
          { text: v.vehicle_type },
          { text: fmt(v.halt_count), align: "right" },
          { text: fmt(v.unique_clusters), align: "right" },
          { text: pct(v.night_share), align: "right" },
          { text: `${v.risk_score}`, align: "right", emphasis: true },
        ]),
      },
      followups: list.slice(0, 3).map(v => `Risk profile of ${v.vehicle_number}`),
      source: `zepto_long_stoppage · entity_rollup.vehicles where is_reefer = true`,
    };
  }
  if (/transporter/.test(q)) {
    const list = data.transporters.slice(0, N);
    return {
      intent: "top_n_transporters",
      headline: `Top ${N} transporters by composite risk`,
      table: {
        columns: ["Transporter", "Drivers", "Vehicles", "Halts", "Night %", "Risk"],
        rows: list.map(t => [
          { text: t.transporter_branch, emphasis: true },
          { text: fmt(t.unique_drivers), align: "right" },
          { text: fmt(t.unique_vehicles), align: "right" },
          { text: fmt(t.halt_count), align: "right" },
          { text: pct(t.night_share), align: "right" },
          { text: `${t.risk_score}`, align: "right", emphasis: true },
        ]),
      },
      followups: list.slice(0, 3).map(t => `Risk profile of ${t.transporter_branch}`),
      source: `zepto_long_stoppage · entity_rollup.transporters order by risk_score desc`,
    };
  }
  if (/driver/.test(q)) {
    const list = data.drivers.slice(0, N);
    return {
      intent: "top_n_drivers",
      headline: `Top ${N} drivers by composite risk`,
      table: {
        columns: ["Driver", "Vehicles", "Halts", "Night %", "Risk"],
        rows: list.map(d => [
          { text: `${d.driver_name} (${d.driver_number})`, emphasis: true },
          { text: fmt(d.unique_vehicles), align: "right" },
          { text: fmt(d.halt_count), align: "right" },
          { text: pct(d.night_share), align: "right" },
          { text: `${d.risk_score}`, align: "right", emphasis: true },
        ]),
      },
      followups: list.slice(0, 3).map(d => `Risk profile of ${d.driver_name}`),
      source: `zepto_long_stoppage · entity_rollup.drivers order by risk_score desc`,
    };
  }
  if (/route/.test(q) || /corridor/.test(q) || /lane/.test(q)) {
    const list = data.routes.slice(0, N);
    return {
      intent: "top_n_routes",
      headline: `Top ${N} routes by composite risk`,
      table: {
        columns: ["Route", "Drivers", "Vehicles", "Halts", "Risk"],
        rows: list.map(r => [
          { text: r.route_key, emphasis: true },
          { text: fmt(r.unique_drivers), align: "right" },
          { text: fmt(r.unique_vehicles), align: "right" },
          { text: fmt(r.halt_count), align: "right" },
          { text: `${r.risk_score}`, align: "right", emphasis: true },
        ]),
      },
      followups: ["Drill into route halts for top route", "Show me reefer trucks on this lane"],
      source: `zepto_long_stoppage · entity_rollup.routes order by risk_score desc`,
    };
  }
  return null;
}

// ---------- intent: night reefer ----------

function nightReefer(query: string, data: ChatData): BotResponse | null {
  const q = query.toLowerCase();
  if (!/night|22:00|22 00|overnight|midnight/.test(q)) return null;
  if (!/reefer|cold|fnv|chain/.test(q)) return null;
  const matching = data.events.filter(e => +e.is_reefer === 1 && +e.is_night === 1 && (+(e.distance_to_poi_km) || 0) > 0.3);
  const byDriverVehicle = new Map<string, { count: number; driver: string; driverNum: string; vehicle: string; transporter: string }>();
  for (const e of matching) {
    const k = `${e.driver_number}|${e.vehicle_number}`;
    const cur = byDriverVehicle.get(k);
    if (cur) cur.count += 1;
    else byDriverVehicle.set(k, { count: 1, driver: e.driver_name, driverNum: e.driver_number, vehicle: e.vehicle_number, transporter: e.transporter_branch });
  }
  const top = [...byDriverVehicle.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  return {
    intent: "night_reefer",
    headline: `${matching.length.toLocaleString()} reefer-night halts at unknown locations`,
    subhead: "Reefer-class vehicles stopping between 22:00 and 04:00 at locations > 300 m from any logistics POI.",
    metrics: [
      { label: "Reefer-night events", value: matching.length.toLocaleString(), tone: "warning" },
      { label: "Distinct driver-vehicles", value: byDriverVehicle.size.toLocaleString() },
      { label: "Median stop", value: hr(median(matching.map(e => +e.long_stoppage_duration_hrs))) },
    ],
    table: {
      columns: ["Driver", "Vehicle", "Transporter", "Night halts"],
      rows: top.map(t => [
        { text: `${t.driver} (${t.driverNum})`, emphasis: true },
        { text: t.vehicle },
        { text: t.transporter },
        { text: `${t.count}`, align: "right", emphasis: true },
      ]),
    },
    followups: top.slice(0, 3).map(t => `Risk profile of ${t.vehicle}`),
    source: "zepto_long_stoppage where is_reefer=1 AND is_night=1 AND distance_to_poi_km > 0.3",
  };
}

// ---------- intent: priority findings (verdicts overview) ----------

function priorityOverview(query: string, data: ChatData): BotResponse | null {
  const q = query.toLowerCase();
  if (!/priority|finding|verdict|smoking|high.risk pattern|biggest issue/.test(q)) return null;
  const top = data.verdicts.slice(0, 5);
  return {
    intent: "priority_overview",
    headline: `${data.verdicts.length} priority findings · top 5 below`,
    table: {
      columns: ["Pattern", "Entity", "Halts", "Risk"],
      rows: top.map(v => [
        { text: v.type_label },
        { text: v.headline, emphasis: true },
        { text: `${v.stats.count}`, align: "right" },
        { text: `${v.risk_score}`, align: "right", emphasis: true },
      ]),
    },
    followups: top.slice(0, 3).map(v => v.entities.vehicle_number ? `Risk profile of ${v.entities.vehicle_number}` : v.entities.transporter_branch ? `Risk profile of ${v.entities.transporter_branch}` : "Show top 5 high-risk drivers"),
    source: "zepto_long_stoppage · verdicts.json (top by risk_score)",
  };
}

// ---------- fallback ----------

function fallback(query: string): BotResponse {
  return {
    intent: "unknown",
    headline: "I couldn't find a match for that question.",
    subhead: `I look for vehicle numbers (e.g. MH04LE3023), driver names or phone numbers, transporter branches, trip IDs, or "top N <entity>" queries.`,
    followups: [
      "Top 5 high-risk reefer vehicles",
      "Top 10 high-risk drivers",
      "Risk profile of TRUSTECH-ZEPTO",
      "Show me reefer night halts at unknown locations",
    ],
    notFound: true,
  };
}

// ---------- main ----------

export function respond(query: string, data: ChatData): BotResponse {
  if (!query.trim()) return fallback(query);

  // priority-overview first if mentioned explicitly
  const overview = priorityOverview(query, data);
  if (overview) return overview;

  const trip = tripLookup(query, data);
  if (trip) return trip;

  const v = vehicleProfile(query, data);
  if (v) return v;

  const t = transporterProfile(query, data);
  if (t) return t;

  const d = driverProfile(query, data);
  if (d) return d;

  const top = topN(query, data);
  if (top) return top;

  const nr = nightReefer(query, data);
  if (nr) return nr;

  return fallback(query);
}

// Stock questions for the suggestion rail
export const STOCK_QUESTIONS: { category: string; items: string[] }[] = [
  {
    category: "Vehicle case",
    items: [
      "Risk profile of vehicle MH04LE3023",
      "Risk profile of vehicle HR55AM6423",
      "Top 5 high-risk reefer vehicles",
    ],
  },
  {
    category: "Driver case",
    items: [
      "Risk profile of driver PRATHMESH",
      "Risk profile of driver 8542073451",
      "Top 10 high-risk drivers",
    ],
  },
  {
    category: "Transporter case",
    items: [
      "Risk profile of TRUSTECH-ZEPTO",
      "Risk profile of ACCESS WAREHOSING",
      "Top 5 transporters by risk",
    ],
  },
  {
    category: "Route & trip case",
    items: [
      "Top 5 high-risk routes",
      "Show me trip 55254060",
      "Show me reefer night halts at unknown locations",
    ],
  },
  {
    category: "System view",
    items: [
      "Top 5 priority findings",
      "Top 10 drivers with most unknown halts",
    ],
  },
];
