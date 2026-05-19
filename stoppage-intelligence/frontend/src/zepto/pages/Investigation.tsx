import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Skeleton } from "ft-design-system";
import { api } from "../api";
import type {
  DriverRollup, VehicleRollup, TransporterRollup, RouteRollup, EventRow,
} from "../types";
import { MiniMap } from "../components/MiniMap";

type Lens = "driver" | "vehicle" | "transporter" | "route" | "trip";

interface PreselectInfo {
  driver?: string;
  vehicle?: string;
  transporter?: string;
  route?: string;
  trip?: string;
}

interface TripSummary {
  trip_id: string;
  halt_count: number;
  drivers: Set<string>;
  vehicles: Set<string>;
  transporters: Set<string>;
  first_ts?: string;
  last_ts?: string;
}

interface DrillStep { lens: Lens; key: string; label: string }

interface Props { preselect?: PreselectInfo | null }

const LENS_LABEL: Record<Lens, string> = {
  driver: "Drivers", vehicle: "Vehicles", transporter: "Transporters", route: "Routes", trip: "Trips",
};

export function Investigation({ preselect }: Props) {
  const [lens, setLens] = useState<Lens>("driver");
  const [drivers, setDrivers] = useState<DriverRollup[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRollup[]>([]);
  const [transporters, setTransporters] = useState<TransporterRollup[]>([]);
  const [routes, setRoutes] = useState<RouteRollup[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drillStack, setDrillStack] = useState<DrillStep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.drivers(), api.vehicles(), api.transporters(), api.routes(), api.events()])
      .then(([d, v, t, r, e]) => {
        setDrivers(d); setVehicles(v); setTransporters(t); setRoutes(r); setEvents(e); setLoading(false);
      })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  useEffect(() => {
    if (loading || !preselect) return;
    if (preselect.driver) { setLens("driver"); setSelectedKey(preselect.driver); }
    else if (preselect.vehicle) { setLens("vehicle"); setSelectedKey(preselect.vehicle); }
    else if (preselect.transporter) { setLens("transporter"); setSelectedKey(preselect.transporter); }
    else if (preselect.route) { setLens("route"); setSelectedKey(preselect.route); }
    else if (preselect.trip) { setLens("trip"); setSelectedKey(preselect.trip); }
  }, [loading, preselect]);

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

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (lens === "driver") {
      return drivers.filter(d => !q || d.driver_name.toLowerCase().includes(q) || d.driver_number.includes(q) || d.top_transporter.toLowerCase().includes(q)).slice(0, 250);
    }
    if (lens === "vehicle") {
      return vehicles.filter(v => !q || v.vehicle_number.toLowerCase().includes(q) || (v.top_transporter || "").toLowerCase().includes(q)).slice(0, 250);
    }
    if (lens === "transporter") {
      return transporters.filter(t => !q || t.transporter_branch.toLowerCase().includes(q)).slice(0, 200);
    }
    if (lens === "trip") {
      return trips.filter(t => !q || t.trip_id.toLowerCase().includes(q)).slice(0, 250);
    }
    return routes.filter(r => !q || r.route_key.toLowerCase().includes(q)).slice(0, 200);
  }, [lens, query, drivers, vehicles, transporters, routes, trips]);

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
    if (l === "vehicle") return key;
    if (l === "transporter") return key;
    if (l === "trip") return `Trip ${key}`;
    return key;
  };

  const jumpTo = (l: Lens, key: string, label?: string) => {
    if (lens && selectedKey) {
      setDrillStack(s => [
        ...s,
        { lens, key: selectedKey, label: labelFor(lens, selectedKey) },
      ]);
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
    setLens(l); setSelectedKey(null); setQuery("");
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1240px] px-8 py-10">
        <Skeleton className="h-9 w-72 mb-2" />
        <Skeleton className="h-5 w-96 mb-8" />
        <div className="grid grid-cols-[280px_1fr] gap-5">
          <div className="space-y-2">{[0,1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          <Skeleton className="h-[600px] w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-8 py-10">
      {/* Title block */}
      <div className="mb-6">
        <div className="text-[11px] tracking-[0.12em] font-semibold uppercase text-[#838c9d] mb-1">
          Investigation workbench
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1a2330]">
          Walk a halt back to a driver, vehicle, trip or route
        </h1>
      </div>

      {/* Drill breadcrumb */}
      {drillStack.length > 0 && (
        <div className="mb-4 flex items-center gap-1.5 text-[12.5px] text-[#5f697b]">
          {drillStack.map((s, i) => (
            <span key={`${s.lens}-${s.key}-${i}`} className="flex items-center gap-1.5">
              <button
                onClick={() => popTo(i)}
                className="hover:text-[#1a2330] hover:underline text-[#434f64]"
              >
                <span className="text-[10.5px] uppercase tracking-wider text-[#838c9d] mr-1">{s.lens}</span>
                {s.label}
              </button>
              <span className="text-[#ced1d7]">›</span>
            </span>
          ))}
          <span className="text-[#1a2330] font-medium">
            <span className="text-[10.5px] uppercase tracking-wider text-[#838c9d] mr-1">{lens}</span>
            {selectedKey ? labelFor(lens, selectedKey) : "…"}
          </span>
        </div>
      )}

      {/* Lens segmented tabs */}
      <div className="inline-flex p-1 bg-[#f0f1f7] rounded-lg mb-5">
        {(Object.keys(LENS_LABEL) as Lens[]).map(l => (
          <button
            key={l}
            onClick={() => switchLens(l)}
            className={
              "px-3.5 h-8 text-[12.5px] font-medium rounded-md transition-colors " +
              (l === lens ? "bg-white text-[#1a2330] shadow-sm" : "text-[#5f697b] hover:text-[#1a2330]")
            }
          >
            {LENS_LABEL[l]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[300px_1fr] gap-5">
        {/* Left: entity list */}
        <Card bordered className="!bg-white !p-0">
          <div className="p-3 border-b border-[#e4e7ec]">
            <Input
              placeholder={
                lens === "driver" ? "Search by name or number…"
                : lens === "vehicle" ? "Search vehicle…"
                : lens === "transporter" ? "Search transporter…"
                : lens === "trip" ? "Search trip ID…"
                : "Search route…"
              }
              value={query}
              onChange={(e: any) => setQuery(typeof e === "string" ? e : e?.target?.value ?? "")}
            />
          </div>
          <div className="overflow-auto max-h-[640px]">
            {list.length === 0 && (
              <div className="px-4 py-10 text-center text-[13px] text-[#838c9d]">No matches</div>
            )}
            {list.map((item: any) => {
              const key = lens === "driver" ? item.driver_number
                        : lens === "vehicle" ? item.vehicle_number
                        : lens === "transporter" ? item.transporter_branch
                        : lens === "trip" ? item.trip_id
                        : item.route_key;
              const primary = lens === "driver" ? `${item.driver_name}`
                            : lens === "vehicle" ? item.vehicle_number
                            : lens === "transporter" ? item.transporter_branch
                            : lens === "trip" ? `Trip ${item.trip_id}`
                            : item.route_key;
              const sub = lens === "driver" ? `${item.driver_number} · ${item.halt_count} halts`
                        : lens === "vehicle" ? `${item.halt_count} halts · ${item.vehicle_type}`
                        : lens === "transporter" ? `${item.halt_count} halts · ${item.unique_drivers} drivers`
                        : lens === "trip" ? `${item.halt_count} halts · ${item.drivers.size} drv · ${item.vehicles.size} veh`
                        : `${item.halt_count} halts · ${item.unique_drivers} drivers`;
              const score = lens === "trip" ? item.halt_count : item.risk_score;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={
                    "w-full text-left px-4 py-3 border-b border-[#f0f1f7] flex items-center justify-between gap-2 transition-colors " +
                    (key === selectedKey
                      ? "bg-[#fff8e1]"
                      : "hover:bg-[#f8f8f9]")
                  }
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[#1a2330] truncate">{primary}</div>
                    <div className="text-[11.5px] text-[#838c9d] truncate">{sub}</div>
                  </div>
                  <div className="shrink-0 text-[12px] font-semibold tabular-nums text-[#434f64] bg-[#f0f1f7] rounded-full px-2 py-0.5">
                    {score}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Right: detail */}
        <div>
          {!selectedMeta ? (
            <Card bordered className="!bg-white">
              <div className="p-16 text-center text-[14px] text-[#838c9d]">
                Select an entity from the list to investigate
              </div>
            </Card>
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
    </div>
  );
}

function Detail({ lens, meta, events, drivers, onJumpTo }: {
  lens: Lens;
  meta: any;
  events: EventRow[];
  drivers?: DriverRollup[];
  onJumpTo: (lens: Lens, key: string) => void;
}) {
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
      driver_number: num,
      driver_name: c.name,
      halts_on_trip: c.halts,
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
    <Card bordered className="!bg-white">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 mb-4">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.12em] font-semibold uppercase text-[#838c9d] mb-1">{lens}</div>
            <h2 className="text-[20px] font-semibold text-[#1a2330] truncate">{title}</h2>
            <div className="mt-2 text-[12.5px] text-[#5f697b]">
              {lens === "driver" && `Top transporter: ${meta.top_transporter || "—"} · ${meta.unique_vehicles} vehicles seen`}
              {lens === "vehicle" && `${meta.vehicle_type} · ${meta.dedicated === "Yes" ? "Dedicated" : meta.dedicated === "No" ? "Non-dedicated" : "—"} · ${meta.top_transporter || "—"}`}
              {lens === "transporter" && `${meta.unique_drivers} drivers · ${meta.unique_vehicles} vehicles`}
              {lens === "route" && `${meta.unique_drivers} drivers · ${meta.unique_vehicles} vehicles`}
              {lens === "trip" && `${meta.drivers.size} driver(s) · ${meta.vehicles.size} vehicle(s) · ${meta.transporters.size} transporter(s)${meta.first_ts ? ` · ${meta.first_ts}${meta.last_ts && meta.last_ts !== meta.first_ts ? ` → ${meta.last_ts}` : ""}` : ""}`}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[28px] font-semibold tabular-nums text-[#1a2330] leading-none">
              {lens === "trip" ? meta.halt_count : meta.risk_score}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[#838c9d] mt-1.5">
              {lens === "trip" ? "Halts on trip" : "Risk · 100"}
            </div>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-5 gap-2 mb-5">
          <Tile label="In-transit halts" value={totalHalts.toLocaleString()} />
          <Tile label="Distinct locations" value={distinctClusters.toLocaleString()} />
          <Tile label="Median duration" value={`${medianDur.toFixed(1)} hr`} />
          <Tile label="Night share" value={`${Math.round(nightShare * 100)}%`} />
          <Tile label="Unknown POI" value={sampleHalts > 0 ? `${Math.round(unknownShare * 100)}%` : "—"} highlight={sampleHalts > 0 && unknownShare >= 0.4} />
        </div>

        {/* Pattern read */}
        {totalHalts > 0 && (
          <div className="mb-5 px-4 py-3 bg-[#fff8e1] border border-[#FFBE07]/30 rounded-md text-[13px] leading-relaxed text-[#434f64]">
            <span className="font-semibold text-[#1a2330]">Pattern read.</span>{" "}
            {nightShare >= 0.5 ? "Stops are night-dominant. " : "Stops span both day and night. "}
            {reeferShare >= 0.5 ? "Predominantly reefer vehicles, raising cold-chain exposure. " : ""}
            {sampleHalts > 0 && unknownShare >= 0.4 ? `${Math.round(unknownShare * 100)}% of sampled stops have no logistics POI within range — risk profile is elevated. ` : ""}
            {distinctClusters === 1 ? "All halts occur at a single location." : distinctClusters <= 5 ? `Concentrated on ${distinctClusters} locations.` : `Spread across ${distinctClusters} locations.`}
          </div>
        )}

        <div className="grid grid-cols-[1.1fr_1fr] gap-5">
          <div>
            <SectionLabel>Top recurring locations</SectionLabel>
            {topClusters.map(([cid, c]) => (
              <div key={cid} className="flex justify-between items-start py-2.5 border-b border-[#f0f1f7] text-[13px]">
                <div className="min-w-0">
                  <div className="font-medium text-[#1a2330] truncate">
                    {c.poi === "Unnamed" ? "Unmapped roadside" : c.poi}
                  </div>
                  <div className="text-[11.5px] text-[#838c9d] mt-0.5 tabular-nums">
                    {c.lat.toFixed(4)}, {c.lng.toFixed(4)} · {c.dist.toFixed(2)} km to nearest POI
                    {" · "}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[#1e64e6] hover:underline font-semibold"
                    >
                      Maps ↗
                    </a>
                  </div>
                </div>
                <Badge variant="neutral">{c.count}× stops</Badge>
              </div>
            ))}
            {topClusters.length === 0 && <div className="text-[#838c9d] text-[13px]">No location data.</div>}

            {lens === "trip" && driverPatterns.length > 0 && (
              <>
                <SectionLabel className="mt-6">Driver patterns on this trip</SectionLabel>
                {driverPatterns.map(dp => (
                  <div key={dp.driver_number} className="py-3 border-b border-[#f0f1f7]">
                    <div className="flex justify-between gap-3 items-start">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-[#1a2330]">
                          {dp.driver_name || dp.rollup?.driver_name || "—"}{" "}
                          <span className="text-[#838c9d] font-normal">({dp.driver_number})</span>
                        </div>
                        <div className="text-[11.5px] text-[#838c9d] mt-0.5">
                          <span className="text-[#1a2330] font-semibold">{dp.halts_on_trip}</span> halt{dp.halts_on_trip === 1 ? "" : "s"} on this trip
                          {dp.rollup && (
                            <>
                              {" · "}{dp.rollup.halt_count} total halts
                              {" · "}{Math.round(dp.rollup.night_share * 100)}% night
                              {" · "}{dp.rollup.median_duration_hrs.toFixed(1)} hr median
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
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
            <div className="mt-2 text-[11.5px] flex items-center gap-2">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${centerLat.toFixed(6)},${centerLng.toFixed(6)}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[#1e64e6] font-semibold hover:underline"
              >
                View on Google Maps ↗
              </a>
              <span className="text-[#838c9d] tabular-nums">
                {centerLat.toFixed(4)}, {centerLng.toFixed(4)}
              </span>
            </div>
          </div>
        </div>

        {/* Events table */}
        <SectionLabel className="mt-7">
          Events <span className="text-[#838c9d] font-normal">({events.length.toLocaleString()})</span>
        </SectionLabel>
        <div className="border border-[#e4e7ec] rounded-md overflow-hidden">
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#f8f8f9] sticky top-0">
                <tr className="text-left text-[11px] uppercase tracking-wider text-[#5f697b]">
                  <th className="px-3 py-2 font-semibold">Trip</th>
                  <th className="px-3 py-2 font-semibold">Date / time</th>
                  <th className="px-3 py-2 font-semibold text-right">Duration</th>
                  {lens !== "driver" && <th className="px-3 py-2 font-semibold">Driver</th>}
                  {lens !== "vehicle" && <th className="px-3 py-2 font-semibold">Vehicle</th>}
                  <th className="px-3 py-2 font-semibold">Nearest POI</th>
                  <th className="px-3 py-2 font-semibold text-right">POI km</th>
                  <th className="px-3 py-2 font-semibold text-right">Weight</th>
                  <th className="px-3 py-2 font-semibold text-right">Esc</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 400).map((e, i) => (
                  <tr key={`${e.trip_id}-${i}`} className="border-t border-[#f0f1f7] hover:bg-[#f8f8f9]">
                    <td className="px-3 py-2">
                      {lens === "trip" || !e.trip_id ? e.trip_id : (
                        <button
                          onClick={() => onJumpTo("trip", e.trip_id)}
                          className="text-[#1e64e6] hover:underline"
                        >
                          {e.trip_id}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[#5f697b]">{e.alert_created_at}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(+e.long_stoppage_duration_hrs).toFixed(1)} hr</td>
                    {lens !== "driver" && <td className="px-3 py-2">{e.driver_name}</td>}
                    {lens !== "vehicle" && <td className="px-3 py-2">{e.vehicle_number}</td>}
                    <td className="px-3 py-2 text-[#5f697b]">{e.nearest_poi_name || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.distance_to_poi_km != null && e.distance_to_poi_km !== "" ? (+e.distance_to_poi_km).toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.net_weight ? Math.round(+e.net_weight) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.escalation_level || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {events.length > 400 && (
          <div className="mt-2 text-[12px] text-[#838c9d]">
            Showing first 400 of {events.length} events. Export to view all.
          </div>
        )}
      </div>
    </Card>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={
      "px-3 py-2.5 rounded-md border " +
      (highlight ? "bg-[#fff8e1] border-[#FFBE07]/40" : "bg-white border-[#e4e7ec]")
    }>
      <div className="text-[10px] tracking-wider uppercase text-[#838c9d] font-medium">{label}</div>
      <div className="text-[18px] font-semibold tabular-nums text-[#1a2330] mt-0.5">{value}</div>
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={
      "text-[11px] font-semibold uppercase tracking-[0.06em] text-[#5f697b] mb-2.5 " + (className || "")
    }>
      {children}
    </div>
  );
}
