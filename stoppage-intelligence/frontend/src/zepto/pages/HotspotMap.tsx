import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { api } from "../api";
import type { HotspotFC, HotspotFeature, Verdict } from "../types";

const DARK_BASEMAP: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
      tileSize: 256,
      attribution: "© CARTO © OpenStreetMap",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

const TIER_COLOR: Record<string, [number, number, number, number]> = {
  critical: [255, 80, 70, 240],
  high:     [255, 190, 7, 230],   // gold
  medium:   [30, 100, 230, 220],  // blue
  low:      [120, 130, 150, 130],
};

type ReeferFilter = "all" | "reefer" | "non-reefer";
type TimeFilter = "all" | "night" | "day";
type TierFilter = "all" | "critical" | "high" | "medium";
type ViewMode = "hex" | "points";

function gmapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function classifyStoppage(poiExplained: boolean, poiType: string, riskTier: string): string {
  if (poiExplained) {
    const t = (poiType || "").toLowerCase();
    if (t === "gate" || t === "depot" || t === "warehouse") return `POI-explained · ${poiType}`;
    if (t && t !== "unknown") return `POI-explained · ${poiType}`;
    return "POI-explained";
  }
  if (riskTier === "critical") return "Shadow halt (critical)";
  if (riskTier === "high") return "Shadow halt (high)";
  return "Shadow halt";
}

interface Props { focus?: { lat: number; lng: number; zoom?: number } | null; }

export function HotspotMap({ focus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [data, setData] = useState<HotspotFC | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    lat: number;
    lng: number;
    stoppageType: string;
    props: HotspotFeature["properties"];
  } | null>(null);

  // filters
  const [reefer, setReefer] = useState<ReeferFilter>("all");
  const [time, setTime] = useState<TimeFilter>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [hideExplained, setHideExplained] = useState(true);
  const [view, setView] = useState<ViewMode>("hex");
  const [showVerdicts, setShowVerdicts] = useState(true);
  const [minHalts, setMinHalts] = useState(0);

  useEffect(() => {
    Promise.all([api.hotspots(), api.verdicts()])
      .then(([d, v]) => { setData(d); setVerdicts(v); setLoading(false); })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  // filtered features
  const features = useMemo(() => {
    if (!data) return [];
    return data.features.filter(f => {
      const p = f.properties;
      if (hideExplained && p.poi_explained) return false;
      if (tier !== "all" && p.risk_tier !== tier) return false;
      if (reefer === "reefer" && p.reefer_share < 0.5) return false;
      if (reefer === "non-reefer" && p.reefer_share >= 0.5) return false;
      if (time === "night" && p.night_share < 0.5) return false;
      if (time === "day" && p.night_share >= 0.5) return false;
      if (p.halt_count < minHalts) return false;
      return true;
    });
  }, [data, reefer, time, tier, hideExplained, minHalts]);

  // initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initial = focus
      ? { center: [focus.lng, focus.lat] as [number, number], zoom: focus.zoom ?? 11 }
      : { center: [78.2, 22.5] as [number, number], zoom: 4.4 }; // center on India
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_BASEMAP,
      ...initial,
      attributionControl: false,
    });
    map.on("load", () => {
      const overlay = new MapboxOverlay({ layers: [] });
      map.addControl(overlay as any);
      overlayRef.current = overlay;
      // trigger redraw
      setLoading(l => l);
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // pan on focus changes
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 11, duration: 1100 });
  }, [focus?.lat, focus?.lng]);

  // update layers when filters or data change
  useEffect(() => {
    if (!overlayRef.current) return;
    const layers: any[] = [];

    if (view === "hex") {
      layers.push(
        new HexagonLayer({
          id: "hex",
          data: features,
          getPosition: (f: HotspotFeature) => f.geometry.coordinates,
          getColorWeight: (f: HotspotFeature) => f.properties.halt_count,
          getElevationWeight: (f: HotspotFeature) => f.properties.halt_count * (f.properties.poi_explained ? 0.3 : 1),
          radius: 7000,
          extruded: true,
          elevationScale: 35,
          coverage: 0.88,
          opacity: 0.82,
          colorRange: [
            [30, 60, 120],
            [30, 100, 230],
            [120, 160, 240],
            [255, 220, 100],
            [255, 190, 7],
            [255, 80, 50],
          ],
          pickable: true,
          onHover: ((info: any) => {
            const obj: any = info.object;
            const rawPts: any[] = obj?.points ?? [];
            const items: HotspotFeature[] = rawPts.map(p => (p.source ?? p) as HotspotFeature);
            if (!obj || items.length === 0) {
              setTooltip(null);
              return;
            }

            let totalHalts = 0;
            let durationWeighted = 0;
            let nightWeighted = 0;
            let reeferWeighted = 0;
            let poiDistWeighted = 0;
            let explainedHalts = 0;
            let driversTotal = 0;
            let vehiclesTotal = 0;
            let transportersTotal = 0;
            const poiCounts = new Map<string, { name: string; type: string; halts: number }>();
            const tierCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };

            for (const item of items) {
              const p = item.properties;
              const h = p.halt_count || 0;
              totalHalts += h;
              durationWeighted += p.median_duration_hrs * h;
              nightWeighted += p.night_share * h;
              reeferWeighted += p.reefer_share * h;
              poiDistWeighted += p.median_poi_distance_km * h;
              if (p.poi_explained) explainedHalts += h;
              driversTotal += p.unique_drivers;
              vehiclesTotal += p.unique_vehicles;
              transportersTotal += p.unique_transporters;
              const name = p.nearest_poi_name || "Unmapped";
              const type = p.nearest_poi_type || "unknown";
              const key = `${name}|${type}`;
              const existing = poiCounts.get(key);
              if (existing) existing.halts += h;
              else poiCounts.set(key, { name, type, halts: h });
              tierCounts[p.risk_tier] = (tierCounts[p.risk_tier] || 0) + 1;
            }

            const safe = totalHalts > 0 ? totalHalts : 1;
            const avgDuration = durationWeighted / safe;
            const avgNight = nightWeighted / safe;
            const avgReefer = reeferWeighted / safe;
            const avgPoiDist = poiDistWeighted / safe;
            const explainedShare = explainedHalts / safe;

            const topPoi = [...poiCounts.values()].sort((a, b) => b.halts - a.halts)[0]
              || { name: "Mixed", type: "mixed", halts: 0 };
            const topTier = (Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "high") as
              "critical" | "high" | "medium" | "low";

            let stoppageType: string;
            if (explainedShare > 0.7) stoppageType = `POI-explained · ${topPoi.type}`;
            else if (explainedShare < 0.3) stoppageType = `Shadow halts (${topTier})`;
            else stoppageType = "Mixed (shadow + POI-explained)";

            const [hexLng, hexLat] = obj.position ?? items[0].geometry.coordinates;

            setTooltip({
              x: info.x,
              y: info.y,
              lat: hexLat,
              lng: hexLng,
              stoppageType,
              props: {
                cluster_id: "hex-aggregate",
                halt_count: totalHalts,
                unique_drivers: driversTotal,
                unique_vehicles: vehiclesTotal,
                unique_transporters: transportersTotal,
                median_duration_hrs: avgDuration,
                night_share: avgNight,
                reefer_share: avgReefer,
                median_poi_distance_km: avgPoiDist,
                nearest_poi_name: topPoi.name,
                nearest_poi_type: topPoi.type,
                poi_explained: explainedShare > 0.5,
                location_label: `Hex aggregate · ${items.length} clusters`,
                top_driver: "—",
                top_vehicle: "—",
                top_transporter: "—",
                risk_tier: topTier,
              },
            });
          }) as any,
        })
      );
    } else {
      layers.push(
        new ScatterplotLayer({
          id: "points",
          data: features,
          getPosition: (f: HotspotFeature) => f.geometry.coordinates,
          getRadius: (f: HotspotFeature) => Math.max(800, Math.sqrt(f.properties.halt_count) * 700),
          getFillColor: (f: HotspotFeature) => TIER_COLOR[f.properties.risk_tier] || TIER_COLOR.low,
          getLineColor: (f: HotspotFeature) => f.properties.poi_explained ? [255, 255, 255, 0] : [255, 255, 255, 200],
          lineWidthMinPixels: 1,
          stroked: true,
          radiusMinPixels: 3,
          radiusMaxPixels: 24,
          pickable: true,
          onHover: (info) => {
            if (!info.object) { setTooltip(null); return; }
            const f = info.object as HotspotFeature;
            const [lng, lat] = f.geometry.coordinates;
            setTooltip({
              x: info.x,
              y: info.y,
              lat,
              lng,
              stoppageType: classifyStoppage(f.properties.poi_explained, f.properties.nearest_poi_type, f.properties.risk_tier),
              props: f.properties,
            });
          },
        })
      );
    }

    if (showVerdicts && verdicts.length) {
      layers.push(
        new ScatterplotLayer({
          id: "verdict-pulses",
          data: verdicts.map(v => ({ ...v.location, score: v.risk_score, headline: v.headline })),
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 5000,
          getFillColor: [255, 190, 7, 70],
          getLineColor: [255, 190, 7, 255],
          stroked: true,
          lineWidthMinPixels: 2,
          radiusMinPixels: 6,
          radiusMaxPixels: 40,
          pickable: true,
        })
      );
    }

    overlayRef.current.setProps({ layers });
  }, [features, view, showVerdicts, verdicts]);

  return (
    <div className="zepto-map-shell">
      <div className="zepto-map-filters">
        <h3>View</h3>
        <div>
          <span className={`zepto-chip ${view === "hex" ? "active" : ""}`} onClick={() => setView("hex")}>Hex volume</span>
          <span className={`zepto-chip ${view === "points" ? "active" : ""}`} onClick={() => setView("points")}>Points</span>
        </div>

        <h3>Risk tier</h3>
        {(["all", "critical", "high", "medium"] as TierFilter[]).map(t => (
          <span key={t} className={`zepto-chip ${tier === t ? "active" : ""}`} onClick={() => setTier(t)}>
            {t === "all" ? "All" : t === "critical" ? "Critical" : t === "high" ? "High" : "Medium"}
          </span>
        ))}

        <h3>Vehicle</h3>
        {(["all", "reefer", "non-reefer"] as ReeferFilter[]).map(r => (
          <span key={r} className={`zepto-chip ${reefer === r ? "active" : ""}`} onClick={() => setReefer(r)}>
            {r === "all" ? "All" : r === "reefer" ? "Reefer" : "Non-reefer"}
          </span>
        ))}

        <h3>Time of day</h3>
        {(["all", "night", "day"] as TimeFilter[]).map(t => (
          <span key={t} className={`zepto-chip ${time === t ? "active" : ""}`} onClick={() => setTime(t)}>
            {t === "all" ? "All" : t === "night" ? "Night 22-04" : "Day"}
          </span>
        ))}

        <h3>Min halts at cluster</h3>
        <input
          type="range" min={0} max={50} step={1} value={minHalts}
          onChange={e => setMinHalts(parseInt(e.target.value))}
          style={{ width: "100%" }}
        />
        <div style={{ fontSize: 12, color: "var(--zepto-text-dim)" }}>≥ {minHalts}</div>

        <h3>Display</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={hideExplained} onChange={e => setHideExplained(e.target.checked)} />
          Hide POI-explained clusters
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6 }}>
          <input type="checkbox" checked={showVerdicts} onChange={e => setShowVerdicts(e.target.checked)} />
          Highlight priority findings
        </label>

        <div style={{ marginTop: 22, padding: 12, background: "var(--map-bg)", border: "1px solid var(--map-border)", borderRadius: "var(--radius-md)", fontSize: 12, color: "var(--map-text-dim)", lineHeight: 1.5 }}>
          Showing <strong style={{ color: "var(--map-text)" }}>{features.length.toLocaleString()}</strong> clusters.
          {loading && " Loading…"}
        </div>
      </div>

      <div className="zepto-map-area">
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {tooltip && (
          <div className="zepto-map-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13, color: "var(--map-text)" }}>{tooltip.props.location_label}</div>
            <div className="tt-label">Stoppage type</div>
            <div>{tooltip.stoppageType}</div>
            <div className="tt-label" style={{ marginTop: 6 }}>Avg duration</div>
            <div>{tooltip.props.median_duration_hrs.toFixed(1)} hr · {Math.round(tooltip.props.night_share * 100)}% night · {Math.round(tooltip.props.reefer_share * 100)}% reefer</div>
            <div className="tt-label" style={{ marginTop: 6 }}>Nearest POI</div>
            <div>{tooltip.props.nearest_poi_name || "Unmapped"} ({tooltip.props.nearest_poi_type || "—"}) · {tooltip.props.median_poi_distance_km.toFixed(2)} km</div>
            <div className="tt-label" style={{ marginTop: 6 }}>Halts</div>
            <div>{tooltip.props.halt_count.toLocaleString()} ({tooltip.props.unique_drivers} drivers · {tooltip.props.unique_vehicles} vehicles · {tooltip.props.unique_transporters} transporters)</div>
            {tooltip.props.cluster_id !== "hex-aggregate" && (
              <>
                <div className="tt-label" style={{ marginTop: 6 }}>Top entities</div>
                <div>Driver: {tooltip.props.top_driver || "—"}</div>
                <div>Vehicle: {tooltip.props.top_vehicle || "—"}</div>
                <div>Transporter: {tooltip.props.top_transporter || "—"}</div>
              </>
            )}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--map-border)" }}>
              <a
                href={gmapsUrl(tooltip.lat, tooltip.lng)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: "var(--zepto-accent, #FFBE07)", textDecoration: "none", fontWeight: 600 }}
                onClick={e => e.stopPropagation()}
              >
                View on Google Maps ↗
              </a>
              <span style={{ fontSize: 10, color: "var(--map-text-dim)", marginLeft: 8, fontVariantNumeric: "tabular-nums" }}>
                {tooltip.lat.toFixed(4)}, {tooltip.lng.toFixed(4)}
              </span>
            </div>
          </div>
        )}
        <div className="zepto-legend">
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontWeight: 600 }}>Risk tier</div>
          <div className="lg-row"><div className="lg-dot tier-critical" /> Critical</div>
          <div className="lg-row"><div className="lg-dot tier-high" /> High</div>
          <div className="lg-row"><div className="lg-dot tier-medium" /> Medium</div>
          <div className="lg-row"><div className="lg-dot tier-low" /> Low / explained</div>
        </div>
      </div>
    </div>
  );
}
