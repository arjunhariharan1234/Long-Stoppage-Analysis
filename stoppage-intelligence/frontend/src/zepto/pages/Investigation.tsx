import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  DriverRollup, VehicleRollup, TransporterRollup, RouteRollup, EventRow,
} from "../types";
import { MiniMap } from "../components/MiniMap";

type Lens = "driver" | "vehicle" | "transporter" | "route";

interface PreselectInfo {
  driver?: string;        // driver_number
  vehicle?: string;       // vehicle_number
  transporter?: string;   // transporter_branch
  route?: string;
}

interface Props { preselect?: PreselectInfo | null; }

export function Investigation({ preselect }: Props) {
  const [lens, setLens] = useState<Lens>("driver");
  const [drivers, setDrivers] = useState<DriverRollup[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRollup[]>([]);
  const [transporters, setTransporters] = useState<TransporterRollup[]>([]);
  const [routes, setRoutes] = useState<RouteRollup[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.drivers(), api.vehicles(), api.transporters(), api.routes(), api.events()])
      .then(([d, v, t, r, e]) => {
        setDrivers(d); setVehicles(v); setTransporters(t); setRoutes(r); setEvents(e); setLoading(false);
      })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  // Apply preselect when data arrives
  useEffect(() => {
    if (loading || !preselect) return;
    if (preselect.driver) { setLens("driver"); setSelectedKey(preselect.driver); }
    else if (preselect.vehicle) { setLens("vehicle"); setSelectedKey(preselect.vehicle); }
    else if (preselect.transporter) { setLens("transporter"); setSelectedKey(preselect.transporter); }
    else if (preselect.route) { setLens("route"); setSelectedKey(preselect.route); }
  }, [loading, preselect]);

  // Build the list for the current lens
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (lens === "driver") {
      return drivers.filter(d =>
        !q || d.driver_name.toLowerCase().includes(q) || d.driver_number.includes(q) || d.top_transporter.toLowerCase().includes(q)
      ).slice(0, 250);
    }
    if (lens === "vehicle") {
      return vehicles.filter(v =>
        !q || v.vehicle_number.toLowerCase().includes(q) || (v.top_transporter || "").toLowerCase().includes(q)
      ).slice(0, 250);
    }
    if (lens === "transporter") {
      return transporters.filter(t =>
        !q || t.transporter_branch.toLowerCase().includes(q)
      ).slice(0, 200);
    }
    return routes.filter(r => !q || r.route_key.toLowerCase().includes(q)).slice(0, 200);
  }, [lens, query, drivers, vehicles, transporters, routes]);

  // Auto-select first if nothing selected
  useEffect(() => {
    if (!selectedKey && list.length > 0) {
      const first = list[0] as any;
      const key = lens === "driver" ? first.driver_number
                : lens === "vehicle" ? first.vehicle_number
                : lens === "transporter" ? first.transporter_branch
                : first.route_key;
      setSelectedKey(key);
    }
  }, [list, selectedKey, lens]);

  // Filter events for the selection
  const selectedEvents = useMemo(() => {
    if (!selectedKey) return [];
    if (lens === "driver") return events.filter(e => e.driver_number === selectedKey);
    if (lens === "vehicle") return events.filter(e => e.vehicle_number === selectedKey);
    if (lens === "transporter") return events.filter(e => e.transporter_branch === selectedKey);
    return events.filter(e => e.route_key === selectedKey);
  }, [events, lens, selectedKey]);

  const selectedMeta = useMemo(() => {
    if (!selectedKey) return null;
    if (lens === "driver") return drivers.find(d => d.driver_number === selectedKey);
    if (lens === "vehicle") return vehicles.find(v => v.vehicle_number === selectedKey);
    if (lens === "transporter") return transporters.find(t => t.transporter_branch === selectedKey);
    return routes.find(r => r.route_key === selectedKey);
  }, [lens, selectedKey, drivers, vehicles, transporters, routes]);

  if (loading) {
    return (
      <div className="zepto-loading">
        <div className="zepto-loading-spinner" />
        <div className="zepto-loading-text">Loading fleet entities…</div>
      </div>
    );
  }

  return (
    <div className="zepto-page">
      <div className="zepto-eyebrow">Investigation workbench</div>
      <h1 className="zepto-headline">Drill into any <em>driver, vehicle, transporter or route</em></h1>
      <p className="zepto-sub">
        Same dataset, four lenses. Choose a lens, search or scroll, select an entity — the right panel surfaces their halt pattern, recurring locations, top combinations and the underlying events.
      </p>

      <div className="zepto-lens-tabs" style={{ marginTop: 18 }}>
        {(["driver", "vehicle", "transporter", "route"] as Lens[]).map(l => (
          <button key={l} className={`zepto-lens-tab ${lens === l ? "active" : ""}`} onClick={() => { setLens(l); setSelectedKey(null); setQuery(""); }}>
            {l === "driver" ? "Drivers" : l === "vehicle" ? "Vehicles" : l === "transporter" ? "Transporters" : "Routes"}
          </button>
        ))}
      </div>

      <div className="zepto-workbench">
        <div className="zepto-workbench-list">
          <input
            className="zepto-search"
            placeholder={lens === "driver" ? "Search by name or number…" : lens === "vehicle" ? "Search by vehicle number…" : lens === "transporter" ? "Search transporter…" : "Search route…"}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {list.map((item: any) => {
            const key = lens === "driver" ? item.driver_number
                      : lens === "vehicle" ? item.vehicle_number
                      : lens === "transporter" ? item.transporter_branch
                      : item.route_key;
            const primary = lens === "driver" ? `${item.driver_name} (${item.driver_number})`
                          : lens === "vehicle" ? item.vehicle_number
                          : lens === "transporter" ? item.transporter_branch
                          : item.route_key;
            const meta = lens === "driver" ? `${item.halt_count} halts · ${item.unique_vehicles} vehicles`
                       : lens === "vehicle" ? `${item.halt_count} halts · ${item.vehicle_type}`
                       : lens === "transporter" ? `${item.halt_count} halts · ${item.unique_drivers} drivers`
                       : `${item.halt_count} halts · ${item.unique_drivers} drivers`;
            return (
              <div
                key={key}
                className={`zepto-workbench-item ${key === selectedKey ? "selected" : ""}`}
                onClick={() => setSelectedKey(key)}
              >
                <div>
                  <div className="name">{primary}</div>
                  <div className="meta">{meta}</div>
                </div>
                <div className="score-pill">{item.risk_score}</div>
              </div>
            );
          })}
          {list.length === 0 && (
            <div style={{ padding: 20, color: "var(--zepto-text-dim)", fontSize: 13, textAlign: "center" }}>No matches</div>
          )}
        </div>

        <div className="zepto-workbench-detail">
          {!selectedMeta ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--zepto-text-dim)" }}>Select an entity to investigate</div>
          ) : (
            <InvestigationDetail
              lens={lens}
              meta={selectedMeta as any}
              events={selectedEvents}
              key={selectedKey || ""}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function InvestigationDetail({ lens, meta, events }: { lens: Lens; meta: any; events: EventRow[] }) {
  const title = lens === "driver" ? `${meta.driver_name} · ${meta.driver_number}`
              : lens === "vehicle" ? meta.vehicle_number
              : lens === "transporter" ? meta.transporter_branch
              : meta.route_key;

  // Pattern summary
  const totalHalts = events.length;
  const nightShare = totalHalts > 0 ? events.filter(e => +e.is_night === 1).length / totalHalts : 0;
  const reeferShare = totalHalts > 0 ? events.filter(e => +e.is_reefer === 1).length / totalHalts : 0;
  const medianDur = totalHalts > 0 ? sortNumeric(events.map(e => +e.long_stoppage_duration_hrs))[Math.floor(totalHalts / 2)] : 0;
  const clusters = new Set(events.map(e => e.cluster_id));
  const unknownEvents = events.filter(e => {
    const d = +e.distance_to_poi_km;
    return d > 0.3 && !["fuel", "toll_booth", "restaurant", "fast_food", "cafe", "hotel", "motel", "rest_area"].includes((e.nearest_poi_type || "").toLowerCase());
  });
  const unknownShare = totalHalts > 0 ? unknownEvents.length / totalHalts : 0;

  // Top combinations
  const comboMap = new Map<string, { count: number; driver: string; vehicle: string; transporter: string; cluster: string; lat?: number; lng?: number }>();
  for (const e of events) {
    const key = `${e.driver_number}|${e.vehicle_number}|${e.cluster_id}`;
    const prev = comboMap.get(key);
    if (prev) prev.count += 1;
    else comboMap.set(key, {
      count: 1, driver: `${e.driver_name} (${e.driver_number})`,
      vehicle: e.vehicle_number, transporter: e.transporter_branch, cluster: e.cluster_id,
      lat: e.alert_lat, lng: e.alert_lng,
    });
  }
  const topCombos = [...comboMap.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  // Top clusters
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
  const topClusters = [...clusterMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 6);

  // Map center
  const centerLat = topClusters.length ? topClusters[0][1].lat : (events[0]?.alert_lat ?? 22);
  const centerLng = topClusters.length ? topClusters[0][1].lng : (events[0]?.alert_lng ?? 78);
  const evidencePoints = topClusters.map(([, c]) => ({ lat: c.lat, lng: c.lng, size: 6 + Math.min(10, c.count) }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="zepto-eyebrow">{lens.toUpperCase()}</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{title}</h2>
          <div style={{ fontSize: 13, color: "var(--zepto-text-dim)", marginTop: 6 }}>
            {lens === "driver" && `Top transporter: ${meta.top_transporter || "—"} · ${meta.unique_vehicles} vehicles seen`}
            {lens === "vehicle" && `${meta.vehicle_type} · ${meta.dedicated === "Yes" ? "Dedicated" : meta.dedicated === "No" ? "Non-dedicated" : "—"} · ${meta.top_transporter || "—"}`}
            {lens === "transporter" && `${meta.unique_drivers} drivers · ${meta.unique_vehicles} vehicles`}
            {lens === "route" && `${meta.unique_drivers} drivers · ${meta.unique_vehicles} vehicles`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="zepto-verdict-score">{meta.risk_score}</div>
          <div className="zepto-verdict-score-label">Risk score</div>
        </div>
      </div>

      {/* Pattern summary KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginTop: 18 }}>
        <Stat label="In-transit halts" value={totalHalts.toLocaleString()} />
        <Stat label="Distinct locations" value={clusters.size.toLocaleString()} />
        <Stat label="Median duration" value={`${medianDur.toFixed(1)} hr`} />
        <Stat label="Night share" value={`${Math.round(nightShare * 100)}%`} />
        <Stat label="Unknown POI share" value={`${Math.round(unknownShare * 100)}%`} highlight={unknownShare >= 0.4} />
      </div>

      {/* Pattern note */}
      {totalHalts > 0 && (
        <div className="zepto-pattern-read">
          <strong>Pattern read.</strong>{" "}
          {nightShare >= 0.5 ? "Stops are night-dominant. " : "Stops span both day and night. "}
          {reeferShare >= 0.5 ? "Predominantly reefer vehicles, raising cold-chain exposure. " : ""}
          {unknownShare >= 0.4 ? `${Math.round(unknownShare * 100)}% of stops have no logistics POI within range — risk profile is elevated. ` : ""}
          {clusters.size === 1 ? "All halts occur at a single location." : clusters.size <= 5 ? `Concentrated on ${clusters.size} locations.` : `Spread across ${clusters.size} locations.`}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 22, marginTop: 20 }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>Top recurring locations</h3>
          {topClusters.map(([cid, c]) => (
            <div key={cid} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 500, color: "var(--text-primary)" }}>{c.poi === "Unnamed" ? "Unmapped roadside" : c.poi}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                  {c.lat.toFixed(4)}, {c.lng.toFixed(4)} · {c.dist.toFixed(2)} km to nearest POI
                  {" · "}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--zepto-accent, #1e64e6)", textDecoration: "none", fontWeight: 600 }}
                  >
                    Google Maps ↗
                  </a>
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 10, background: "var(--slate-100)", color: "var(--text-secondary)", alignSelf: "center", fontVariantNumeric: "tabular-nums" }}>{c.count}× stops</div>
            </div>
          ))}
          {topClusters.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No location data.</div>}

          {topCombos.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginTop: 22, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>Top driver / vehicle / location combinations</h3>
              {topCombos.map(c => (
                <div key={`${c.driver}|${c.vehicle}|${c.cluster}`} style={{ padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                  <div style={{ fontWeight: 500, color: "var(--text-primary)" }}>{c.driver} · {c.vehicle}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 2 }}>{c.transporter} · <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{c.count} events</strong></div>
                </div>
              ))}
            </>
          )}
        </div>

        <div>
          <MiniMap lat={centerLat} lng={centerLng} zoom={6} height={300} extraPoints={evidencePoints} markerColor="#1e64e6" />
          <div style={{ marginTop: 8, fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${centerLat.toFixed(6)},${centerLng.toFixed(6)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--zepto-accent, #1e64e6)", textDecoration: "none", fontWeight: 600 }}
            >
              View on Google Maps ↗
            </a>
            <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {centerLat.toFixed(4)}, {centerLng.toFixed(4)}
            </span>
          </div>
        </div>
      </div>

      {/* Events table */}
      <h3 style={{ fontSize: 13, fontWeight: 600, marginTop: 24, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
        Events <span style={{ fontWeight: 500, color: "var(--text-muted)" }}>({events.length.toLocaleString()})</span>
      </h3>
      <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
        <table className="zepto-data-table">
          <thead>
            <tr>
              <th>Trip</th>
              <th>Date / time</th>
              <th className="num">Duration</th>
              {lens !== "driver" && <th>Driver</th>}
              {lens !== "vehicle" && <th>Vehicle</th>}
              <th>Nearest POI</th>
              <th className="num">POI km</th>
              <th className="num">Weight</th>
              <th className="num">Esc</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 400).map((e, i) => (
              <tr key={`${e.trip_id}-${i}`}>
                <td>{e.trip_id}</td>
                <td>{e.alert_created_at}</td>
                <td className="num">{(+e.long_stoppage_duration_hrs).toFixed(1)} hr</td>
                {lens !== "driver" && <td>{e.driver_name}</td>}
                {lens !== "vehicle" && <td>{e.vehicle_number}</td>}
                <td>{e.nearest_poi_name || "—"}</td>
                <td className="num">{e.distance_to_poi_km != null && e.distance_to_poi_km !== "" ? (+e.distance_to_poi_km).toFixed(2) : "—"}</td>
                <td className="num">{e.net_weight ? Math.round(+e.net_weight) : "—"}</td>
                <td className="num">{e.escalation_level || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length > 400 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>Showing first 400 of {events.length} events. Export to view all.</div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`zepto-stat-tile${highlight ? " highlight" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function sortNumeric(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}
