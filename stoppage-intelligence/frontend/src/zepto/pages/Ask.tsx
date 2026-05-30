import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "ft-design-system";
import { api } from "../api";
import type {
  DriverRollup, VehicleRollup, TransporterRollup, RouteRollup, EventRow, HotspotFC,
} from "../types";
import { MiniMap } from "../components/MiniMap";
import { renderMarkdown } from "../lib/markdown";

type MatchKind = "driver" | "vehicle" | "transporter" | "trip" | "route";

interface Match {
  kind: MatchKind;
  key: string;
  title: string;
  sub: string;
  riskScore?: number;
  events: EventRow[];
  rollup?: DriverRollup | VehicleRollup | TransporterRollup | RouteRollup;
}

interface GenieResponse {
  text: string;
  sql?: string;
  query_description?: string;
  columns?: string[];
  rows?: (string | number | null)[][];
  error?: string;
  status?: string;
  conversation_id?: string;
  message_id?: string;
  elapsed_ms?: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  match?: Match;
  genie?: GenieResponse;
  source?: "match" | "genie" | "system";
}

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;

async function askGenie(question: string, conversationId?: string): Promise<GenieResponse> {
  const t0 = performance.now();
  try {
    const res = await fetch("/api/genie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, conversation_id: conversationId }),
    });
    const data = await res.json();
    return { ...data, elapsed_ms: Math.round(performance.now() - t0) };
  } catch (e: any) {
    return { text: "", error: e?.message || "Couldn't reach Genie", elapsed_ms: Math.round(performance.now() - t0) };
  }
}

export function Ask() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [activeMatch, setActiveMatch] = useState<Match | null>(null);

  const [drivers, setDrivers] = useState<DriverRollup[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRollup[]>([]);
  const [transporters, setTransporters] = useState<TransporterRollup[]>([]);
  const [routes, setRoutes] = useState<RouteRollup[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [hotspots, setHotspots] = useState<HotspotFC | null>(null);
  const [loading, setLoading] = useState(true);

  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.drivers(), api.vehicles(), api.transporters(), api.routes(), api.events(), api.hotspots()])
      .then(([d, v, t, r, e, h]) => {
        setDrivers(d); setVehicles(v); setTransporters(t); setRoutes(r); setEvents(e); setHotspots(h); setLoading(false);
      })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, thinking]);

  // Entity keys with at least one sampled event — same filter as Investigation,
  // so the Ask page never references entities with empty location data.
  const eventKeys = useMemo(() => {
    const d = new Set<string>(), v = new Set<string>(), t = new Set<string>(), r = new Set<string>();
    const trips = new Set<string>();
    for (const e of events) {
      if (e.driver_number) d.add(e.driver_number);
      if (e.vehicle_number) v.add(e.vehicle_number);
      if (e.transporter_branch) t.add(e.transporter_branch);
      if (e.route_key) r.add(e.route_key);
      if (e.trip_id) trips.add(e.trip_id);
    }
    return { d, v, t, r, trips };
  }, [events]);

  function tryMatch(q: string): Match | null {
    const raw = q.trim();
    const ql = raw.toLowerCase();
    if (!ql) return null;

    // Driver number exact
    if (eventKeys.d.has(raw)) {
      const drv = drivers.find(d => d.driver_number === raw);
      if (drv) {
        const evs = events.filter(e => e.driver_number === raw);
        return {
          kind: "driver", key: raw,
          title: `${drv.driver_name} · ${drv.driver_number}`,
          sub: `Top transporter: ${drv.top_transporter || "—"} · ${drv.unique_vehicles} vehicles seen`,
          riskScore: drv.risk_score, events: evs, rollup: drv,
        };
      }
    }
    // Trip ID
    if (eventKeys.trips.has(raw)) {
      const evs = events.filter(e => e.trip_id === raw);
      const drvSet = new Set(evs.map(e => e.driver_number).filter(Boolean));
      const vehSet = new Set(evs.map(e => e.vehicle_number).filter(Boolean));
      const txpSet = new Set(evs.map(e => e.transporter_branch).filter(Boolean));
      return {
        kind: "trip", key: raw,
        title: `Trip ${raw}`,
        sub: `${drvSet.size} driver(s) · ${vehSet.size} vehicle(s) · ${txpSet.size} transporter(s)`,
        events: evs,
      };
    }
    // Vehicle exact
    const vehExact = vehicles.find(v => v.vehicle_number.toLowerCase() === ql && eventKeys.v.has(v.vehicle_number));
    if (vehExact) {
      const evs = events.filter(e => e.vehicle_number === vehExact.vehicle_number);
      return {
        kind: "vehicle", key: vehExact.vehicle_number,
        title: vehExact.vehicle_number,
        sub: `${vehExact.vehicle_type} · ${vehExact.dedicated === "Yes" ? "Dedicated" : vehExact.dedicated === "No" ? "Non-dedicated" : "—"} · ${vehExact.top_transporter || "—"}`,
        riskScore: vehExact.risk_score, events: evs, rollup: vehExact,
      };
    }
    // Driver name (exact then contains)
    const drvByName =
      drivers.find(d => d.driver_name.toLowerCase() === ql && eventKeys.d.has(d.driver_number)) ||
      drivers.find(d => d.driver_name.toLowerCase().includes(ql) && eventKeys.d.has(d.driver_number));
    if (drvByName) {
      const evs = events.filter(e => e.driver_number === drvByName.driver_number);
      return {
        kind: "driver", key: drvByName.driver_number,
        title: `${drvByName.driver_name} · ${drvByName.driver_number}`,
        sub: `Top transporter: ${drvByName.top_transporter || "—"} · ${drvByName.unique_vehicles} vehicles seen`,
        riskScore: drvByName.risk_score, events: evs, rollup: drvByName,
      };
    }
    // Vehicle contains
    const vehFuzzy = vehicles.find(v => v.vehicle_number.toLowerCase().includes(ql) && eventKeys.v.has(v.vehicle_number));
    if (vehFuzzy) {
      const evs = events.filter(e => e.vehicle_number === vehFuzzy.vehicle_number);
      return {
        kind: "vehicle", key: vehFuzzy.vehicle_number,
        title: vehFuzzy.vehicle_number,
        sub: `${vehFuzzy.vehicle_type} · ${vehFuzzy.dedicated === "Yes" ? "Dedicated" : vehFuzzy.dedicated === "No" ? "Non-dedicated" : "—"} · ${vehFuzzy.top_transporter || "—"}`,
        riskScore: vehFuzzy.risk_score, events: evs, rollup: vehFuzzy,
      };
    }
    // Transporter
    const txp = transporters.find(t => t.transporter_branch.toLowerCase().includes(ql) && eventKeys.t.has(t.transporter_branch));
    if (txp) {
      const evs = events.filter(e => e.transporter_branch === txp.transporter_branch);
      return {
        kind: "transporter", key: txp.transporter_branch,
        title: txp.transporter_branch,
        sub: `${txp.unique_drivers} drivers · ${txp.unique_vehicles} vehicles`,
        riskScore: txp.risk_score, events: evs, rollup: txp,
      };
    }
    // Route
    const rt = routes.find(r => r.route_key.toLowerCase().includes(ql) && eventKeys.r.has(r.route_key));
    if (rt) {
      const evs = events.filter(e => e.route_key === rt.route_key);
      return {
        kind: "route", key: rt.route_key,
        title: rt.route_key,
        sub: `${rt.unique_drivers} drivers · ${rt.unique_vehicles} vehicles`,
        riskScore: rt.risk_score, events: evs, rollup: rt,
      };
    }
    return null;
  }

  function buildContext(m: Match): string {
    const evs = m.events.slice(0, 50);
    const lat = evs[0]?.alert_lat;
    const lng = evs[0]?.alert_lng;
    const obj = {
      kind: m.kind,
      identity: { title: m.title, sub: m.sub, risk_score: m.riskScore ?? null },
      rollup: m.rollup,
      stats: {
        total_halts: m.events.length,
        night_share: m.events.length ? m.events.filter(e => +e.is_night === 1).length / m.events.length : 0,
        reefer_share: m.events.length ? m.events.filter(e => +e.is_reefer === 1).length / m.events.length : 0,
        distinct_clusters: new Set(m.events.map(e => e.cluster_id)).size,
      },
      sample_events: evs.map(e => ({
        trip_id: e.trip_id, ts: e.alert_created_at,
        duration_hrs: +e.long_stoppage_duration_hrs,
        driver: e.driver_name, driver_number: e.driver_number,
        vehicle: e.vehicle_number, transporter: e.transporter_branch,
        nearest_poi: e.nearest_poi_name, poi_type: e.nearest_poi_type,
        distance_to_poi_km: +e.distance_to_poi_km,
        is_night: +e.is_night, is_reefer: +e.is_reefer,
        lat: e.alert_lat, lng: e.alert_lng,
        escalation: e.escalation_level,
      })),
      example_location: lat && lng ? { lat, lng } : null,
    };
    return JSON.stringify(obj, null, 2);
  }

  async function askAnthropic(question: string, contextStr: string, history: ChatMessage[]): Promise<string> {
    if (!ANTHROPIC_KEY) {
      return [
        "AI follow-up requires an Anthropic API key.",
        "",
        "Add `VITE_ANTHROPIC_API_KEY=sk-ant-…` to `stoppage-intelligence/frontend/.env`",
        "and restart the dev server. The chat will then query Claude (Sonnet 4.5) with",
        "the loaded entity context. In production this same path resolves through the",
        "FT control-room backend to the Databricks Genie workspace.",
      ].join("\n");
    }

    const system =
`You are the FT × Zepto Genie assistant — a logistics intelligence analyst that reads
in-transit halt data for FreightTiger's fleet network.

The CONTEXT below is one of two shapes:
1. A focused entity the user has loaded (driver / vehicle / transporter / route / trip)
   with a sample of its events, OR
2. A fleet snapshot: top-30 drivers/vehicles/transporters by risk, drivers with multiple
   vehicles (substitution candidates), top-25 shadow hotspots, top-20 routes, and a
   recent-events sample. Use these to answer broad analytical questions across the fleet.

Answer strictly from the CONTEXT. Be concrete — name specific drivers, vehicles, locations
when they're in the data. If the CONTEXT genuinely doesn't have what's needed, say so
and suggest which slice would unlock the answer.

Tone: tight, factual, no fluff. Use Indian number formatting. Round percentages to
whole numbers. Use 24h timestamps. Bullet lists only when listing 3+ items.
Use **bold** to highlight specific entity names, numbers, or risk callouts.

CONTEXT:
${contextStr}`;

    const turns = history
      .filter(m => m.text)
      .map(m => ({ role: m.role, content: m.text as string }));
    turns.push({ role: "user", content: question });

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1024,
          system,
          messages: turns,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        return `Anthropic API error (${res.status}): ${errText.slice(0, 200)}`;
      }
      const data = await res.json();
      return data.content?.[0]?.text || "No response.";
    } catch (e: any) {
      return `Couldn't reach the Anthropic API: ${e.message}`;
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    setInput("");

    const userMsg: ChatMessage = { id: String(Date.now()), role: "user", text: trimmed };
    setMessages(prev => [...prev, userMsg]);

    // 1. If the question matches a local entity exactly, drop a quick context card
    //    so the user can drill in immediately. Genie still answers the actual question.
    const m = tryMatch(trimmed);
    if (m) {
      setActiveMatch(m);
      setMessages(prev => [...prev, {
        id: String(Date.now() + 1),
        role: "assistant",
        match: m,
        source: "match",
      }]);
    }

    // 2. Always send the question to Genie — that's the primary answerer.
    setThinking(true);
    try {
      const genie = await askGenie(trimmed);
      setMessages(prev => [...prev, {
        id: String(Date.now() + 2),
        role: "assistant",
        genie,
        source: "genie",
      }]);
    } finally {
      setThinking(false);
    }
  }

  // Legacy Anthropic + fleet-context path — kept around as a fallback we can
  // re-enable later if Genie is unreachable. Not invoked in current flow.
  // @ts-ignore
  async function _legacySendWithAnthropic(trimmed: string, userMsg: ChatMessage) {
    setThinking(true);
    try {
      let context = "";
      if (activeMatch) {
        context = buildContext(activeMatch);
      } else {
        // No specific entity loaded — feed Claude a comprehensive fleet snapshot
        // so it can answer analytical questions across drivers, vehicles, transporters, etc.
        const driversWithMultiVehicles = drivers
          .filter(d => d.unique_vehicles >= 2)
          .sort((a, b) => b.unique_vehicles - a.unique_vehicles)
          .slice(0, 20)
          .map(d => ({ name: d.driver_name, number: d.driver_number, vehicles: d.unique_vehicles, halts: d.halt_count, risk: d.risk_score, top_transporter: d.top_transporter }));

        const topHotspots = (hotspots?.features || [])
          .filter(f => !f.properties.poi_explained)
          .sort((a, b) => b.properties.halt_count - a.properties.halt_count)
          .slice(0, 25)
          .map(f => ({
            location: f.properties.location_label,
            halts: f.properties.halt_count,
            night_share: f.properties.night_share,
            reefer_share: f.properties.reefer_share,
            median_duration_hrs: f.properties.median_duration_hrs,
            distance_to_poi_km: f.properties.median_poi_distance_km,
            risk_tier: f.properties.risk_tier,
            top_transporter: f.properties.top_transporter,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          }));

        context = JSON.stringify({
          fleet_summary: {
            total_drivers: drivers.length,
            total_vehicles: vehicles.length,
            total_transporters: transporters.length,
            total_routes: routes.length,
            sampled_events: events.length,
            shadow_clusters: (hotspots?.features || []).filter(f => !f.properties.poi_explained).length,
            poi_explained_clusters: (hotspots?.features || []).filter(f => f.properties.poi_explained).length,
          },
          top_30_drivers_by_risk: [...drivers].sort((a, b) => b.risk_score - a.risk_score).slice(0, 30).map(d => ({
            name: d.driver_name, number: d.driver_number, halt_count: d.halt_count,
            unique_vehicles: d.unique_vehicles, unique_transporters: d.unique_transporters,
            night_share: d.night_share, reefer_share: d.reefer_share,
            median_duration_hrs: d.median_duration_hrs, risk_score: d.risk_score,
            top_transporter: d.top_transporter,
          })),
          drivers_with_multiple_vehicles: driversWithMultiVehicles,
          top_30_vehicles_by_risk: [...vehicles].sort((a, b) => b.risk_score - a.risk_score).slice(0, 30).map(v => ({
            vehicle: v.vehicle_number, type: v.vehicle_type, halt_count: v.halt_count,
            unique_drivers: v.unique_drivers, night_share: v.night_share,
            reefer_share: v.reefer_share, median_duration_hrs: v.median_duration_hrs,
            is_reefer: v.is_reefer, dedicated: v.dedicated, top_transporter: v.top_transporter,
            risk_score: v.risk_score,
          })),
          top_30_transporters_by_risk: [...transporters].sort((a, b) => b.risk_score - a.risk_score).slice(0, 30).map(t => ({
            name: t.transporter_branch, halt_count: t.halt_count,
            unique_drivers: t.unique_drivers, unique_vehicles: t.unique_vehicles,
            night_share: t.night_share, reefer_share: t.reefer_share,
            median_duration_hrs: t.median_duration_hrs, risk_score: t.risk_score,
          })),
          top_25_shadow_hotspots: topHotspots,
          top_20_routes: [...routes].sort((a, b) => b.halt_count - a.halt_count).slice(0, 20).map(r => ({
            route: r.route_key, halts: r.halt_count, drivers: r.unique_drivers,
            vehicles: r.unique_vehicles, night_share: r.night_share, reefer_share: r.reefer_share,
            median_duration_hrs: r.median_duration_hrs, risk_score: r.risk_score,
          })),
          recent_event_sample: events.slice(0, 40).map(e => ({
            ts: e.alert_created_at, trip: e.trip_id, driver: e.driver_name, vehicle: e.vehicle_number,
            transporter: e.transporter_branch, route: e.route_key, duration_hrs: +e.long_stoppage_duration_hrs,
            poi: e.nearest_poi_name, poi_type: e.nearest_poi_type, distance_to_poi_km: +e.distance_to_poi_km,
            is_night: +e.is_night, is_reefer: +e.is_reefer,
          })),
        }, null, 2);
      }
      const reply = await askAnthropic(trimmed, context, [...messages, userMsg]);
      setMessages(prev => [...prev, {
        id: String(Date.now() + 2),
        role: "assistant",
        text: reply,
        source: "system",
      }]);
    } finally {
      setThinking(false);
    }
  }

  function reset() {
    setMessages([]);
    setActiveMatch(null);
    setInput("");
  }

  // Seed prompts when empty — mix of entity lookups and analytical questions
  const samplePrompts = useMemo(() => {
    if (drivers.length === 0) return [];
    const topDrv = [...drivers].filter(d => eventKeys.d.has(d.driver_number)).sort((a, b) => b.halt_count - a.halt_count)[0];
    const topVeh = [...vehicles].filter(v => eventKeys.v.has(v.vehicle_number)).sort((a, b) => b.halt_count - a.halt_count)[0];
    const topTxp = [...transporters].filter(t => eventKeys.t.has(t.transporter_branch)).sort((a, b) => b.halt_count - a.halt_count)[0];
    // Pick a trip ID from the events
    const sampleTrip = events.find(e => e.trip_id)?.trip_id;
    return [
      topDrv && { label: "Driver number", text: topDrv.driver_number },
      topDrv && { label: "Driver name", text: topDrv.driver_name },
      topVeh && { label: "Vehicle", text: topVeh.vehicle_number },
      sampleTrip && { label: "Trip ID", text: sampleTrip },
      topTxp && { label: "Transporter", text: topTxp.transporter_branch },
      { label: "Pattern", text: "Which drivers operate the most vehicles? That signals substitution risk." },
      { label: "Pattern", text: "Show shadow halts that repeat 5+ times at the same spot." },
      { label: "Pattern", text: "Which transporters have the highest night-halt share?" },
      { label: "Pattern", text: "Where do reefer trucks halt outside cold-storage POIs?" },
      { label: "Pattern", text: "Compare halt durations at toll plazas vs unmapped roadside." },
      { label: "Pattern", text: "Top 5 routes by cold-chain exposure this month." },
      { label: "Pattern", text: "What hours cluster the most halts? Night vs day split." },
    ].filter(Boolean) as { label: string; text: string }[];
  }, [drivers, vehicles, transporters, events, eventKeys]);

  if (loading) {
    return (
      <div className="z-chat-shell">
        <div className="z-chat-head">
          <div className="z-chat-head-title">
            <div className="z-caps">Ask · FT × Zepto Genie</div>
            <div style={{ height: 32, width: 360, background: "#f0f1f7", borderRadius: 4, marginTop: 8 }} />
          </div>
        </div>
        <div className="z-chat-empty">Loading fleet data…</div>
      </div>
    );
  }

  // Render the centered Claude-style landing when no conversation has started
  if (messages.length === 0) {
    return (
      <div className="z-chat-shell">
        <div className="z-chat-landing">
          <h2 className="z-chat-landing-heading">What do you wish to investigate?</h2>
          <div className="z-chat-landing-input">
            <div style={{ position: "relative", flex: 1 }}>
              <svg className="z-ask-input-icon" viewBox="0 0 18 18" fill="none">
                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 12L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                className="z-chat-input"
                placeholder="Search by trip ID, driver number, driver name, vehicle…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                autoFocus
                style={{ width: "100%" }}
              />
            </div>
            <button
              className="z-chat-send"
              onClick={() => send(input)}
              disabled={!input.trim()}
            >
              Send
            </button>
          </div>
          <div className="z-chat-landing-prompts">
            {samplePrompts.map(s => (
              <button key={s.text} className="z-chat-landing-prompt" onClick={() => send(s.text)} title={s.text}>
                {s.text}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Conversation mode — thread + sticky input
  return (
    <div className="z-chat-shell">
      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 32 }}>
        <button className="z-chat-reset" onClick={reset}>New conversation</button>
      </div>

      <div className="z-chat-thread" ref={threadRef}>
        {messages.map(msg => (
          msg.role === "user" ? (
            <div key={msg.id} className="z-chat-msg-user">{msg.text}</div>
          ) : (
            <div key={msg.id} className="z-chat-msg-assistant">
              <div className="z-chat-source">
                <span className="z-chat-source-dot" />
                {msg.source === "match"
                  ? `Entity loaded · ${msg.match!.kind}`
                  : msg.source === "genie"
                    ? `FT Intelligence${msg.genie?.elapsed_ms ? ` · ${(msg.genie.elapsed_ms / 1000).toFixed(1)}s` : ""}`
                    : "FT Intelligence"}
              </div>
              {msg.match
                ? <MatchCard match={msg.match} />
                : msg.genie
                  ? <GenieCard genie={msg.genie} />
                  : <div className="z-chat-msg-text">{renderMarkdown(msg.text || "")}</div>
              }
            </div>
          )
        ))}

        {thinking && (
          <div className="z-chat-msg-assistant">
            <div className="z-chat-source">
              <span className="z-chat-source-dot" />
              Thinking
            </div>
            <div className="z-chat-thinking">
              Thinking
              <span className="z-chat-dots"><span /><span /><span /></span>
            </div>
          </div>
        )}
      </div>

      {/* Sticky input bar (conversation mode only) */}
      <div className="z-chat-input-bar">
        <div className="z-chat-input-wrap">
          <svg className="z-ask-input-icon" viewBox="0 0 18 18" fill="none" style={{ left: 20, top: 20, transform: "none" }}>
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 12L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            className="z-chat-input"
            placeholder={activeMatch
              ? `Ask about ${activeMatch.title} — e.g. how many night halts? top 5 locations? compare to fleet average?`
              : "Search by trip ID, driver number, driver name, vehicle…"
            }
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            disabled={thinking}
            autoFocus
          />
          <button
            className="z-chat-send"
            onClick={() => send(input)}
            disabled={!input.trim() || thinking}
          >
            Send
          </button>
        </div>
        {activeMatch && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#838c9d", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="z-chat-source-dot" />
            Context loaded: <strong style={{ color: "#434f64", fontWeight: 500 }}>{activeMatch.title}</strong>
            <span style={{ color: "#ced1d7" }}>·</span>
            <span>{activeMatch.events.length} sampled events</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: Match }) {
  const events = match.events;
  const sampleHalts = events.length;
  const sampleNight = sampleHalts > 0 ? events.filter(e => +e.is_night === 1).length / sampleHalts : 0;
  const sampleReefer = sampleHalts > 0 ? events.filter(e => +e.is_reefer === 1).length / sampleHalts : 0;
  const sortedDur = [...events.map(e => +e.long_stoppage_duration_hrs)].sort((a, b) => a - b);
  const sampleMedian = sortedDur.length ? sortedDur[Math.floor(sortedDur.length / 2)] : 0;
  const clusters = new Set(events.map(e => e.cluster_id));
  const unknownEvents = events.filter(e => {
    const d = +e.distance_to_poi_km;
    return d > 0.3 && !["fuel", "toll_booth", "restaurant", "fast_food", "cafe", "hotel", "motel", "rest_area"].includes((e.nearest_poi_type || "").toLowerCase());
  });
  const unknownShare = sampleHalts > 0 ? unknownEvents.length / sampleHalts : 0;

  const isTrip = match.kind === "trip";
  const rollup = match.rollup as any;
  const totalHalts = isTrip ? sampleHalts : (rollup?.halt_count ?? sampleHalts);
  const nightShare = isTrip ? sampleNight : (rollup?.night_share ?? sampleNight);
  const reeferShare = isTrip ? sampleReefer : (rollup?.reefer_share ?? sampleReefer);
  const medianDur = isTrip ? sampleMedian : (rollup?.median_duration_hrs ?? sampleMedian);
  const distinctClusters = isTrip ? clusters.size : (rollup?.unique_clusters ?? clusters.size);

  const clusterMap = new Map<string, { count: number; lat: number; lng: number; poi: string; dist: number }>();
  for (const e of events) {
    const cur = clusterMap.get(e.cluster_id);
    if (cur) cur.count += 1;
    else clusterMap.set(e.cluster_id, {
      count: 1, lat: e.alert_lat, lng: e.alert_lng,
      poi: e.nearest_poi_name || "Unmapped",
      dist: +e.distance_to_poi_km || 0,
    });
  }
  const topClusters = [...clusterMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  const centerLat = topClusters.length ? topClusters[0][1].lat : (events[0]?.alert_lat ?? 22);
  const centerLng = topClusters.length ? topClusters[0][1].lng : (events[0]?.alert_lng ?? 78);
  const evidencePoints = topClusters.map(([, c]) => ({ lat: c.lat, lng: c.lng, size: 6 + Math.min(10, c.count) }));

  return (
    <div className="z-ask-response">
      <div className="z-ask-response-head">
        <div style={{ minWidth: 0 }}>
          <div className="z-ask-match-kind">{match.kind}</div>
          <div className="z-ask-match-title">{match.title}</div>
          <div className="z-ask-match-sub">{match.sub}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#1a2330", lineHeight: 1, letterSpacing: "-0.01em" }}>
            {isTrip ? sampleHalts : (match.riskScore ?? "—")}
          </div>
          <div className="z-caps" style={{ marginTop: 6 }}>
            {isTrip ? "Halts on trip" : "Risk · 100"}
          </div>
        </div>
      </div>

      <div className="z-tile-row">
        <Tile label="In-transit halts" value={totalHalts.toLocaleString()} />
        <Tile label="Distinct locations" value={distinctClusters.toLocaleString()} />
        <Tile label="Median duration" value={`${medianDur.toFixed(1)} hr`} />
        <Tile label="Night share" value={`${Math.round(nightShare * 100)}%`} />
        <Tile label="Unknown POI" value={sampleHalts > 0 ? `${Math.round(unknownShare * 100)}%` : "—"} highlight={sampleHalts > 0 && unknownShare >= 0.4} />
      </div>

      {totalHalts > 0 && (
        <div className="z-pattern">
          <strong>Pattern read.</strong>{" "}
          {nightShare >= 0.5 ? "Stops are night-dominant. " : "Stops span both day and night. "}
          {reeferShare >= 0.5 ? "Predominantly reefer vehicles, raising cold-chain exposure. " : ""}
          {sampleHalts > 0 && unknownShare >= 0.4 ? `${Math.round(unknownShare * 100)}% of sampled stops have no logistics POI within range. ` : ""}
          {distinctClusters === 1 ? "All halts occur at a single location." : distinctClusters <= 5 ? `Concentrated on ${distinctClusters} locations.` : `Spread across ${distinctClusters} locations.`}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 24 }}>
        <div>
          <div className="z-caps" style={{ color: "#5f697b", marginBottom: 12 }}>Top recurring locations</div>
          {topClusters.length === 0 && <div style={{ color: "#838c9d", fontSize: 13 }}>No location data.</div>}
          {topClusters.map(([cid, c]) => (
            <div key={cid} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid #f0f1f7", fontSize: 13 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: "#1a2330", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.poi === "Unnamed" ? "Unmapped roadside" : c.poi}
                </div>
                <div style={{ fontSize: 12, color: "#838c9d", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                  {c.lat.toFixed(4)}, {c.lng.toFixed(4)} · {c.dist.toFixed(2)} km to POI
                  {" · "}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ color: "#1e64e6", fontWeight: 500, textDecoration: "none" }}
                  >
                    Maps ↗
                  </a>
                </div>
              </div>
              <Badge variant="neutral">{c.count}× stops</Badge>
            </div>
          ))}
        </div>

        <div>
          <MiniMap lat={centerLat} lng={centerLng} zoom={6} height={260} extraPoints={evidencePoints} markerColor="#FFBE07" />
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={"z-tile" + (highlight ? " is-warn" : "")}>
      <div className="z-tile-label">{label}</div>
      <div className="z-tile-value">{value}</div>
    </div>
  );
}

function GenieCard({ genie }: { genie: GenieResponse }) {
  const [showSql, setShowSql] = useState(false);
  if (genie.error) {
    return (
      <div className="z-genie-error">
        <strong>Genie couldn't answer this:</strong> {genie.error}
        <div style={{ marginTop: 6, fontSize: 12, color: "#838c9d" }}>
          Try rephrasing, or break it into a smaller question (e.g. "halts {">"} 4 hr last 7 days for transporter X").
        </div>
      </div>
    );
  }
  const rows = genie.rows || [];
  const columns = genie.columns || [];
  const hasTable = rows.length > 0 && columns.length > 0;
  return (
    <div className="z-genie-card">
      {genie.text && (
        <div className="z-genie-text">{renderMarkdown(genie.text)}</div>
      )}
      {hasTable && (
        <div className="z-genie-table-wrap">
          {genie.query_description && (
            <div className="z-genie-table-caption">{genie.query_description}</div>
          )}
          <div className="z-genie-table-scroll">
            <table className="z-genie-table">
              <thead>
                <tr>
                  {columns.map(c => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} className={typeof cell === "number" || (typeof cell === "string" && /^-?\d/.test(cell)) ? "num" : ""}>
                        {cell == null ? "—" : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="z-genie-table-foot">
            {rows.length > 200 ? `Showing first 200 of ${rows.length.toLocaleString("en-IN")} rows` : `${rows.length.toLocaleString("en-IN")} row${rows.length === 1 ? "" : "s"}`}
          </div>
        </div>
      )}
      {genie.sql && (
        <div className="z-genie-sql">
          <button className="z-genie-sql-toggle" onClick={() => setShowSql(v => !v)}>
            {showSql ? "Hide SQL ▴" : "Show SQL ▾"}
          </button>
          {showSql && (
            <pre className="z-genie-sql-code">{genie.sql}</pre>
          )}
        </div>
      )}
    </div>
  );
}
