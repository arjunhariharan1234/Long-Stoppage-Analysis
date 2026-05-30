import { useMemo } from "react";
import type { TripHalt, HotspotFC, EventRow } from "../types";
import type { EntityFocus } from "./EntityPatternOverlay";

interface Props {
  halt: TripHalt;
  haltIndex: number;
  tripId: string;
  hotspots: HotspotFC | null;
  events: EventRow[];
  onClose: () => void;
  onEntityClick: (focus: EntityFocus) => void;
}

function fmtTs(ts: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

function riskScore(h: TripHalt): number {
  let s = 0;
  if (h.duration_hrs >= 8) s += 35;
  else if (h.duration_hrs >= 4) s += 22;
  else if (h.duration_hrs >= 2) s += 12;
  else s += 5;
  if (h.distance_to_poi_km == null || h.distance_to_poi_km > 1.0 || h.poi_type === "No POI within 2km") s += 25;
  else if (h.distance_to_poi_km > 0.5) s += 12;
  if (h.escalation >= 3) s += 15;
  else if (h.escalation >= 2) s += 8;
  if (h.cluster_halt_count >= 10) s += 12;
  else if (h.cluster_halt_count >= 3) s += 6;
  if (h.is_night) s += 8;
  return Math.min(100, s);
}

export function HaltDetailCard({ halt, haltIndex, tripId, hotspots, events, onClose, onEntityClick }: Props) {
  // Cluster-level context: this is the "patterns" data — who else halts at this exact spot
  const cluster = useMemo(() => {
    if (!hotspots) return null;
    return hotspots.features.find(f => f.properties.cluster_id === halt.cluster_id)?.properties || null;
  }, [hotspots, halt.cluster_id]);

  // Other trips that halted in this cluster (from event sample)
  const otherTrips = useMemo(() => {
    const drv = new Map<string, { name: string; count: number; veh: Set<string> }>();
    const veh = new Map<string, { type: string; count: number }>();
    const trn = new Map<string, number>();
    const trips = new Set<string>();
    for (const e of events) {
      if (e.cluster_id !== halt.cluster_id) continue;
      trips.add(e.trip_id);
      if (e.driver_number) {
        const o = drv.get(e.driver_number) || { name: e.driver_name || e.driver_number, count: 0, veh: new Set<string>() };
        o.count++; if (e.vehicle_number) o.veh.add(e.vehicle_number);
        drv.set(e.driver_number, o);
      }
      if (e.vehicle_number) {
        const o = veh.get(e.vehicle_number) || { type: e.vehicle_type || "", count: 0 };
        o.count++; veh.set(e.vehicle_number, o);
      }
      if (e.transporter_branch) trn.set(e.transporter_branch, (trn.get(e.transporter_branch) || 0) + 1);
    }
    return {
      tripCount: trips.size,
      drivers: Array.from(drv.entries()).map(([k, v]) => ({ key: k, ...v, vehicleCount: v.veh.size })).sort((a, b) => b.count - a.count).slice(0, 4),
      vehicles: Array.from(veh.entries()).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.count - a.count).slice(0, 4),
      transporters: Array.from(trn.entries()).map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 4),
    };
  }, [events, halt.cluster_id]);

  const isUnmapped = halt.distance_to_poi_km == null || halt.distance_to_poi_km > 1.0 || halt.poi_type === "No POI within 2km";
  const score = riskScore(halt);
  const scoreCls = score >= 70 ? "is-critical" : score >= 45 ? "is-high" : "";
  const placeName = isUnmapped ? "Unmapped roadside" : (halt.poi_name && halt.poi_name !== "Unnamed" ? halt.poi_name : halt.poi_type || "Halt").replace(/_/g, " ");
  const haltMapsUrl = `https://www.google.com/maps?q=${halt.lat},${halt.lng}`;
  const streetViewUrl = `https://www.google.com/maps?q=&layer=c&cbll=${halt.lat},${halt.lng}`;

  return (
    <div className="z-halt-card">
      <header className="z-halt-card-head">
        <div className="z-halt-card-head-left">
          <span className={"z-halt-card-num" + (isUnmapped ? " is-critical" : halt.escalation >= 2 ? " is-warn" : "")}>{haltIndex + 1}</span>
          <div>
            <div className="z-halt-card-place">{placeName}</div>
            <div className="z-halt-card-coords">{halt.lat?.toFixed(5)}, {halt.lng?.toFixed(5)}</div>
          </div>
        </div>
        <button className="z-halt-card-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="z-halt-card-kpis">
        <div className="z-halt-card-kpi">
          <div className="z-halt-card-kpi-label">Duration</div>
          <div className={"z-halt-card-kpi-value" + (halt.duration_hrs >= 8 ? " is-critical" : halt.duration_hrs >= 4 ? " is-high" : "")}>{halt.duration_hrs.toFixed(1)} hr</div>
        </div>
        <div className="z-halt-card-kpi">
          <div className="z-halt-card-kpi-label">Risk score</div>
          <div className={"z-halt-card-kpi-value " + scoreCls}>{score}</div>
        </div>
        <div className="z-halt-card-kpi">
          <div className="z-halt-card-kpi-label">Escalation</div>
          <div className="z-halt-card-kpi-value">L{halt.escalation}</div>
        </div>
        <div className="z-halt-card-kpi">
          <div className="z-halt-card-kpi-label">Repetition</div>
          <div className={"z-halt-card-kpi-value" + ((cluster?.halt_count || 0) >= 10 ? " is-critical" : (cluster?.halt_count || 0) >= 3 ? " is-high" : "")}>{cluster?.halt_count ?? 1}</div>
        </div>
      </div>

      <div className="z-halt-card-row">
        <span className="z-halt-card-row-label">When</span>
        <span className="z-halt-card-row-value">{fmtTs(halt.ts)}{halt.is_night ? " · night" : ""}</span>
      </div>
      <div className="z-halt-card-row">
        <span className="z-halt-card-row-label">POI context</span>
        <span className="z-halt-card-row-value">
          {isUnmapped
            ? `${halt.distance_to_poi_km ? halt.distance_to_poi_km.toFixed(1) + " km" : ">2 km"} from any logistics POI`
            : `${(halt.distance_to_poi_km ?? 0).toFixed(2)} km from ${(halt.poi_type || "POI").replace(/_/g, " ")}`}
        </span>
      </div>
      {halt.address && (
        <div className="z-halt-card-row">
          <span className="z-halt-card-row-label">Address</span>
          <span className="z-halt-card-row-value" title={halt.address}>{halt.address}</span>
        </div>
      )}
      <div className="z-halt-card-row">
        <span className="z-halt-card-row-label">Trip</span>
        <span className="z-halt-card-row-value mono">{tripId}</span>
      </div>

      {cluster && cluster.halt_count > 1 && (
        <div className="z-halt-card-pattern">
          <div className="z-halt-card-pattern-head">
            <span className="z-halt-card-pattern-tag">REPETITIVE HALT</span>
            <span>{cluster.halt_count} total halts within ~300 m</span>
          </div>
          <div className="z-halt-card-pattern-sub">
            {cluster.unique_drivers} drivers · {cluster.unique_vehicles} vehicles · {cluster.unique_transporters} transporters · {Math.round((cluster.night_share || 0) * 100)}% night
            {cluster.poi_explained ? "" : " · shadow halt"}
          </div>
        </div>
      )}

      {/* Drivers/Vehicles/Transporters who also halt here (from event sample) */}
      {otherTrips.tripCount > 1 && (
        <div className="z-halt-card-section">
          <div className="z-halt-card-section-title">Who else stops here · sampled patterns</div>
          {otherTrips.drivers.length > 0 && (
            <div className="z-halt-card-chips">
              <span className="z-halt-card-chips-label">Drivers</span>
              {otherTrips.drivers.map(d => (
                <button key={d.key} className="z-halt-card-chip" onClick={() => onEntityClick({ kind: "driver", key: d.key })}>
                  {d.name} <span className="z-halt-card-chip-count">×{d.count}</span>
                </button>
              ))}
            </div>
          )}
          {otherTrips.vehicles.length > 0 && (
            <div className="z-halt-card-chips">
              <span className="z-halt-card-chips-label">Vehicles</span>
              {otherTrips.vehicles.map(v => (
                <button key={v.key} className="z-halt-card-chip" onClick={() => onEntityClick({ kind: "vehicle", key: v.key })}>
                  {v.key} <span className="z-halt-card-chip-count">×{v.count}</span>
                </button>
              ))}
            </div>
          )}
          {otherTrips.transporters.length > 0 && (
            <div className="z-halt-card-chips">
              <span className="z-halt-card-chips-label">Transporters</span>
              {otherTrips.transporters.map(t => (
                <button key={t.key} className="z-halt-card-chip" onClick={() => onEntityClick({ kind: "transporter", key: t.key })}>
                  {t.key} <span className="z-halt-card-chip-count">×{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="z-halt-card-actions">
        <a className="z-halt-card-action" href={haltMapsUrl} target="_blank" rel="noopener noreferrer">Google Maps ↗</a>
        <a className="z-halt-card-action" href={streetViewUrl} target="_blank" rel="noopener noreferrer">Street View ↗</a>
      </div>
    </div>
  );
}
