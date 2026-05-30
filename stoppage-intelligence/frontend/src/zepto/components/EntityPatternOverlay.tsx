import { useMemo } from "react";
import type {
  DriverRollup, VehicleRollup, TransporterRollup, RouteRollup,
  HotspotFC, EventRow,
} from "../types";

export type EntityKind = "driver" | "vehicle" | "transporter" | "route";

export interface EntityFocus {
  kind: EntityKind;
  key: string;
}

interface Props {
  focus: EntityFocus;
  drivers: DriverRollup[];
  vehicles: VehicleRollup[];
  transporters: TransporterRollup[];
  routes: RouteRollup[];
  hotspots: HotspotFC | null;
  events: EventRow[];
  onClose: () => void;
  onEntityClick: (focus: EntityFocus) => void;
  aliasLocation: (s: string) => string;
}

function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }
function fmtNum(n: number) { return n.toLocaleString("en-IN"); }
function fmtHrs(n: number) { return `${n.toFixed(1)} hr`; }

export function EntityPatternOverlay({
  focus, drivers, vehicles, transporters, routes, hotspots, events,
  onClose, onEntityClick, aliasLocation,
}: Props) {
  // Resolve the rollup row
  const rollup = useMemo(() => {
    if (focus.kind === "driver")      return drivers.find(d => d.driver_number === focus.key) as any;
    if (focus.kind === "vehicle")     return vehicles.find(v => v.vehicle_number === focus.key) as any;
    if (focus.kind === "transporter") return transporters.find(t => t.transporter_branch === focus.key) as any;
    return routes.find(r => r.route_key === focus.key) as any;
  }, [focus, drivers, vehicles, transporters, routes]);

  // Pull every sampled event for this entity
  const entityEvents = useMemo(() => {
    return events.filter(e => {
      if (focus.kind === "driver")      return e.driver_number === focus.key;
      if (focus.kind === "vehicle")     return e.vehicle_number === focus.key;
      if (focus.kind === "transporter") return e.transporter_branch === focus.key;
      return e.route_key === focus.key;
    });
  }, [focus, events]);

  // Top halt clusters for this entity
  const topClusters = useMemo(() => {
    const m = new Map<string, { count: number; lat: number; lng: number; poi: string; poiType: string; distanceKm: number; sumDur: number; }>();
    for (const e of entityEvents) {
      if (!e.cluster_id) continue;
      let c = m.get(e.cluster_id);
      if (!c) {
        c = { count: 0, lat: e.alert_lat, lng: e.alert_lng, poi: e.nearest_poi_name || "", poiType: e.nearest_poi_type || "", distanceKm: Number(e.distance_to_poi_km) || 0, sumDur: 0 };
        m.set(e.cluster_id, c);
      }
      c.count += 1;
      c.sumDur += +e.long_stoppage_duration_hrs || 0;
    }
    return Array.from(m.entries())
      .map(([cid, v]) => ({ cluster_id: cid, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [entityEvents]);

  // Look up cluster halt_count from hotspots so the user sees the cross-trip context
  const hotspotByCluster = useMemo(() => {
    const m = new Map<string, any>();
    if (hotspots) {
      for (const f of hotspots.features) m.set(f.properties.cluster_id, f.properties);
    }
    return m;
  }, [hotspots]);

  // Related entities: who else (drivers/vehicles/transporters) shows up with this one
  const relatedEntities = useMemo(() => {
    const drv = new Map<string, { name: string; count: number }>();
    const veh = new Map<string, { type: string; count: number }>();
    const trn = new Map<string, number>();
    for (const e of entityEvents) {
      if (focus.kind !== "driver" && e.driver_number) {
        const k = e.driver_number;
        const o = drv.get(k) || { name: e.driver_name || k, count: 0 };
        o.count++; drv.set(k, o);
      }
      if (focus.kind !== "vehicle" && e.vehicle_number) {
        const k = e.vehicle_number;
        const o = veh.get(k) || { type: e.vehicle_type || "", count: 0 };
        o.count++; veh.set(k, o);
      }
      if (focus.kind !== "transporter" && e.transporter_branch) {
        const k = e.transporter_branch;
        trn.set(k, (trn.get(k) || 0) + 1);
      }
    }
    return {
      drivers: Array.from(drv.entries()).map(([number, d]) => ({ number, ...d })).sort((a, b) => b.count - a.count).slice(0, 5),
      vehicles: Array.from(veh.entries()).map(([number, v]) => ({ number, ...v })).sort((a, b) => b.count - a.count).slice(0, 5),
      transporters: Array.from(trn.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    };
  }, [entityEvents, focus.kind]);

  // Display helpers
  const title = useMemo(() => {
    if (focus.kind === "driver")      return rollup?.driver_name ? `${rollup.driver_name}` : focus.key;
    if (focus.kind === "vehicle")     return focus.key;
    if (focus.kind === "transporter") return focus.key;
    return aliasLocation(focus.key) || focus.key;
  }, [focus, rollup, aliasLocation]);

  const subtitle = useMemo(() => {
    if (focus.kind === "driver" && rollup)      return `${rollup.driver_number} · ${rollup.unique_vehicles ?? "—"} vehicles · ${rollup.top_transporter || "—"}`;
    if (focus.kind === "vehicle" && rollup)     return `${rollup.vehicle_type || "—"}${rollup.is_reefer ? " · reefer" : ""} · ${rollup.top_transporter || "—"}`;
    if (focus.kind === "transporter" && rollup) return `${rollup.unique_drivers} drivers · ${rollup.unique_vehicles} vehicles`;
    if (focus.kind === "route" && rollup)       return `${rollup.unique_drivers} drivers · ${rollup.unique_vehicles} vehicles · ${rollup.unique_clusters} clusters`;
    return "";
  }, [focus, rollup]);

  const kpis = useMemo(() => {
    if (!rollup) return [];
    return [
      { label: "Halts", value: fmtNum(rollup.halt_count || 0), sub: "long stoppages" },
      { label: "Night share", value: fmtPct(rollup.night_share || 0), sub: "22:00 – 04:00" },
      { label: "Reefer share", value: fmtPct(rollup.reefer_share || 0), sub: "cold chain" },
      { label: "Median halt", value: fmtHrs(rollup.median_duration_hrs || 0), sub: "per stoppage" },
    ];
  }, [rollup]);

  const riskScore = rollup?.risk_score;
  const riskTier = riskScore >= 85 ? "critical" : riskScore >= 65 ? "high" : riskScore >= 45 ? "medium" : "low";

  return (
    <div className="z-entity-overlay" role="dialog" aria-modal="true">
      <div className="z-entity-backdrop" onClick={onClose} />
      <div className="z-entity-panel">
        <header className="z-entity-head">
          <div>
            <div className="z-entity-tag">{focus.kind.toUpperCase()} · PATTERN ANALYSIS</div>
            <h2 className="z-entity-title">{title}</h2>
            <div className="z-entity-sub">{subtitle}</div>
          </div>
          <div className="z-entity-head-right">
            {typeof riskScore === "number" && (
              <div className={"z-entity-risk is-" + riskTier}>
                <div className="z-entity-risk-label">Risk score</div>
                <div className="z-entity-risk-value">{riskScore}</div>
              </div>
            )}
            <button onClick={onClose} className="z-entity-close" aria-label="Close">×</button>
          </div>
        </header>

        <section className="z-entity-body">
          {/* KPI grid */}
          <div className="z-entity-kpi-row">
            {kpis.map(k => (
              <div key={k.label} className="z-entity-kpi">
                <div className="z-entity-kpi-label">{k.label}</div>
                <div className="z-entity-kpi-value">{k.value}</div>
                <div className="z-entity-kpi-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Repetitive locations */}
          <div className="z-entity-section">
            <div className="z-entity-section-title">Repetitive halt locations · top 8</div>
            <div className="z-entity-section-sub">
              Where this {focus.kind} stops most often. Locations with multiple halts indicate a consistent pattern — either legitimate (fuel, rest) or a recurring red zone.
            </div>
            {topClusters.length === 0 ? (
              <div className="z-entity-empty">No sampled halts available for this {focus.kind}.</div>
            ) : (
              <div className="z-entity-cluster-list">
                {topClusters.map(c => {
                  const hot = hotspotByCluster.get(c.cluster_id);
                  const others = hot ? Math.max(0, hot.halt_count - c.count) : 0;
                  return (
                    <a
                      key={c.cluster_id}
                      href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="z-entity-cluster"
                    >
                      <div className="z-entity-cluster-main">
                        <div className="z-entity-cluster-name">
                          {c.poi && c.poi !== "Unnamed" ? c.poi : (c.poiType || "Unmapped").replace(/_/g, " ")}
                        </div>
                        <div className="z-entity-cluster-meta">
                          {c.lat.toFixed(4)}, {c.lng.toFixed(4)} · {c.distanceKm.toFixed(2)} km from POI
                        </div>
                      </div>
                      <div className="z-entity-cluster-stat">
                        <div className="z-entity-cluster-count">{c.count}</div>
                        <div className="z-entity-cluster-count-sub">halts</div>
                      </div>
                      <div className="z-entity-cluster-stat">
                        <div className="z-entity-cluster-count">{fmtHrs(c.sumDur / Math.max(1, c.count))}</div>
                        <div className="z-entity-cluster-count-sub">avg dwell</div>
                      </div>
                      {others > 0 && (
                        <div className="z-entity-cluster-other">
                          + {others} other {others === 1 ? "trip" : "trips"} halted here
                        </div>
                      )}
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Related entities */}
          <div className="z-entity-related-row">
            {focus.kind !== "driver" && relatedEntities.drivers.length > 0 && (
              <RelatedColumn
                title="Drivers seen"
                rows={relatedEntities.drivers.map(d => ({
                  primary: d.name,
                  secondary: d.number,
                  count: d.count,
                  onClick: () => onEntityClick({ kind: "driver", key: d.number }),
                }))}
              />
            )}
            {focus.kind !== "vehicle" && relatedEntities.vehicles.length > 0 && (
              <RelatedColumn
                title="Vehicles seen"
                rows={relatedEntities.vehicles.map(v => ({
                  primary: v.number,
                  secondary: v.type,
                  count: v.count,
                  onClick: () => onEntityClick({ kind: "vehicle", key: v.number }),
                }))}
              />
            )}
            {focus.kind !== "transporter" && relatedEntities.transporters.length > 0 && (
              <RelatedColumn
                title="Transporters"
                rows={relatedEntities.transporters.map(t => ({
                  primary: t.name,
                  secondary: "",
                  count: t.count,
                  onClick: () => onEntityClick({ kind: "transporter", key: t.name }),
                }))}
              />
            )}
          </div>

          {/* Sample events */}
          {entityEvents.length > 0 && (
            <div className="z-entity-section">
              <div className="z-entity-section-title">Recent sampled halts · {Math.min(10, entityEvents.length)} of {entityEvents.length}</div>
              <div className="z-entity-events-wrap">
                <table className="z-entity-events">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Trip</th>
                      <th>Location</th>
                      <th className="num">Duration</th>
                      <th>POI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entityEvents.slice(0, 10).map((e, i) => (
                      <tr key={i}>
                        <td>{(e.alert_created_at || "").slice(0, 16).replace("T", " ")}</td>
                        <td className="mono">{e.trip_id}</td>
                        <td>{e.alert_lat?.toFixed(4)}, {e.alert_lng?.toFixed(4)}</td>
                        <td className="num"><strong>{(+e.long_stoppage_duration_hrs).toFixed(1)} hr</strong></td>
                        <td>{e.nearest_poi_type ? e.nearest_poi_type.replace(/_/g, " ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function RelatedColumn({ title, rows }: {
  title: string;
  rows: { primary: string; secondary: string; count: number; onClick: () => void }[];
}) {
  return (
    <div className="z-entity-related">
      <div className="z-entity-section-title">{title}</div>
      <div className="z-entity-related-list">
        {rows.map((r, i) => (
          <button key={i} onClick={r.onClick} className="z-entity-related-row-btn">
            <div>
              <div className="z-entity-related-primary">{r.primary}</div>
              {r.secondary && <div className="z-entity-related-secondary">{r.secondary}</div>}
            </div>
            <span className="z-entity-related-count">{r.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
