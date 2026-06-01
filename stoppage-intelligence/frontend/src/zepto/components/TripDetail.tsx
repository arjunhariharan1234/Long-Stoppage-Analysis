import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ColumnLayer, TextLayer } from "@deck.gl/layers";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { api } from "../api";
import type {
  TripRow, TripHalt, EventRow, HotspotFC,
  DriverRollup, VehicleRollup, TransporterRollup, RouteRollup,
} from "../types";
import { HaltDetailCard } from "./HaltDetailCard";
import { EntityPatternOverlay, type EntityFocus } from "./EntityPatternOverlay";

const LIGHT_BASEMAP: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
      tileSize: 256,
      attribution: "© CARTO © OpenStreetMap",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

interface Props {
  trip: TripRow;
  onBack: () => void;
  aliasLocation: (s: string) => string;
  /** Optional synthetic events (from brain halt clusters etc.) merged into
   * the events sample so the entity drill panels still populate when the
   * primary events JSON doesn't cover a brain-only entity. */
  extraEvents?: EventRow[];
}

type LayerKey = "planned" | "halts" | "hexbin" | "pitch";

interface RouteCache { path: [number, number][]; isOsrm: boolean }
const routeCache = new Map<string, RouteCache>();

async function fetchRoute(o: [number, number], d: [number, number]): Promise<RouteCache> {
  const key = `${o[0].toFixed(4)},${o[1].toFixed(4)}_${d[0].toFixed(4)},${d[1].toFixed(4)}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${o[0]},${o[1]};${d[0]},${d[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const coords = data.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined;
      if (coords && coords.length > 1) {
        const out = { path: coords, isOsrm: true };
        routeCache.set(key, out);
        return out;
      }
    }
  } catch { /* fall through */ }
  const fallback = { path: [o, d], isOsrm: false };
  routeCache.set(key, fallback);
  return fallback;
}

function severityFor(level: number) {
  if (level >= 3) return { label: "Critical", cls: "is-critical" };
  if (level === 2) return { label: "High", cls: "is-high" };
  if (level === 1) return { label: "Watch", cls: "is-watch" };
  return { label: "Informational", cls: "" };
}

// Color a halt based on its severity profile (used both for the hex column fill
// and the small ground anchor under each pin)
function haltColor(h: TripHalt): [number, number, number, number] {
  const isUnmapped = h.distance_to_poi_km == null || h.distance_to_poi_km > 1.0 || h.poi_type === "No POI within 2km";
  if (isUnmapped) return [197, 39, 39, 240];
  if (h.escalation >= 3) return [197, 39, 39, 240];
  if (h.escalation >= 2) return [194, 65, 12, 240];
  return [180, 138, 0, 240];
}

// Elevation in meters proportional to halt duration — extruded so it pops
// off the surface even at moderate pitch
function haltElevation(durationHrs: number): number {
  const base = 600;
  return base + Math.min(durationHrs, 24) * 700;
}

export function TripDetail({ trip, onBack, aliasLocation, extraEvents }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    planned: true, halts: true, hexbin: false, pitch: true,
  });
  const [activeHalt, setActiveHalt] = useState<number | null>(null);
  const [haltCardPos, setHaltCardPos] = useState<{ x: number; y: number } | null>(null);
  const [entityFocus, setEntityFocus] = useState<EntityFocus | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);

  // Data needed for halt + entity context
  const [drivers, setDrivers] = useState<DriverRollup[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRollup[]>([]);
  const [transporters, setTransporters] = useState<TransporterRollup[]>([]);
  const [routes, setRoutes] = useState<RouteRollup[]>([]);
  const [hotspots, setHotspots] = useState<HotspotFC | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.drivers(), api.vehicles(), api.transporters(), api.routes(), api.hotspots(), api.events()])
      .then(([d, v, t, r, h, e]) => {
        if (cancelled) return;
        setDrivers(d); setVehicles(v); setTransporters(t); setRoutes(r); setHotspots(h);
        setEvents(extraEvents && extraEvents.length ? [...e, ...extraEvents] : e);
      })
      .catch(err => console.error("trip-detail data load failed", err));
    return () => { cancelled = true; };
  }, [extraEvents]);

  const halts: TripHalt[] = trip.halts || [];
  const validHalts = useMemo(() => halts.filter(h => h.lat != null && h.lng != null), [halts]);
  const severity = severityFor(trip.max_escalation);
  const headlineHalt = useMemo(() => {
    if (validHalts.length === 0) return null;
    return [...validHalts].sort((a, b) => b.duration_hrs - a.duration_hrs)[0];
  }, [validHalts]);

  const isUnmapped = (h: TripHalt) =>
    h.distance_to_poi_km == null || h.distance_to_poi_km > 1.0 || h.poi_type === "No POI within 2km";

  const hasGeo = trip.origin_lat != null && trip.origin_lng != null && trip.destination_lat != null && trip.destination_lng != null;

  // Fetch the planned route once per trip
  useEffect(() => {
    if (!hasGeo) return;
    let cancelled = false;
    fetchRoute([trip.origin_lng!, trip.origin_lat!], [trip.destination_lng!, trip.destination_lat!])
      .then(r => { if (!cancelled) setRoutePath(r.path); });
    return () => { cancelled = true; };
  }, [trip.trip_id, hasGeo]);

  // Initialize the map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !hasGeo) return;
    const lng = (trip.origin_lng! + trip.destination_lng!) / 2;
    const lat = (trip.origin_lat! + trip.destination_lat!) / 2;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: LIGHT_BASEMAP,
      center: [lng, lat],
      zoom: 6,
      pitch: 45,
      bearing: -15,
      maxPitch: 75,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: true,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");

    map.on("load", () => {
      // Protruded origin billboard — anchored at bottom-of-stem so the stem
      // grows up from the lat/lng point in pitched view
      const originEl = document.createElement("div");
      originEl.className = "z-td-pin z-td-pin-origin";
      originEl.innerHTML = `
        <div class="z-td-pin-card">
          <div class="z-td-pin-label">ORIGIN</div>
          <div class="z-td-pin-name">${escapeHtml(aliasLocation(trip.origin)).toUpperCase()}</div>
        </div>
        <div class="z-td-pin-stem"></div>
        <div class="z-td-pin-foot"></div>
      `;
      const om = new maplibregl.Marker({ element: originEl, anchor: "bottom" })
        .setLngLat([trip.origin_lng!, trip.origin_lat!])
        .addTo(map);

      const destEl = document.createElement("div");
      destEl.className = "z-td-pin z-td-pin-dest";
      destEl.innerHTML = `
        <div class="z-td-pin-card">
          <div class="z-td-pin-label">DESTINATION</div>
          <div class="z-td-pin-name">${escapeHtml(aliasLocation(trip.destination)).toUpperCase()}</div>
        </div>
        <div class="z-td-pin-stem"></div>
        <div class="z-td-pin-foot"></div>
      `;
      const dm = new maplibregl.Marker({ element: destEl, anchor: "bottom" })
        .setLngLat([trip.destination_lng!, trip.destination_lat!])
        .addTo(map);

      markerRefs.current = [om, dm];

      const overlay = new MapboxOverlay({ layers: [] });
      map.addControl(overlay as any);
      overlayRef.current = overlay;

      const bounds = new maplibregl.LngLatBounds(
        [trip.origin_lng!, trip.origin_lat!],
        [trip.origin_lng!, trip.origin_lat!],
      );
      bounds.extend([trip.destination_lng!, trip.destination_lat!]);
      validHalts.forEach(h => bounds.extend([h.lng!, h.lat!]));
      map.fitBounds(bounds, { padding: { top: 120, right: 120, bottom: 140, left: 120 }, duration: 0 });
    });

    mapRef.current = map;
    return () => {
      markerRefs.current.forEach(m => m.remove());
      markerRefs.current = [];
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [trip.trip_id]);

  // Pitch toggle
  useEffect(() => {
    if (!mapRef.current) return;
    const m = mapRef.current;
    if (layers.pitch && m.getPitch() < 30) m.easeTo({ pitch: 50, bearing: -20, duration: 600 });
    if (!layers.pitch && m.getPitch() > 5) m.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }, [layers.pitch]);

  // Rebuild overlay layers
  useEffect(() => {
    if (!overlayRef.current) return;
    const overlayLayers: any[] = [];

    if (layers.hexbin && events.length > 0) {
      overlayLayers.push(new HexagonLayer({
        id: "duration-hex",
        data: events,
        getPosition: (d: any) => [d.alert_lng, d.alert_lat],
        getElevationWeight: (d: any) => +d.long_stoppage_duration_hrs || 0,
        getColorWeight: (d: any) => +d.long_stoppage_duration_hrs || 0,
        elevationAggregation: "SUM",
        colorAggregation: "SUM",
        radius: 4000,
        coverage: 0.85,
        elevationScale: layers.pitch ? 40 : 0,
        extruded: layers.pitch,
        pickable: false,
        opacity: 0.5,
        colorRange: [
          [255, 237, 160, 80],
          [254, 217, 118, 140],
          [254, 178, 76, 180],
          [253, 141, 60, 210],
          [240, 89, 41, 230],
          [189, 0, 38, 240],
        ],
      }));
    }

    if (layers.planned && routePath && routePath.length > 1) {
      overlayLayers.push(new PathLayer({
        id: "route",
        data: [{ path: routePath }],
        getPath: (d: any) => d.path,
        getColor: [30, 100, 230, 230],
        getWidth: 4,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
      }));
    }

    if (layers.halts && validHalts.length > 0) {
      // Hexagonal column per halt — extruded by duration, picked individually
      overlayLayers.push(new ColumnLayer({
        id: "halt-columns",
        data: validHalts.map((h, i) => ({ ...h, idx: i })),
        diskResolution: 6, // hexagon
        radius: 800,
        radiusUnits: "meters",
        extruded: true,
        elevationScale: layers.pitch ? 1 : 0.05,
        getPosition: (d: any) => [d.lng, d.lat],
        getElevation: (d: any) => haltElevation(d.duration_hrs),
        getFillColor: (d: any) => haltColor(d),
        getLineColor: [255, 255, 255, 255],
        lineWidthUnits: "pixels",
        getLineWidth: 1.2,
        stroked: true,
        pickable: true,
        material: { ambient: 0.55, diffuse: 0.7, shininess: 32 },
        onClick: (info: any) => {
          if (info && info.object) setActiveHalt(info.object.idx);
        },
      }));
      // Number label above each column
      overlayLayers.push(new TextLayer({
        id: "halt-column-labels",
        data: validHalts.map((h, i) => ({ ...h, idx: i, label: String(i + 1) })),
        getPosition: (d: any) => [d.lng, d.lat],
        getText: (d: any) => d.label,
        getSize: 14,
        getColor: [255, 255, 255, 255],
        sizeUnits: "pixels",
        fontWeight: 700,
        getTextAnchor: "middle" as const,
        getAlignmentBaseline: "center" as const,
        billboard: true,
        getPixelOffset: [0, -10],
      }));
    }

    overlayRef.current.setProps({ layers: overlayLayers });
  }, [layers, routePath, validHalts, events]);

  // Pan + zoom to halt when card is clicked
  useEffect(() => {
    if (activeHalt == null || !mapRef.current) return;
    const h = validHalts[activeHalt];
    if (!h || h.lat == null || h.lng == null) return;
    const cur = mapRef.current.getZoom();
    mapRef.current.flyTo({ center: [h.lng, h.lat], zoom: Math.max(cur, 12), duration: 800 });
  }, [activeHalt, validHalts]);

  // Keep the halt-detail card anchored over the clicked halt on the map.
  // Project lat/lng → screen coords; recompute on every map move so the
  // card follows when the user pans / zooms / pitches.
  useEffect(() => {
    if (activeHalt == null || !mapRef.current) {
      setHaltCardPos(null);
      return;
    }
    const h = validHalts[activeHalt];
    if (!h || h.lat == null || h.lng == null) {
      setHaltCardPos(null);
      return;
    }
    const map = mapRef.current;
    const update = () => {
      const p = map.project([h.lng!, h.lat!]);
      setHaltCardPos({ x: p.x, y: p.y });
    };
    update();
    map.on("move", update);
    map.on("zoom", update);
    map.on("pitch", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
      map.off("pitch", update);
    };
  }, [activeHalt, validHalts]);

  function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  }
  function fmtTs(ts: string) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  const googleMapsTripUrl = hasGeo
    ? `https://www.google.com/maps/dir/?api=1&origin=${trip.origin_lat},${trip.origin_lng}&destination=${trip.destination_lat},${trip.destination_lng}&travelmode=driving`
    : "#";

  const focusedHalt = activeHalt != null ? validHalts[activeHalt] : null;

  return (
    <div className="z-trip-detail">
      <aside className="z-td-sidebar">
        <button onClick={onBack} className="z-td-back">
          <span className="z-td-back-arrow">←</span>
          <span className="z-td-back-id">{trip.trip_id}</span>
          <span className={"z-td-sev " + severity.cls}>{severity.label}</span>
        </button>

        {headlineHalt && (
          <div className={"z-td-alert " + severity.cls}>
            <div className="z-td-alert-tag">
              {isUnmapped(headlineHalt) ? "UNMAPPED HALT DETECTED" : "LONG STOPPAGE DETECTED"}
            </div>
            <div className="z-td-alert-text">
              {isUnmapped(headlineHalt)
                ? `Vehicle halted ${headlineHalt.duration_hrs.toFixed(1)} hr at an unmapped location, ${(headlineHalt.distance_to_poi_km ?? 0) > 0 ? `${(headlineHalt.distance_to_poi_km ?? 0).toFixed(1)} km` : ">2 km"} from any logistics POI. Investigate for pilferage or unauthorised drop.`
                : `Vehicle stopped ${headlineHalt.duration_hrs.toFixed(1)} hr near ${(headlineHalt.poi_type || "unknown POI").replace(/_/g, " ")}. Cross-check against schedule.`}
            </div>
          </div>
        )}

        <div className="z-td-section-label">Trip</div>
        <div className="z-td-meta">
          {trip.vehicle_number && (
            <button className="z-td-meta-row is-clickable" onClick={() => setEntityFocus({ kind: "vehicle", key: trip.vehicle_number })}>
              <div className="z-td-meta-label">Vehicle</div>
              <div className="z-td-meta-value">{trip.vehicle_number}<span className="z-td-meta-chev">›</span></div>
              <div className="z-td-meta-sub" title={trip.vehicle_type}>{trip.vehicle_type || "—"}{trip.is_reefer ? " · reefer" : ""}</div>
            </button>
          )}
          {trip.driver_number && (
            <button className="z-td-meta-row is-clickable" onClick={() => setEntityFocus({ kind: "driver", key: trip.driver_number })}>
              <div className="z-td-meta-label">Driver</div>
              <div className="z-td-meta-value">{trip.driver_name || trip.driver_number}<span className="z-td-meta-chev">›</span></div>
              <div className="z-td-meta-sub">{trip.driver_number}</div>
            </button>
          )}
          {trip.transporter_branch && (
            <button className="z-td-meta-row is-clickable" onClick={() => setEntityFocus({ kind: "transporter", key: trip.transporter_branch })}>
              <div className="z-td-meta-label">Transporter</div>
              <div className="z-td-meta-value">{trip.transporter_branch}<span className="z-td-meta-chev">›</span></div>
              <div className="z-td-meta-sub">{trip.zone || "—"} · {trip.inbound_or_outbound || "—"}</div>
            </button>
          )}
          <div className="z-td-meta-row">
            <div className="z-td-meta-label">Origin</div>
            <div className="z-td-meta-value">{aliasLocation(trip.origin) || "—"}</div>
            <div className="z-td-meta-sub" title={trip.origin}>{trip.origin}</div>
          </div>
          <div className="z-td-meta-row">
            <div className="z-td-meta-label">Destination</div>
            <div className="z-td-meta-value">{aliasLocation(trip.destination) || "—"}</div>
            <div className="z-td-meta-sub" title={trip.destination}>{trip.destination}</div>
          </div>
        </div>

        <div className="z-td-evidence">
          <div className="z-td-evidence-cell">
            <div className="z-td-evidence-value">{trip.halt_count}</div>
            <div className="z-td-evidence-label">Halts</div>
            <div className="z-td-evidence-sub">long stoppages</div>
          </div>
          <div className="z-td-evidence-cell">
            <div className="z-td-evidence-value">{trip.max_stoppage_hrs.toFixed(1)} hr</div>
            <div className="z-td-evidence-label">Max halt</div>
            <div className="z-td-evidence-sub">single stoppage</div>
          </div>
          <div className="z-td-evidence-cell">
            <div className="z-td-evidence-value">{trip.total_stoppage_hrs.toFixed(1)} hr</div>
            <div className="z-td-evidence-label">Total halt</div>
            <div className="z-td-evidence-sub">sum of stoppages</div>
          </div>
          <div className="z-td-evidence-cell">
            <div className="z-td-evidence-value">{trip.unmapped_halts}</div>
            <div className="z-td-evidence-label">Unmapped</div>
            <div className="z-td-evidence-sub">&gt; 1 km from POI</div>
          </div>
        </div>

        <div className="z-td-section-label">Distances</div>
        <div className="z-td-distance">
          <div>
            <span className="z-td-distance-label">Planned</span>
            <span className="z-td-distance-value">{trip.total_planned_distance ? `${Math.round(trip.total_planned_distance)} km` : "—"}</span>
          </div>
          <div>
            <span className="z-td-distance-label">Actual</span>
            <span className="z-td-distance-value">{trip.total_transit_distance ? `${Math.round(trip.total_transit_distance)} km` : "—"}</span>
          </div>
          {trip.total_planned_distance && trip.total_transit_distance && (
            <div>
              <span className="z-td-distance-label">Overrun</span>
              <span className={"z-td-distance-value " + (trip.total_transit_distance - trip.total_planned_distance > 50 ? "is-bad" : "")}>
                {(trip.total_transit_distance - trip.total_planned_distance > 0 ? "+" : "") + Math.round(trip.total_transit_distance - trip.total_planned_distance) + " km"}
              </span>
            </div>
          )}
        </div>

        <div className="z-td-section-label">Stoppages ({validHalts.length})</div>
        <div className="z-td-halts">
          {validHalts.length === 0 && (
            <div className="z-td-halt-empty">No stoppage detail available for this trip.</div>
          )}
          {validHalts.map((h, i) => {
            const unmapped = isUnmapped(h);
            const dur = h.duration_hrs;
            return (
              <button
                key={i}
                onClick={() => setActiveHalt(i)}
                className={"z-td-halt-card-mini" + (activeHalt === i ? " is-active" : "") + (unmapped ? " is-unmapped" : "")}
              >
                <div className="z-td-halt-mini-head">
                  <span className={"z-td-halt-num" + (unmapped ? "" : h.escalation >= 2 ? " is-warning" : " is-watch")}>{i + 1}</span>
                  <span className="z-td-halt-loc">
                    {unmapped ? "Unmapped roadside" : (h.poi_name && h.poi_name !== "Unnamed" ? h.poi_name : (h.poi_type || "Halt")).replace(/_/g, " ")}
                  </span>
                  <span className={"z-td-halt-dur" + (dur >= 8 ? " is-critical" : dur >= 4 ? " is-high" : "")}>
                    {dur.toFixed(1)} hr
                  </span>
                </div>
                <div className="z-td-halt-meta">
                  <span>{fmtTs(h.ts)}{h.is_night ? " · night" : ""}</span>
                  {h.cluster_halt_count > 1 && (
                    <>
                      <span>·</span>
                      <span style={{ color: "#c2410c", fontWeight: 500 }}>{h.cluster_halt_count - 1} repeat halts</span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="z-td-map-col">
        <div className="z-td-map-bar">
          <div className="z-td-layer-toggles">
            <button className={"z-td-layer" + (layers.planned ? " is-on" : "")} onClick={() => setLayers(l => ({ ...l, planned: !l.planned }))}>
              <span className="z-td-layer-dot" style={{ background: "#1e64e6" }} />
              Planned route
            </button>
            <button className={"z-td-layer" + (layers.halts ? " is-on" : "")} onClick={() => setLayers(l => ({ ...l, halts: !l.halts }))}>
              <span className="z-td-layer-dot" style={{ background: "#c52727" }} />
              Halt columns
            </button>
            <button className={"z-td-layer" + (layers.hexbin ? " is-on" : "")} onClick={() => setLayers(l => ({ ...l, hexbin: !l.hexbin }))}>
              <span className="z-td-layer-dot" style={{ background: "#fd8d3c" }} />
              Network heatmap
            </button>
            <button className={"z-td-layer" + (layers.pitch ? " is-on" : "")} onClick={() => setLayers(l => ({ ...l, pitch: !l.pitch }))}>
              <span className="z-td-layer-dot" style={{ background: "#1a2330" }} />
              3D pitch
            </button>
          </div>
          <div className="z-td-map-actions">
            <a href={googleMapsTripUrl} target="_blank" rel="noopener noreferrer" className="z-td-map-action">
              Open trip in Google Maps ↗
            </a>
          </div>
        </div>
        {!hasGeo ? (
          <div className="z-td-map-fallback">Trip coordinates are missing — cannot render the route.</div>
        ) : (
          <>
            <div ref={containerRef} className="z-td-map" />
            {focusedHalt && (
              <div
                className="z-halt-card-anchor"
                style={haltCardPos ? {
                  position: "absolute",
                  // Anchor the bottom of the card just above the halt point,
                  // with a small offset and centred horizontally.
                  left: Math.max(8, Math.min(haltCardPos.x - 180, /* card half-width */
                    (containerRef.current?.clientWidth ?? 1200) - 368)),
                  top: Math.max(8, haltCardPos.y - 16 - 240 /* approx card height */),
                  zIndex: 5,
                  pointerEvents: "auto",
                } : { display: "none" }}
              >
                <HaltDetailCard
                  halt={focusedHalt}
                  haltIndex={activeHalt!}
                  tripId={trip.trip_id}
                  hotspots={hotspots}
                  events={events}
                  onClose={() => setActiveHalt(null)}
                  onEntityClick={(focus) => setEntityFocus(focus)}
                />
              </div>
            )}
          </>
        )}
      </section>

      {entityFocus && (
        <EntityPatternOverlay
          focus={entityFocus}
          drivers={drivers}
          vehicles={vehicles}
          transporters={transporters}
          routes={routes}
          hotspots={hotspots}
          events={events}
          onClose={() => setEntityFocus(null)}
          onEntityClick={(f) => setEntityFocus(f)}
          aliasLocation={aliasLocation}
        />
      )}
    </div>
  );
}
