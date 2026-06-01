import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "ft-design-system";
import { api } from "../api";
import type {
  DriverRollup, VehicleRollup, TransporterRollup, RouteRollup, EventRow, TripRow,
} from "../types";
import { MiniMap } from "../components/MiniMap";
import { Sparkline } from "../components/Sparkline";
import { hash, syntheticSeries, forecast, outlierWeeks, trajectory, halfLife } from "../lib/trends";
import { ActionModal } from "../components/ActionModal";
import { activeForTarget, subscribe as subscribeActions, type ActionKind } from "../lib/actionsStore";
import { TripDetail } from "../components/TripDetail";
import { BrainPanel } from "../components/BrainPanel";

type Lens = "driver" | "vehicle" | "transporter" | "route" | "trip";

// Strip warehouse codes (e.g. "DEL069S", "JJR001M"), city prefixes, and operational
// tokens. What's left is the actual place name. Falls back to the raw string.
const ALIAS_JUNK = /^(DEL|HYD|MUM|BLR|BAN|CHN|KOL|AHM|PUN|JAI|JJR|DED|KTP|KAN|CCU|MAA|BOM|PNQ|GGN|FBD|NOI|RAI|LUC|IXC|ATQ|RPR|IXR|IDR|BHO|NAG|VTZ|GOI|MH|FMCG|CAFE|COLD|DRY|FRESH|KTPL|KWPL|FNV|MXL|SXL|FT|TRUCK|REEFER|NETWORK|NEW)$/i;
const ALIAS_CODE = /^[A-Z]{2,4}\d+[A-Z]*$/;
export function aliasLocation(s: string): string {
  if (!s) return "—";
  const tail = s.includes(" - ") ? s.split(" - ").slice(1).join(" - ") : s;
  const tokens = tail.split(/[-_/]+/).map(t => t.trim()).filter(Boolean);
  const keep = tokens.filter(t => !ALIAS_JUNK.test(t) && !ALIAS_CODE.test(t));
  const titled = keep.map(t => /^[A-Z]+\d*$/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t);
  const dedup: string[] = [];
  for (const t of titled) if (dedup[dedup.length - 1] !== t) dedup.push(t);
  const result = dedup.join(" ").trim();
  return result || tokens.join(" ") || s;
}

interface PreselectInfo {
  driver?: string; vehicle?: string; transporter?: string; route?: string; trip?: string;
  /** Auto-open the full trip-detail panel for the selected trip. */
  openDetail?: boolean;
}

interface TripSummary {
  trip_id: string; halt_count: number;
  drivers: Set<string>; vehicles: Set<string>; transporters: Set<string>;
  first_ts?: string; last_ts?: string;
}

interface DrillStep { lens: Lens; key: string; label: string }

interface Props { preselect?: PreselectInfo | null }

const LENS_LABEL: Record<Lens, string> = {
  trip: "Trips", driver: "Drivers", vehicle: "Vehicles", transporter: "Transporters", route: "Routes",
};

export function Investigation({ preselect }: Props) {
  const [lens, setLens] = useState<Lens>("trip");
  const [drivers, setDrivers] = useState<DriverRollup[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRollup[]>([]);
  const [transporters, setTransporters] = useState<TransporterRollup[]>([]);
  const [routes, setRoutes] = useState<RouteRollup[]>([]);
  const [tripRows, setTripRows] = useState<TripRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [directionFilter, setDirectionFilter] = useState<string>("");
  // Time-window filter — "actionable" view by default (last 7 days) so users
  // land on recent trips. Stored as days; 0 = "All time".
  const [windowDays, setWindowDays] = useState<number>(7);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drillStack, setDrillStack] = useState<DrillStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailTrip, setDetailTrip] = useState<TripRow | null>(null);
  const [tripSubTab, setTripSubTab] = useState<"detail" | "brain">("detail");
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    Promise.all([api.drivers(), api.vehicles(), api.transporters(), api.routes(), api.trips(), api.events()])
      .then(([d, v, t, r, tr, e]) => {
        setDrivers(d); setVehicles(v); setTransporters(t); setRoutes(r); setTripRows(tr); setEvents(e); setLoading(false);
      })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  // Preselect from Pulse: populate query so the list narrows to that entity,
  // and bypass eventKeys gating so the row is always visible.
  useEffect(() => {
    if (loading || !preselect) return;
    if (preselect.driver) {
      setLens("driver");
      setSelectedKey(preselect.driver);
      const d = drivers.find(x => x.driver_number === preselect.driver);
      setQuery(d?.driver_name || preselect.driver);
    } else if (preselect.vehicle) {
      setLens("vehicle"); setSelectedKey(preselect.vehicle); setQuery(preselect.vehicle);
    } else if (preselect.transporter) {
      setLens("transporter"); setSelectedKey(preselect.transporter); setQuery(preselect.transporter);
    } else if (preselect.route) {
      setLens("route"); setSelectedKey(preselect.route); setQuery(preselect.route);
    } else if (preselect.trip) {
      setLens("trip"); setSelectedKey(preselect.trip); setQuery(preselect.trip);
      if (preselect.openDetail) {
        const tripRow = tripRows.find(t => t.trip_id === preselect.trip);
        if (tripRow) {
          setDetailTrip(tripRow);
          setTripSubTab("detail");
        }
        // If the brain-flagged trip isn't in tripRows (events sample only
        // covers a subset), the listing-state fallback above still narrows
        // the query so the user lands close to the right context.
      }
    }
  }, [loading, preselect, drivers, tripRows]);

  // Scroll preselected row into view once data renders.
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedKey, lens, query, loading]);

  const trips = useMemo<TripSummary[]>(() => {
    const map = new Map<string, TripSummary>();
    for (const e of events) {
      if (!e.trip_id) continue;
      let t = map.get(e.trip_id);
      if (!t) {
        t = { trip_id: e.trip_id, halt_count: 0, drivers: new Set(), vehicles: new Set(), transporters: new Set() };
        map.set(e.trip_id, t);
      }
      t.halt_count += 1;
      if (e.driver_number) t.drivers.add(e.driver_number);
      if (e.vehicle_number) t.vehicles.add(e.vehicle_number);
      if (e.transporter_branch) t.transporters.add(e.transporter_branch);
      if (e.alert_created_at) {
        if (!t.first_ts || e.alert_created_at < t.first_ts) t.first_ts = e.alert_created_at;
        if (!t.last_ts || e.alert_created_at > t.last_ts) t.last_ts = e.alert_created_at;
      }
    }
    return [...map.values()].sort((a, b) => b.halt_count - a.halt_count);
  }, [events]);

  // Entity keys that have at least one event in the sampled events file.
  // Filters lists so we never show an entity that would render empty location data.
  const eventKeys = useMemo(() => {
    const d = new Set<string>(), v = new Set<string>(), t = new Set<string>(), r = new Set<string>();
    for (const e of events) {
      if (e.driver_number) d.add(e.driver_number);
      if (e.vehicle_number) v.add(e.vehicle_number);
      if (e.transporter_branch) t.add(e.transporter_branch);
      if (e.route_key) r.add(e.route_key);
    }
    return { d, v, t, r };
  }, [events]);

  // When a query is active, search the full rollup universe (don't gate on eventKeys);
  // this is what makes preselect-from-Pulse always show the row.
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const gate = q.length === 0;
    if (lens === "driver") return drivers.filter(d => !gate || eventKeys.d.has(d.driver_number)).filter(d => !q || d.driver_name.toLowerCase().includes(q) || d.driver_number.includes(q) || d.top_transporter.toLowerCase().includes(q)).slice(0, 250);
    if (lens === "vehicle") return vehicles.filter(v => !gate || eventKeys.v.has(v.vehicle_number)).filter(v => !q || v.vehicle_number.toLowerCase().includes(q) || (v.top_transporter || "").toLowerCase().includes(q)).slice(0, 250);
    if (lens === "transporter") return transporters.filter(t => !gate || eventKeys.t.has(t.transporter_branch)).filter(t => !q || t.transporter_branch.toLowerCase().includes(q)).slice(0, 200);
    if (lens === "trip") return trips.filter(t => !q || t.trip_id.toLowerCase().includes(q)).slice(0, 250);
    return routes.filter(r => !gate || eventKeys.r.has(r.route_key)).filter(r => !q || r.route_key.toLowerCase().includes(q)).slice(0, 200);
  }, [lens, query, drivers, vehicles, transporters, routes, trips, eventKeys]);

  // Trip-table data: respects the same query and adds zone / direction / time-window filters.
  const tripTableRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Anchor the time window to the latest alert timestamp in the data
    // rather than `now()` — the demo dataset is from early 2026, so a
    // wall-clock "last 7 days" would always be empty.
    let cutoffMs: number | null = null;
    if (windowDays > 0 && tripRows.length > 0) {
      let latestMs = 0;
      for (const t of tripRows) {
        const ts = t.latest_alert_at ? Date.parse(t.latest_alert_at) : 0;
        if (!isNaN(ts) && ts > latestMs) latestMs = ts;
      }
      if (latestMs > 0) cutoffMs = latestMs - windowDays * 24 * 60 * 60 * 1000;
    }
    const filtered = tripRows.filter(t => {
      if (zoneFilter && t.zone !== zoneFilter) return false;
      if (directionFilter && t.inbound_or_outbound !== directionFilter) return false;
      if (cutoffMs != null) {
        const ts = t.latest_alert_at ? Date.parse(t.latest_alert_at) : 0;
        if (isNaN(ts) || ts < cutoffMs) return false;
      }
      if (!q) return true;
      return (
        t.trip_id.toLowerCase().includes(q) ||
        t.vehicle_number.toLowerCase().includes(q) ||
        t.transporter_branch.toLowerCase().includes(q) ||
        (t.driver_name || "").toLowerCase().includes(q) ||
        t.origin.toLowerCase().includes(q) ||
        t.destination.toLowerCase().includes(q)
      );
    });
    // Recency-first sort: most-recent latest_alert_at on top. Older trips
    // can't be acted on, so they shouldn't lead the list.
    filtered.sort((a, b) => {
      const ta = a.latest_alert_at ? Date.parse(a.latest_alert_at) : 0;
      const tb = b.latest_alert_at ? Date.parse(b.latest_alert_at) : 0;
      const aNum = isNaN(ta) ? 0 : ta;
      const bNum = isNaN(tb) ? 0 : tb;
      return bNum - aNum;
    });
    return filtered;
  }, [tripRows, query, zoneFilter, directionFilter, windowDays]);

  const tripKpis = useMemo(() => {
    const total = tripTableRows.length;
    const vehicleSet = new Set<string>();
    const transporterSet = new Set<string>();
    let halts = 0, totalStoppageHrs = 0, critical = 0, highEsc = 0, reeferCount = 0;
    for (const t of tripTableRows) {
      if (t.vehicle_number) vehicleSet.add(t.vehicle_number);
      if (t.transporter_branch) transporterSet.add(t.transporter_branch);
      halts += t.halt_count;
      totalStoppageHrs += t.total_stoppage_hrs;
      if (t.max_escalation >= 3) critical += 1;
      else if (t.max_escalation === 2) highEsc += 1;
      if (t.is_reefer) reeferCount += 1;
    }
    return {
      total,
      halts,
      avgStoppage: total ? +(totalStoppageHrs / total).toFixed(1) : 0,
      vehicles: vehicleSet.size,
      transporters: transporterSet.size,
      critical,
      highEsc,
      reeferCount,
    };
  }, [tripTableRows]);

  const zoneOptions = useMemo(() => {
    const s = new Set<string>();
    for (const t of tripRows) if (t.zone) s.add(t.zone);
    return Array.from(s).sort();
  }, [tripRows]);
  const directionOptions = useMemo(() => {
    const s = new Set<string>();
    for (const t of tripRows) if (t.inbound_or_outbound) s.add(t.inbound_or_outbound);
    return Array.from(s).sort();
  }, [tripRows]);

  useEffect(() => {
    if (!selectedKey && list.length > 0) {
      const first = list[0] as any;
      const key = lens === "driver" ? first.driver_number
                : lens === "vehicle" ? first.vehicle_number
                : lens === "transporter" ? first.transporter_branch
                : lens === "trip" ? first.trip_id
                : first.route_key;
      setSelectedKey(key);
    }
  }, [list, selectedKey, lens]);

  const selectedEvents = useMemo(() => {
    if (!selectedKey) return [];
    if (lens === "driver") return events.filter(e => e.driver_number === selectedKey);
    if (lens === "vehicle") return events.filter(e => e.vehicle_number === selectedKey);
    if (lens === "transporter") return events.filter(e => e.transporter_branch === selectedKey);
    if (lens === "trip") return events.filter(e => e.trip_id === selectedKey);
    return events.filter(e => e.route_key === selectedKey);
  }, [events, lens, selectedKey]);

  const selectedMeta = useMemo(() => {
    if (!selectedKey) return null;
    if (lens === "driver") return drivers.find(d => d.driver_number === selectedKey);
    if (lens === "vehicle") return vehicles.find(v => v.vehicle_number === selectedKey);
    if (lens === "transporter") return transporters.find(t => t.transporter_branch === selectedKey);
    if (lens === "trip") return trips.find(t => t.trip_id === selectedKey);
    return routes.find(r => r.route_key === selectedKey);
  }, [lens, selectedKey, drivers, vehicles, transporters, routes, trips]);

  const labelFor = (l: Lens, key: string): string => {
    if (l === "driver") return drivers.find(d => d.driver_number === key)?.driver_name || key;
    if (l === "trip") return `Trip ${key}`;
    return key;
  };

  const jumpTo = (l: Lens, key: string) => {
    if (lens && selectedKey) {
      setDrillStack(s => [...s, { lens, key: selectedKey, label: labelFor(lens, selectedKey) }]);
    }
    setLens(l); setSelectedKey(key); setQuery("");
  };

  const popTo = (idx: number) => {
    const step = drillStack[idx];
    setDrillStack(drillStack.slice(0, idx));
    setLens(step.lens); setSelectedKey(step.key); setQuery("");
  };

  const switchLens = (l: Lens) => {
    if (l === lens) return;
    setLens(l); setSelectedKey(null); setQuery(""); setDetailTrip(null);
  };

  if (!loading && lens === "trip" && detailTrip) {
    // Re-look the trip up from tripRows to pick up freshly-loaded halts (the table
    // row reference may be a partial snapshot from before the data refresh).
    const fullTrip = tripRows.find(t => t.trip_id === detailTrip.trip_id) || detailTrip;
    return (
      <div className="z-trip-detail-wrap trip-detail-wrap">
        <div className="trip-detail-tabs">
          <button
            className={tripSubTab === "detail" ? "is-active" : ""}
            onClick={() => setTripSubTab("detail")}
          >Detail</button>
          <button
            className={tripSubTab === "brain" ? "is-active" : ""}
            onClick={() => setTripSubTab("brain")}
          >Brain</button>
        </div>
        {tripSubTab === "detail" ? (
          <TripDetail trip={fullTrip} onBack={() => setDetailTrip(null)} aliasLocation={aliasLocation} />
        ) : (
          <BrainPanel tripId={fullTrip.trip_id} />
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="z-container z-page">
        <div style={{ height: 32, width: 280, background: "#f0f1f7", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 18, width: 400, background: "#f0f1f7", borderRadius: 4, marginBottom: 48 }} />
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[0,1,2,3,4,5,6,7].map(i => <div key={i} style={{ height: 56, background: "#f0f1f7", borderRadius: 4 }} />)}</div>
          <div style={{ height: 600, background: "#f0f1f7", borderRadius: 8 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="z-container z-page">
      {/* Drill breadcrumb */}
      {drillStack.length > 0 && (
        <div className="z-crumbs" style={{ marginBottom: 20 }}>
          {drillStack.map((s, i) => (
            <span key={`${s.lens}-${s.key}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => popTo(i)} className="z-crumb">
                <span className="z-crumb-lens">{s.lens}</span>
                <span>{s.label}</span>
              </button>
              <span className="z-crumb-sep">›</span>
            </span>
          ))}
          <span className="z-crumb-current">
            <span className="z-crumb-lens">{lens}</span>
            <span>{selectedKey ? labelFor(lens, selectedKey) : "…"}</span>
          </span>
        </div>
      )}

      {/* Lens segmented */}
      <div className="z-seg" style={{ marginBottom: 24 }}>
        {(Object.keys(LENS_LABEL) as Lens[]).map(l => (
          <button
            key={l}
            onClick={() => switchLens(l)}
            className={"z-seg-tab" + (l === lens ? " is-active" : "")}
          >
            {LENS_LABEL[l]}
          </button>
        ))}
      </div>

      {lens === "trip" && !detailTrip && (
        <TripTable
          rows={tripTableRows}
          kpis={tripKpis}
          query={query}
          onQuery={setQuery}
          zoneFilter={zoneFilter}
          onZoneFilter={setZoneFilter}
          directionFilter={directionFilter}
          onDirectionFilter={setDirectionFilter}
          zoneOptions={zoneOptions}
          directionOptions={directionOptions}
          windowDays={windowDays}
          onWindowDays={setWindowDays}
          aliasLocation={aliasLocation}
          onView={(t) => setDetailTrip(t)}
        />
      )}

      {lens !== "trip" && (
      <div className="z-workbench">
        {/* List */}
        <div className="z-list">
          <div className="z-list-search">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={
                lens === "driver" ? "Search by name or number…"
                : lens === "vehicle" ? "Search vehicle…"
                : lens === "transporter" ? "Search transporter…"
                : "Search route…"
              }
            />
          </div>
          <div className="z-list-scroll">
            {list.length === 0 && (
              <div style={{ padding: "40px 16px", textAlign: "center", fontSize: 13, color: "#838c9d" }}>No matches</div>
            )}
            {list.map((item: any, idx: number) => {
              const key = lens === "driver" ? item.driver_number
                        : lens === "vehicle" ? item.vehicle_number
                        : lens === "transporter" ? item.transporter_branch
                        : item.route_key;
              const reactKey = `${key}-${idx}`;
              const primary = lens === "driver" ? item.driver_name
                            : lens === "vehicle" ? item.vehicle_number
                            : lens === "transporter" ? item.transporter_branch
                            : item.route_key;
              const sub = lens === "driver" ? `${item.driver_number} · ${item.halt_count} halts`
                        : lens === "vehicle" ? `${item.halt_count} halts · ${item.vehicle_type}`
                        : lens === "transporter" ? `${item.halt_count} halts · ${item.unique_drivers} drivers`
                        : `${item.halt_count} halts · ${item.unique_drivers} drivers`;
              const score = item.risk_score;
              const isSelected = key === selectedKey;
              return (
                <button
                  key={reactKey}
                  ref={isSelected ? selectedRef : undefined}
                  onClick={() => setSelectedKey(key)}
                  className={"z-list-item" + (isSelected ? " is-selected" : "")}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="z-list-item-primary" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{primary}</div>
                    <div className="z-list-item-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
                  </div>
                  <span className="z-list-item-score">{score}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail */}
        <div>
          {!selectedMeta ? (
            <div className="z-detail-empty">
              Select an entity from the list to investigate
            </div>
          ) : (
            <Detail
              lens={lens}
              meta={selectedMeta as any}
              events={selectedEvents}
              drivers={drivers}
              onJumpTo={jumpTo}
              key={`${lens}-${selectedKey}`}
            />
          )}
        </div>
      </div>
      )}
    </div>
  );
}

/* =========================================================
 * Trip table — Control Tower-style landing for the trip lens
 * ========================================================= */
function TripTable({
  rows, kpis, query, onQuery, zoneFilter, onZoneFilter,
  directionFilter, onDirectionFilter, zoneOptions, directionOptions,
  windowDays, onWindowDays, aliasLocation, onView,
}: {
  rows: TripRow[];
  kpis: {
    total: number; halts: number; avgStoppage: number; vehicles: number;
    transporters: number; critical: number; highEsc: number; reeferCount: number;
  };
  query: string;
  onQuery: (q: string) => void;
  zoneFilter: string;
  onZoneFilter: (z: string) => void;
  directionFilter: string;
  onDirectionFilter: (d: string) => void;
  zoneOptions: string[];
  directionOptions: string[];
  windowDays: number;
  onWindowDays: (d: number) => void;
  aliasLocation: (s: string) => string;
  onView: (t: TripRow) => void;
}) {
  const WINDOW_OPTIONS: { days: number; label: string }[] = [
    { days: 7, label: "Last 7 days" },
    { days: 30, label: "Last 30 days" },
    { days: 90, label: "Last 90 days" },
    { days: 0, label: "All time" },
  ];
  const [page, setPage] = useState(0);
  const PER_PAGE = 50;
  const pageRows = rows.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));

  function fmtDate(s: string) {
    if (!s) return "—";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(0, 10);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }
  function durationClass(hrs: number) {
    if (hrs >= 8) return "is-critical";
    if (hrs >= 4) return "is-high";
    return "";
  }
  function escalationLabel(level: number) {
    if (level >= 3) return { label: "Critical", cls: "is-critical" };
    if (level === 2) return { label: "High", cls: "is-high" };
    if (level === 1) return { label: "Watch", cls: "" };
    return { label: "—", cls: "" };
  }

  return (
    <>
      {/* KPI ribbon */}
      <div className="z-trip-kpi-row">
        <TripKpi label="Total trips" value={kpis.total.toLocaleString("en-IN")} />
        <TripKpi label="Total halts" value={kpis.halts.toLocaleString("en-IN")} />
        <TripKpi label="Avg stoppage" value={`${kpis.avgStoppage} hr`} />
        <TripKpi label="Unique vehicles" value={kpis.vehicles.toLocaleString("en-IN")} />
        <TripKpi label="Unique transporters" value={kpis.transporters.toLocaleString("en-IN")} />
        <TripKpi label="High severity" value={kpis.highEsc.toLocaleString("en-IN")} tone="high" />
        <TripKpi label="Critical" value={kpis.critical.toLocaleString("en-IN")} tone="critical" />
        <TripKpi label="Reefer trips" value={kpis.reeferCount.toLocaleString("en-IN")} />
      </div>

      {/* Time-window pill filter — recent trips are the actionable ones. */}
      <div className="z-trip-window-row">
        <span className="z-trip-window-label">When:</span>
        {WINDOW_OPTIONS.map(opt => (
          <button
            key={opt.days}
            type="button"
            className={"z-trip-window-pill" + (windowDays === opt.days ? " is-active" : "")}
            onClick={() => { onWindowDays(opt.days); setPage(0); }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="z-trip-filterbar">
        <input
          className="z-trip-search"
          value={query}
          onChange={e => { onQuery(e.target.value); setPage(0); }}
          placeholder="Search by trip ID, vehicle, transporter, driver, origin, destination…"
        />
        <select
          className="z-trip-select"
          value={zoneFilter}
          onChange={e => { onZoneFilter(e.target.value); setPage(0); }}
        >
          <option value="">All zones</option>
          {zoneOptions.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select
          className="z-trip-select"
          value={directionFilter}
          onChange={e => { onDirectionFilter(e.target.value); setPage(0); }}
        >
          <option value="">Inbound + Outbound</option>
          {directionOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="z-trip-result-count">{rows.length.toLocaleString("en-IN")} trips</span>
      </div>

      {/* Table */}
      <div className="z-trip-table-wrap">
        <table className="z-trip-table">
          <thead>
            <tr>
              <th>Trip</th>
              <th>Origin → Destination</th>
              <th>Vehicle</th>
              <th>Transporter</th>
              <th>Driver</th>
              <th className="num">Halts</th>
              <th className="num">Max halt</th>
              <th>Halt POI</th>
              <th>Severity</th>
              <th>Last alert</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign: "center", padding: "48px 16px", color: "#838c9d" }}>No trips match the current filters.</td></tr>
            )}
            {pageRows.map(t => {
              const sev = escalationLabel(t.max_escalation);
              const originAlias = aliasLocation(t.origin);
              const destAlias = aliasLocation(t.destination);
              const fullRoute = `${t.origin || "—"}\n→ ${t.destination || "—"}`;
              const poiTypeClean = (t.top_poi_type || "").replace(/_/g, " ");
              const poiUnmapped = !t.top_poi_distance_km || t.top_poi_distance_km > 1.0 || t.top_poi_type === "No POI within 2km";
              return (
                <tr key={t.trip_id}>
                  <td>
                    <div className="z-trip-tripid" title={t.trip_id}>{t.trip_id.slice(0, 14)}{t.trip_id.length > 14 ? "…" : ""}</div>
                    <div className="z-trip-zone">{t.zone || "—"} · {t.inbound_or_outbound || "—"}</div>
                  </td>
                  <td title={fullRoute}>
                    <div className="z-trip-route">
                      <span className="z-trip-route-from">{originAlias}</span>
                      <span className="z-trip-route-arrow">→</span>
                      <span className="z-trip-route-to">{destAlias}</span>
                    </div>
                    <div className="z-trip-route-sub">
                      {t.total_planned_distance ? `${Math.round(t.total_planned_distance)} km planned` : "—"}
                      {t.total_transit_distance ? ` · ${Math.round(t.total_transit_distance)} km actual` : ""}
                    </div>
                  </td>
                  <td>
                    <div className="z-trip-vehicle">{t.vehicle_number || "—"}</div>
                    <div className="z-trip-vehicle-sub">{t.vehicle_type || "—"}{t.is_reefer ? " · reefer" : ""}</div>
                  </td>
                  <td className="z-trip-transporter">{t.transporter_branch || "—"}</td>
                  <td>
                    <div>{t.driver_name || "—"}</div>
                    <div className="z-trip-driver-sub">{t.driver_number || ""}</div>
                  </td>
                  <td className="num"><strong>{t.halt_count}</strong></td>
                  <td className={"num " + durationClass(t.max_stoppage_hrs)}>{t.max_stoppage_hrs.toFixed(1)} hr</td>
                  <td title={t.top_poi_name ? `${t.top_poi_name} (${t.top_poi_category || "—"})` : ""}>
                    {poiUnmapped ? (
                      <>
                        <div className="z-trip-poi-type is-unmapped">Unmapped halt</div>
                        <div className="z-trip-poi-sub">{t.top_poi_distance_km ? `${t.top_poi_distance_km.toFixed(1)} km from nearest` : ">2 km from any POI"}</div>
                      </>
                    ) : (
                      <>
                        <div className="z-trip-poi-type">{poiTypeClean || "—"}</div>
                        <div className="z-trip-poi-sub">
                          {t.top_poi_distance_km != null ? `${t.top_poi_distance_km.toFixed(2)} km` : "—"}
                          {t.top_poi_name && t.top_poi_name !== "Unnamed" ? ` · ${t.top_poi_name.length > 18 ? t.top_poi_name.slice(0, 18) + "…" : t.top_poi_name}` : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={"z-trip-sev " + sev.cls}>{sev.label}</span>
                  </td>
                  <td className="z-trip-date">{fmtDate(t.latest_alert_at)}</td>
                  <td>
                    <button className="z-trip-view" onClick={() => onView(t)}>View</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="z-trip-pagination">
        <span>{rows.length === 0 ? "0 trips" : `Showing ${page * PER_PAGE + 1}–${Math.min((page + 1) * PER_PAGE, rows.length)} of ${rows.length.toLocaleString("en-IN")}`}</span>
        <div className="z-trip-pagination-controls">
          <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</button>
          <span>Page {page + 1} / {totalPages}</span>
          <button disabled={page + 1 >= totalPages} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next →</button>
        </div>
      </div>
    </>
  );
}

function TripKpi({ label, value, tone }: { label: string; value: string; tone?: "high" | "critical" }) {
  return (
    <div className={"z-trip-kpi" + (tone ? " is-" + tone : "")}>
      <div className="z-trip-kpi-label">{label}</div>
      <div className="z-trip-kpi-value">{value}</div>
    </div>
  );
}

function Detail({ lens, meta, events, drivers, onJumpTo }: {
  lens: Lens; meta: any; events: EventRow[];
  drivers?: DriverRollup[]; onJumpTo: (lens: Lens, key: string) => void;
}) {
  const [modalKind, setModalKind] = useState<ActionKind | null>(null);
  const [, forceTick] = useState(0);
  useEffect(() => subscribeActions(() => forceTick(t => t + 1)), []);

  // Determine the action target shape for this entity
  const actionTarget = useMemo(() => {
    if (lens === "driver" && meta?.driver_number) {
      return {
        kind: "blacklist_driver" as ActionKind,
        targetType: "driver" as const,
        key: meta.driver_number,
        label: meta.driver_name,
        sub: `${meta.driver_number} · risk ${meta.risk_score}`,
        baselineHaltsPerWeek: Math.max(1, (meta.halt_count || 0) / 12),
        seedEvidence: [
          { kind: "note" as const, ref: "", label: `Risk score ${meta.risk_score} · ${meta.halt_count} halts · ${Math.round((meta.night_share || 0) * 100)}% night` },
          { kind: "note" as const, ref: "", label: `${meta.unique_vehicles} vehicles · ${meta.unique_clusters} distinct locations` },
        ],
      };
    }
    if (lens === "vehicle" && meta?.vehicle_number) {
      return {
        kind: "blacklist_vehicle" as ActionKind,
        targetType: "vehicle" as const,
        key: meta.vehicle_number,
        label: meta.vehicle_number,
        sub: `${meta.vehicle_type} · risk ${meta.risk_score}`,
        baselineHaltsPerWeek: Math.max(1, (meta.halt_count || 0) / 12),
        seedEvidence: [
          { kind: "note" as const, ref: "", label: `Risk score ${meta.risk_score} · ${meta.halt_count} halts · ${Math.round((meta.night_share || 0) * 100)}% night` },
        ],
      };
    }
    if (lens === "transporter" && meta?.transporter_branch) {
      return {
        kind: "blacklist_transporter" as ActionKind,
        targetType: "transporter" as const,
        key: meta.transporter_branch,
        label: meta.transporter_branch,
        sub: `${meta.unique_drivers} drivers · risk ${meta.risk_score}`,
        baselineHaltsPerWeek: Math.max(1, (meta.halt_count || 0) / 12),
        seedEvidence: [
          { kind: "note" as const, ref: "", label: `Risk score ${meta.risk_score} · ${(meta.halt_count || 0).toLocaleString("en-IN")} halts · ${meta.unique_drivers} drivers · ${meta.unique_vehicles} vehicles` },
        ],
      };
    }
    return null;
  }, [lens, meta]);

  const existing = actionTarget ? activeForTarget(actionTarget.targetType, actionTarget.key) : undefined;
  const title = lens === "driver" ? `${meta.driver_name} · ${meta.driver_number}`
              : lens === "vehicle" ? meta.vehicle_number
              : lens === "transporter" ? meta.transporter_branch
              : lens === "trip" ? `Trip ${meta.trip_id}`
              : meta.route_key;

  const sampleHalts = events.length;
  const sampleNight = sampleHalts > 0 ? events.filter(e => +e.is_night === 1).length / sampleHalts : 0;
  const sampleReefer = sampleHalts > 0 ? events.filter(e => +e.is_reefer === 1).length / sampleHalts : 0;
  const sortedDur = sampleHalts > 0 ? [...events.map(e => +e.long_stoppage_duration_hrs)].sort((a, b) => a - b) : [];
  const sampleMedian = sortedDur.length ? sortedDur[Math.floor(sortedDur.length / 2)] : 0;
  const clusters = new Set(events.map(e => e.cluster_id));
  const unknownEvents = events.filter(e => {
    const d = +e.distance_to_poi_km;
    return d > 0.3 && !["fuel", "toll_booth", "restaurant", "fast_food", "cafe", "hotel", "motel", "rest_area"].includes((e.nearest_poi_type || "").toLowerCase());
  });
  const unknownShare = sampleHalts > 0 ? unknownEvents.length / sampleHalts : 0;

  const isTrip = lens === "trip";
  const totalHalts = isTrip ? sampleHalts : (meta?.halt_count ?? sampleHalts);
  const nightShare = isTrip ? sampleNight : (meta?.night_share ?? sampleNight);
  const reeferShare = isTrip ? sampleReefer : (meta?.reefer_share ?? sampleReefer);
  const medianDur = isTrip ? sampleMedian : (meta?.median_duration_hrs ?? sampleMedian);
  const distinctClusters = isTrip ? clusters.size : (meta?.unique_clusters ?? clusters.size);

  const driverPatterns = useMemo(() => {
    if (lens !== "trip") return [];
    const counts = new Map<string, { halts: number; name: string }>();
    for (const e of events) {
      if (!e.driver_number) continue;
      const cur = counts.get(e.driver_number);
      if (cur) cur.halts += 1;
      else counts.set(e.driver_number, { halts: 1, name: e.driver_name || "" });
    }
    return [...counts.entries()].map(([num, c]) => ({
      driver_number: num, driver_name: c.name, halts_on_trip: c.halts,
      rollup: drivers?.find(d => d.driver_number === num),
    })).sort((a, b) => b.halts_on_trip - a.halts_on_trip);
  }, [lens, events, drivers]);

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

  const centerLat = topClusters.length ? topClusters[0][1].lat : (events[0]?.alert_lat ?? 22);
  const centerLng = topClusters.length ? topClusters[0][1].lng : (events[0]?.alert_lng ?? 78);
  const evidencePoints = topClusters.map(([, c]) => ({ lat: c.lat, lng: c.lng, size: 6 + Math.min(10, c.count) }));

  return (
    <div className="z-detail">
      <div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
          <div style={{ minWidth: 0 }}>
            <div className="z-caps" style={{ marginBottom: 6 }}>{lens}</div>
            <h2 className="z-section-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h2>
            <div className="z-body-sm z-secondary" style={{ marginTop: 8 }}>
              {lens === "driver" && `Top transporter: ${meta.top_transporter || "—"} · ${meta.unique_vehicles} vehicles seen`}
              {lens === "vehicle" && `${meta.vehicle_type} · ${meta.dedicated === "Yes" ? "Dedicated" : meta.dedicated === "No" ? "Non-dedicated" : "—"} · ${meta.top_transporter || "—"}`}
              {lens === "transporter" && `${meta.unique_drivers} drivers · ${meta.unique_vehicles} vehicles`}
              {lens === "route" && `${meta.unique_drivers} drivers · ${meta.unique_vehicles} vehicles`}
              {lens === "trip" && `${meta.drivers.size} driver(s) · ${meta.vehicles.size} vehicle(s) · ${meta.transporters.size} transporter(s)`}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#1a2330", lineHeight: 1, letterSpacing: "-0.01em" }}>
                {lens === "trip" ? meta.halt_count : meta.risk_score}
              </div>
              <div className="z-caps" style={{ marginTop: 6 }}>
                {lens === "trip" ? "Halts on trip" : "Risk · 100"}
              </div>
            </div>
            {actionTarget && (
              existing ? (
                <span className="z-blacklist-badge">Blacklisted · {existing.severity}</span>
              ) : (
                <button
                  className="z-btn-primary is-destructive"
                  style={{ height: 32, fontSize: 12, padding: "0 14px" }}
                  onClick={() => setModalKind(actionTarget.kind)}
                >
                  Blacklist {lens}
                </button>
              )
            )}
          </div>
        </div>

        {modalKind && actionTarget && (
          <ActionModal
            kind={modalKind}
            target={{
              type: actionTarget.targetType,
              key: actionTarget.key,
              label: actionTarget.label,
              sub: actionTarget.sub,
              baselineHaltsPerWeek: actionTarget.baselineHaltsPerWeek,
              seedEvidence: actionTarget.seedEvidence,
            }}
            onClose={() => setModalKind(null)}
          />
        )}

        {/* 12-week trend card */}
        {(() => {
          const entityKey = (meta as any).driver_number || (meta as any).vehicle_number || (meta as any).transporter_branch || (meta as any).route_key || (meta as any).trip_id || "x";
          const isTrip = lens === "trip";
          const currentHalts = isTrip ? sampleHalts : (meta as any).halt_count || sampleHalts;
          const currentNight = isTrip ? sampleNight : (meta as any).night_share || sampleNight;
          const currentRisk = isTrip ? sampleHalts : (meta as any).risk_score || 0;
          const haltSeries = syntheticSeries(hash(entityKey + "halts"), currentHalts, { weeks: 12, volatility: 0.16 });
          const nightSeries = syntheticSeries(hash(entityKey + "night"), Math.round(currentNight * 100), { weeks: 12, volatility: 0.12 });
          const riskSeries = syntheticSeries(hash(entityKey + "risk"), currentRisk, { weeks: 12, volatility: 0.10 });
          const haltOutliers = outlierWeeks(haltSeries);
          const haltForecast = forecast(haltSeries, 2);
          const haltTraj = trajectory(haltSeries);
          const nightTraj = trajectory(nightSeries);
          const riskTraj = trajectory(riskSeries);
          return (
            <div className="z-trend-card">
              <div className="z-trend-tile">
                <div className="z-trend-tile-label">Halt count · 12 wk</div>
                <div className="z-trend-tile-value">
                  {Math.round(haltSeries[haltSeries.length - 1])}
                  <span className={"z-trajectory is-" + haltTraj.dir}>
                    <span>{haltTraj.dir === "up" ? "▲" : haltTraj.dir === "down" ? "▼" : "→"}</span>
                    <span>{haltTraj.dir === "flat" ? "flat" : `${Math.abs(haltTraj.deltaPct).toFixed(0)}%`}</span>
                  </span>
                </div>
                <div className="z-trend-tile-spark">
                  <Sparkline values={haltSeries} forecast={haltForecast} outlierIdx={haltOutliers}
                    width={220} height={36} ariaLabel="halt count last 12 weeks" />
                </div>
              </div>
              <div className="z-trend-tile">
                <div className="z-trend-tile-label">Night share · 12 wk</div>
                <div className="z-trend-tile-value">
                  {Math.round(nightSeries[nightSeries.length - 1])}%
                  <span className={"z-trajectory is-" + nightTraj.dir}>
                    <span>{nightTraj.dir === "up" ? "▲" : nightTraj.dir === "down" ? "▼" : "→"}</span>
                    <span>{nightTraj.dir === "flat" ? "flat" : `${Math.abs(nightTraj.deltaPct).toFixed(0)}%`}</span>
                  </span>
                </div>
                <div className="z-trend-tile-spark">
                  <Sparkline values={nightSeries} width={220} height={36} stroke="#5f697b" fill="rgba(95,105,123,0.08)"
                    ariaLabel="night share last 12 weeks" />
                </div>
              </div>
              <div className="z-trend-tile">
                <div className="z-trend-tile-label">Risk score · 12 wk</div>
                <div className="z-trend-tile-value">
                  {Math.round(riskSeries[riskSeries.length - 1])}
                  <span className={"z-trajectory is-" + riskTraj.dir}>
                    <span>{riskTraj.dir === "up" ? "▲" : riskTraj.dir === "down" ? "▼" : "→"}</span>
                    <span>{riskTraj.dir === "flat" ? "flat" : `${Math.abs(riskTraj.deltaPct).toFixed(0)}%`}</span>
                  </span>
                </div>
                <div className="z-trend-tile-spark">
                  <Sparkline values={riskSeries} width={220} height={36} stroke="#FFBE07" fill="rgba(255,190,7,0.10)"
                    ariaLabel="risk score last 12 weeks" />
                </div>
              </div>
            </div>
          );
        })()}

        {/* Stat tiles */}
        <div className="z-tile-row">
          <Tile label="In-transit halts" value={totalHalts.toLocaleString()} />
          <Tile label="Distinct locations" value={distinctClusters.toLocaleString()} />
          <Tile label="Median duration" value={`${medianDur.toFixed(1)} hr`} />
          <Tile label="Night share" value={`${Math.round(nightShare * 100)}%`} />
          <Tile label="Unknown POI" value={sampleHalts > 0 ? `${Math.round(unknownShare * 100)}%` : "—"} highlight={sampleHalts > 0 && unknownShare >= 0.4} />
        </div>

        {/* Pattern read */}
        {totalHalts > 0 && (
          <div className="z-pattern">
            <strong>Pattern read.</strong>{" "}
            {nightShare >= 0.5 ? "Stops are night-dominant. " : "Stops span both day and night. "}
            {reeferShare >= 0.5 ? "Predominantly reefer vehicles, raising cold-chain exposure. " : ""}
            {sampleHalts > 0 && unknownShare >= 0.4 ? `${Math.round(unknownShare * 100)}% of sampled stops have no logistics POI within range. ` : ""}
            {distinctClusters === 1 ? "All halts occur at a single location." : distinctClusters <= 5 ? `Concentrated on ${distinctClusters} locations.` : `Spread across ${distinctClusters} locations.`}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 24, marginBottom: 24 }}>
          <div>
            <SectionLabel>Top recurring locations</SectionLabel>
            <div>
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
              {topClusters.length === 0 && <div style={{ color: "#838c9d", fontSize: 13, padding: "8px 0" }}>No location data.</div>}
            </div>

            {lens === "trip" && driverPatterns.length > 0 && (
              <>
                <SectionLabel className="mt-6">Driver patterns on this trip</SectionLabel>
                {driverPatterns.map(dp => (
                  <div key={dp.driver_number} style={{ padding: "12px 0", borderBottom: "1px solid #f0f1f7" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2330" }}>
                          {dp.driver_name || dp.rollup?.driver_name || "—"}{" "}
                          <span style={{ color: "#838c9d", fontWeight: 400 }}>({dp.driver_number})</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#838c9d", marginTop: 2 }}>
                          <span style={{ color: "#1a2330", fontWeight: 600 }}>{dp.halts_on_trip}</span> halt{dp.halts_on_trip === 1 ? "" : "s"} on this trip
                          {dp.rollup && <> · {dp.rollup.halt_count} total · {Math.round(dp.rollup.night_share * 100)}% night · {dp.rollup.median_duration_hrs.toFixed(1)} hr median</>}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                        <Badge variant="neutral">Risk {dp.rollup?.risk_score ?? "—"}</Badge>
                        <Button variant="text" size="xs" onClick={() => onJumpTo("driver", dp.driver_number)}>
                          Open driver →
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div>
            <MiniMap lat={centerLat} lng={centerLng} zoom={6} height={300} extraPoints={evidencePoints} markerColor="#FFBE07" />
            <div style={{ marginTop: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${centerLat.toFixed(6)},${centerLng.toFixed(6)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: "#1e64e6", fontWeight: 500, textDecoration: "none" }}
              >
                View on Google Maps ↗
              </a>
              <span style={{ color: "#838c9d", fontVariantNumeric: "tabular-nums" }}>
                {centerLat.toFixed(4)}, {centerLng.toFixed(4)}
              </span>
            </div>
          </div>
        </div>

        {/* Events table */}
        <SectionLabel>
          Events <span style={{ color: "#838c9d", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({events.length.toLocaleString()})</span>
        </SectionLabel>
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ overflowY: "auto", maxHeight: 320 }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead style={{ background: "#fafbfc", position: "sticky", top: 0 }}>
                <tr>
                  <th style={tableThStyle}>Trip</th>
                  <th style={tableThStyle}>Date / time</th>
                  <th style={{ ...tableThStyle, textAlign: "right" }}>Duration</th>
                  {lens !== "driver" && <th style={tableThStyle}>Driver</th>}
                  {lens !== "vehicle" && <th style={tableThStyle}>Vehicle</th>}
                  <th style={tableThStyle}>Nearest POI</th>
                  <th style={{ ...tableThStyle, textAlign: "right" }}>POI km</th>
                  <th style={{ ...tableThStyle, textAlign: "right" }}>Weight</th>
                  <th style={{ ...tableThStyle, textAlign: "right" }}>Esc</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 400).map((e, i) => (
                  <tr key={`${e.trip_id}-${i}`} style={{ borderTop: "1px solid #f0f1f7" }}>
                    <td style={tableTdStyle}>
                      {lens === "trip" || !e.trip_id ? e.trip_id : (
                        <button onClick={() => onJumpTo("trip", e.trip_id)} style={{ background: "none", border: 0, padding: 0, color: "#1e64e6", cursor: "pointer", font: "inherit" }}>
                          {e.trip_id}
                        </button>
                      )}
                    </td>
                    <td style={{ ...tableTdStyle, color: "#5f697b" }}>{e.alert_created_at}</td>
                    <td style={{ ...tableTdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(+e.long_stoppage_duration_hrs).toFixed(1)} hr</td>
                    {lens !== "driver" && <td style={tableTdStyle}>{e.driver_name}</td>}
                    {lens !== "vehicle" && <td style={tableTdStyle}>{e.vehicle_number}</td>}
                    <td style={{ ...tableTdStyle, color: "#5f697b" }}>{e.nearest_poi_name || "—"}</td>
                    <td style={{ ...tableTdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.distance_to_poi_km != null && e.distance_to_poi_km !== "" ? (+e.distance_to_poi_km).toFixed(2) : "—"}</td>
                    <td style={{ ...tableTdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.net_weight ? Math.round(+e.net_weight) : "—"}</td>
                    <td style={{ ...tableTdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.escalation_level || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {events.length > 400 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#838c9d" }}>
            Showing first 400 of {events.length} events. Export to view all.
          </div>
        )}
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

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={"z-caps " + (className || "")} style={{ color: "#5f697b", marginBottom: 12, marginTop: (className || "").includes("mt-6") ? 24 : 0 }}>
      {children}
    </div>
  );
}

const tableThStyle: React.CSSProperties = {
  textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 600,
  letterSpacing: "0.08em", textTransform: "uppercase", color: "#5f697b",
};
const tableTdStyle: React.CSSProperties = { padding: "8px 12px" };
