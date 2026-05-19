import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { Badge, Card } from "ft-design-system";
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
  high:     [255, 190, 7, 230],
  medium:   [30, 100, 230, 220],
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

interface Props { focus?: { lat: number; lng: number; zoom?: number } | null }

export function HotspotMap({ focus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [data, setData] = useState<HotspotFC | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; lat: number; lng: number;
    stoppageType: string;
    props: HotspotFeature["properties"];
  } | null>(null);

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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initial = focus
      ? { center: [focus.lng, focus.lat] as [number, number], zoom: focus.zoom ?? 11 }
      : { center: [78.2, 22.5] as [number, number], zoom: 4.4 };
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_BASEMAP,
      ...initial,
      pitch: 45, bearing: -15,
      maxPitch: 75, dragRotate: true,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("load", () => {
      const overlay = new MapboxOverlay({ layers: [] });
      map.addControl(overlay as any);
      overlayRef.current = overlay;
      setLoading(l => l);
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 11, duration: 1100 });
  }, [focus?.lat, focus?.lng]);

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
            if (!obj || items.length === 0) { setTooltip(null); return; }

            let totalHalts = 0, durationW = 0, nightW = 0, reeferW = 0, poiDistW = 0, explained = 0;
            let drivers = 0, vehicles = 0, transporters = 0;
            const poiCounts = new Map<string, { name: string; type: string; halts: number }>();
            const tierCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };

            for (const item of items) {
              const p = item.properties;
              const h = p.halt_count || 0;
              totalHalts += h;
              durationW += p.median_duration_hrs * h;
              nightW += p.night_share * h;
              reeferW += p.reefer_share * h;
              poiDistW += p.median_poi_distance_km * h;
              if (p.poi_explained) explained += h;
              drivers += p.unique_drivers;
              vehicles += p.unique_vehicles;
              transporters += p.unique_transporters;
              const name = p.nearest_poi_name || "Unmapped";
              const type = p.nearest_poi_type || "unknown";
              const key = `${name}|${type}`;
              const ex = poiCounts.get(key);
              if (ex) ex.halts += h;
              else poiCounts.set(key, { name, type, halts: h });
              tierCounts[p.risk_tier] = (tierCounts[p.risk_tier] || 0) + 1;
            }

            const safe = totalHalts > 0 ? totalHalts : 1;
            const explainedShare = explained / safe;
            const topPoi = [...poiCounts.values()].sort((a, b) => b.halts - a.halts)[0] || { name: "Mixed", type: "mixed", halts: 0 };
            const topTier = (Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "high") as "critical" | "high" | "medium" | "low";

            const stoppageType = explainedShare > 0.7 ? `POI-explained · ${topPoi.type}`
                              : explainedShare < 0.3 ? `Shadow halts (${topTier})`
                              : "Mixed (shadow + POI-explained)";

            const [hexLng, hexLat] = obj.position ?? items[0].geometry.coordinates;
            setTooltip({
              x: info.x, y: info.y, lat: hexLat, lng: hexLng, stoppageType,
              props: {
                cluster_id: "hex-aggregate",
                halt_count: totalHalts,
                unique_drivers: drivers,
                unique_vehicles: vehicles,
                unique_transporters: transporters,
                median_duration_hrs: durationW / safe,
                night_share: nightW / safe,
                reefer_share: reeferW / safe,
                median_poi_distance_km: poiDistW / safe,
                nearest_poi_name: topPoi.name,
                nearest_poi_type: topPoi.type,
                poi_explained: explainedShare > 0.5,
                location_label: `Hex aggregate · ${items.length} clusters`,
                top_driver: "—", top_vehicle: "—", top_transporter: "—",
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
          lineWidthMinPixels: 1, stroked: true,
          radiusMinPixels: 3, radiusMaxPixels: 24,
          pickable: true,
          onHover: (info) => {
            if (!info.object) { setTooltip(null); return; }
            const f = info.object as HotspotFeature;
            const [lng, lat] = f.geometry.coordinates;
            setTooltip({
              x: info.x, y: info.y, lat, lng,
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
    <div className="grid grid-cols-[280px_1fr] gap-0 h-[calc(100vh-3.5rem-3.25rem)] min-h-[600px]">
      {/* Filter rail */}
      <div className="border-r border-[#e4e7ec] bg-white overflow-y-auto">
        <div className="p-5 space-y-5">
          <div>
            <FilterLabel>View</FilterLabel>
            <Segmented
              options={[{ k: "hex", label: "Hex volume" }, { k: "points", label: "Points" }]}
              value={view}
              onChange={(v) => setView(v as ViewMode)}
            />
          </div>

          <div>
            <FilterLabel>Risk tier</FilterLabel>
            <ChipGroup
              options={[
                { k: "all", label: "All" },
                { k: "critical", label: "Critical" },
                { k: "high", label: "High" },
                { k: "medium", label: "Medium" },
              ]}
              value={tier}
              onChange={(v) => setTier(v as TierFilter)}
            />
          </div>

          <div>
            <FilterLabel>Vehicle</FilterLabel>
            <ChipGroup
              options={[
                { k: "all", label: "All" },
                { k: "reefer", label: "Reefer" },
                { k: "non-reefer", label: "Non-reefer" },
              ]}
              value={reefer}
              onChange={(v) => setReefer(v as ReeferFilter)}
            />
          </div>

          <div>
            <FilterLabel>Time of day</FilterLabel>
            <ChipGroup
              options={[
                { k: "all", label: "All" },
                { k: "night", label: "Night 22-04" },
                { k: "day", label: "Day" },
              ]}
              value={time}
              onChange={(v) => setTime(v as TimeFilter)}
            />
          </div>

          <div>
            <FilterLabel>Min halts at cluster</FilterLabel>
            <input
              type="range" min={0} max={50} step={1} value={minHalts}
              onChange={e => setMinHalts(parseInt(e.target.value))}
              className="w-full accent-[#FFBE07]"
            />
            <div className="text-[11.5px] text-[#838c9d] tabular-nums">≥ {minHalts}</div>
          </div>

          <div className="space-y-2.5">
            <FilterLabel>Display</FilterLabel>
            <label className="flex items-center gap-2 text-[12.5px] text-[#434f64]">
              <input
                type="checkbox" checked={hideExplained}
                onChange={e => setHideExplained(e.target.checked)}
                className="rounded accent-[#1a2330]"
              />
              Hide POI-explained clusters
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-[#434f64]">
              <input
                type="checkbox" checked={showVerdicts}
                onChange={e => setShowVerdicts(e.target.checked)}
                className="rounded accent-[#1a2330]"
              />
              Highlight priority findings
            </label>
          </div>

          <Card bordered className="!bg-[#f8f9fb]">
            <div className="px-3 py-2.5 text-[12px] text-[#5f697b] leading-relaxed">
              Showing <span className="font-semibold text-[#1a2330] tabular-nums">{features.length.toLocaleString()}</span> clusters
              {loading && " · loading…"}.
            </div>
          </Card>
        </div>
      </div>

      {/* Map area */}
      <div className="relative bg-[#0a0d14]">
        <div ref={containerRef} className="absolute inset-0" />

        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none bg-[#0f1117]/95 text-white rounded-md p-3 max-w-[320px] border border-[#22252f] shadow-xl text-[12px] leading-relaxed"
            style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
          >
            <div className="font-semibold mb-1 text-[13px]">{tooltip.props.location_label}</div>
            <TT label="Stoppage type">{tooltip.stoppageType}</TT>
            <TT label="Avg duration">
              {tooltip.props.median_duration_hrs.toFixed(1)} hr · {Math.round(tooltip.props.night_share * 100)}% night · {Math.round(tooltip.props.reefer_share * 100)}% reefer
            </TT>
            <TT label="Nearest POI">
              {tooltip.props.nearest_poi_name || "Unmapped"} ({tooltip.props.nearest_poi_type || "—"}) · {tooltip.props.median_poi_distance_km.toFixed(2)} km
            </TT>
            <TT label="Halts">
              {tooltip.props.halt_count.toLocaleString()} ({tooltip.props.unique_drivers} drv · {tooltip.props.unique_vehicles} veh · {tooltip.props.unique_transporters} txp)
            </TT>
            {tooltip.props.cluster_id !== "hex-aggregate" && (
              <TT label="Top entities">
                Driver: {tooltip.props.top_driver || "—"}<br />
                Vehicle: {tooltip.props.top_vehicle || "—"}<br />
                Transporter: {tooltip.props.top_transporter || "—"}
              </TT>
            )}
            <div className="mt-2 pt-2 border-t border-[#22252f]">
              <a
                href={gmapsUrl(tooltip.lat, tooltip.lng)}
                target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-[#FFBE07] hover:underline font-semibold"
                onClick={e => e.stopPropagation()}
              >
                View on Google Maps ↗
              </a>
              <span className="text-[10px] text-[#6b7280] ml-2 tabular-nums">
                {tooltip.lat.toFixed(4)}, {tooltip.lng.toFixed(4)}
              </span>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-[#0f1117]/90 border border-[#22252f] rounded-md p-3 text-[11px] text-white">
          <div className="font-semibold text-[10px] uppercase tracking-wider text-[#9ca3af] mb-2">Risk tier</div>
          <Lg color="#FF5046" label="Critical" />
          <Lg color="#FFBE07" label="High" />
          <Lg color="#1E64E6" label="Medium" />
          <Lg color="#787f95" label="Low / explained" />
        </div>

        {/* Top-right context badge */}
        <div className="absolute top-4 left-4">
          <Badge variant="info">{features.length.toLocaleString()} clusters visible</Badge>
        </div>
      </div>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#838c9d] mb-2">{children}</div>;
}

function Segmented({ options, value, onChange }: {
  options: { k: string; label: string }[]; value: string; onChange: (k: string) => void;
}) {
  return (
    <div className="inline-flex p-0.5 bg-[#f0f1f7] rounded-md w-full">
      {options.map(o => (
        <button
          key={o.k}
          onClick={() => onChange(o.k)}
          className={
            "flex-1 px-2 h-7 text-[12px] font-medium rounded transition-colors " +
            (o.k === value ? "bg-white text-[#1a2330] shadow-sm" : "text-[#5f697b] hover:text-[#1a2330]")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChipGroup({ options, value, onChange }: {
  options: { k: string; label: string }[]; value: string; onChange: (k: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.k}
          onClick={() => onChange(o.k)}
          className={
            "px-2.5 h-6 text-[11.5px] font-medium rounded-full border transition-colors " +
            (o.k === value
              ? "bg-[#1a2330] text-white border-[#1a2330]"
              : "bg-white text-[#5f697b] border-[#e4e7ec] hover:border-[#ced1d7]")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TT({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5 first:mt-0">
      <div className="text-[9.5px] uppercase tracking-wider text-[#9ca3af]">{label}</div>
      <div className="text-white">{children}</div>
    </div>
  );
}

function Lg({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 leading-snug">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
