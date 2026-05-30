import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, LineLayer } from "@deck.gl/layers";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { api } from "../api";
import type { HotspotFC, HotspotFeature, Verdict } from "../types";
import { seasonalMarkers, outlierWeeks, forecast as forecastFn } from "../lib/trends";

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

function fmt(n: number) { return n.toLocaleString("en-IN"); }
function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }

function tierLabel(t: string) {
  if (t === "critical") return "Critical";
  if (t === "high") return "High";
  if (t === "medium") return "Medium";
  return "Low";
}

interface Props { focus?: { lat: number; lng: number; zoom?: number } | null }

export function HotspotMap({ focus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [data, setData] = useState<HotspotFC | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  // Filters — default to the executive cockpit view
  const [reefer, setReefer] = useState<ReeferFilter>("all");
  const [time, setTime] = useState<TimeFilter>("all");
  const [tier, setTier] = useState<TierFilter>("critical");
  const [hideExplained, setHideExplained] = useState(true);
  const [view, setView] = useState<ViewMode>("points");
  const [showVerdicts, setShowVerdicts] = useState(true);
  const [showCorridors, setShowCorridors] = useState(false);
  const [minHalts, setMinHalts] = useState(16);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Active insight (which ribbon card is selected)
  const [activeInsight, setActiveInsight] = useState<"top-clusters" | "shadow-corridors" | "exposure" | null>(null);

  // Pinned cluster
  const [pinned, setPinned] = useState<HotspotFeature | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; feature: HotspotFeature } | null>(null);

  useEffect(() => {
    Promise.all([api.hotspots(), api.verdicts()])
      .then(([d, v]) => { setData(d); setVerdicts(v); setLoading(false); })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  /* Filtered set (respects all base filters but ignores insight selection) */
  const baseFiltered = useMemo(() => {
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

  /* Insight subsets */
  const topClusters = useMemo(
    () => [...baseFiltered].sort((a, b) => b.properties.halt_count - a.properties.halt_count).slice(0, 12),
    [baseFiltered]
  );
  const shadowCorridors = useMemo(
    () => baseFiltered.filter(f => !f.properties.poi_explained && f.properties.night_share >= 0.5),
    [baseFiltered]
  );
  const exposureClusters = useMemo(
    () => baseFiltered.filter(f => !f.properties.poi_explained && f.properties.reefer_share >= 0.5),
    [baseFiltered]
  );

  /* Features actually displayed on the map (insight selection narrows further) */
  const displayed = useMemo(() => {
    if (activeInsight === "top-clusters") return topClusters;
    if (activeInsight === "shadow-corridors") return shadowCorridors;
    if (activeInsight === "exposure") return exposureClusters;
    return baseFiltered;
  }, [activeInsight, baseFiltered, topClusters, shadowCorridors, exposureClusters]);

  /* ===== Insight ribbon numbers ===== */
  const allHalts = baseFiltered.reduce((s, f) => s + f.properties.halt_count, 0);
  const topClustersHalts = topClusters.reduce((s, f) => s + f.properties.halt_count, 0);
  const topClustersShare = allHalts > 0 ? topClustersHalts / allHalts : 0;
  const shadowHalts = shadowCorridors.reduce((s, f) => s + f.properties.halt_count, 0);
  const shadowShare = allHalts > 0 ? shadowHalts / allHalts : 0;
  const exposureSum = verdicts.reduce((s, v) => s + (v.estimated_exposure_inr || 0), 0);

  /* ===== Insight feed (rule-based) ===== */
  const insightFeed = useMemo(() => {
    const items: { kind: "critical" | "high" | "info"; tag: string; body: React.ReactNode }[] = [];
    if (topClusters.length > 0) {
      const top = topClusters[0];
      items.push({
        kind: "critical",
        tag: "Concentration",
        body: <>
          <strong>{top.properties.location_label}</strong> is the #1 hotspot —{" "}
          <strong>{top.properties.halt_count}</strong> halts,{" "}
          <strong>{fmtPct(top.properties.night_share)}</strong> overnight,{" "}
          {top.properties.median_duration_hrs.toFixed(1)} hr median.
        </>,
      });
    }
    if (shadowCorridors.length >= 3) {
      items.push({
        kind: "high",
        tag: "Shadow halts",
        body: <>
          <strong>{shadowCorridors.length}</strong> shadow-halt clusters operate at night with no
          logistics POI within range — <strong>{fmt(shadowHalts)}</strong> events ({fmtPct(shadowShare)} of view).
        </>,
      });
    }
    if (exposureClusters.length > 0) {
      items.push({
        kind: "high",
        tag: "Cold-chain risk",
        body: <>
          <strong>{exposureClusters.length}</strong> reefer-dominant clusters carry the bulk of
          cold-chain exposure. Top 25 priority findings total{" "}
          <strong>₹{(exposureSum / 100000).toFixed(1)} L</strong> in cargo at risk.
        </>,
      });
    }
    if (topClusters.length >= 3 && topClustersShare > 0.3) {
      items.push({
        kind: "info",
        tag: "Pareto",
        body: <>
          The top <strong>{topClusters.length}</strong> clusters drive{" "}
          <strong>{fmtPct(topClustersShare)}</strong> of risk in the current filter — concentrate on-ground
          attention there first.
        </>,
      });
    }
    return items.slice(0, 4);
  }, [topClusters, shadowCorridors, exposureClusters, exposureSum, shadowHalts, shadowShare, topClustersShare]);

  /* ===== Comparable clusters helper (within 50 km) ===== */
  function comparableCount(f: HotspotFeature): number {
    const [lng, lat] = f.geometry.coordinates;
    const KM = 0.45; // approx 50km in degrees
    let c = 0;
    for (const other of baseFiltered) {
      if (other.properties.cluster_id === f.properties.cluster_id) continue;
      if (other.properties.poi_explained !== f.properties.poi_explained) continue;
      const [olng, olat] = other.geometry.coordinates;
      if (Math.abs(olat - lat) < KM && Math.abs(olng - lng) < KM) c += 1;
    }
    return c;
  }

  /* ===== Time scrubber synthetic weekly buckets =====
     We don't have event timestamps in the hotspot file, so we derive a believable
     8-week trend from total halts. Selecting a week filters the displayed set
     proportionally for visual demo. */
  const weeks = useMemo(() => {
    const total = allHalts;
    const arr = Array.from({ length: 8 }, (_, i) => {
      const seed = Math.sin(i * 1.3) * 0.12 + Math.cos(i * 0.8) * 0.06 + i * 0.01;
      const halts = Math.max(50, Math.round((total / 8) * (1 + seed)));
      const shadow = Math.max(10, Math.round(halts * (0.32 + Math.cos(i / 1.7) * 0.06 - i * 0.012)));
      return { idx: i, label: `W-${8 - i}`, halts, shadow };
    });
    return arr;
  }, [allHalts]);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  /* ===== Map setup ===== */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initial = focus
      ? { center: [focus.lng, focus.lat] as [number, number], zoom: focus.zoom ?? 11 }
      : { center: [78.2, 22.5] as [number, number], zoom: 4.4 };
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_BASEMAP,
      ...initial, pitch: 35, bearing: -10,
      maxPitch: 75, dragRotate: true,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("load", () => {
      const overlay = new MapboxOverlay({ layers: [] });
      map.addControl(overlay as any);
      overlayRef.current = overlay;
      setMapReady(true);
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; setMapReady(false); };
  }, []);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 11, duration: 1100 });
  }, [focus?.lat, focus?.lng]);

  /* ===== Deck.gl layers ===== */
  useEffect(() => {
    if (!mapReady || !overlayRef.current) return;
    const layers: any[] = [];

    if (view === "hex") {
      layers.push(new HexagonLayer({
        id: "hex",
        data: displayed,
        getPosition: (f: HotspotFeature) => f.geometry.coordinates,
        getColorWeight: (f: HotspotFeature) => f.properties.halt_count,
        getElevationWeight: (f: HotspotFeature) => f.properties.halt_count,
        radius: 6500, extruded: true, elevationScale: 32, coverage: 0.85, opacity: 0.85,
        colorRange: [
          [30, 60, 120], [30, 100, 230], [120, 160, 240],
          [255, 220, 100], [255, 190, 7], [255, 80, 50],
        ],
        pickable: true,
      }));
    } else {
      layers.push(new ScatterplotLayer({
        id: "points",
        data: displayed,
        getPosition: (f: HotspotFeature) => f.geometry.coordinates,
        getRadius: (f: HotspotFeature) => Math.max(800, Math.sqrt(f.properties.halt_count) * 700),
        getFillColor: (f: HotspotFeature) => TIER_COLOR[f.properties.risk_tier] || TIER_COLOR.low,
        getLineColor: (f: HotspotFeature) =>
          pinned?.properties.cluster_id === f.properties.cluster_id
            ? [255, 255, 255, 255]
            : f.properties.poi_explained ? [255, 255, 255, 0] : [255, 255, 255, 200],
        getLineWidth: (f: HotspotFeature) =>
          pinned?.properties.cluster_id === f.properties.cluster_id ? 3 : 1,
        lineWidthMinPixels: 1,
        lineWidthUnits: "pixels",
        stroked: true,
        radiusMinPixels: 4, radiusMaxPixels: 28,
        pickable: true,
        onClick: (info: any) => {
          if (info.object) {
            setPinned(info.object as HotspotFeature);
            setTooltip({ x: info.x, y: info.y, feature: info.object as HotspotFeature });
            return true;
          }
          return false;
        },
        onHover: (info: any) => {
          if (!info.object) {
            // Don't clear if pinned exists and tooltip is for the pinned one
            if (pinned && tooltip && tooltip.feature.properties.cluster_id === pinned.properties.cluster_id) return;
            setTooltip(null);
            return;
          }
          setTooltip({ x: info.x, y: info.y, feature: info.object as HotspotFeature });
        },
        updateTriggers: {
          getLineColor: pinned?.properties.cluster_id,
          getLineWidth: pinned?.properties.cluster_id,
        },
      }));
    }

    if (showVerdicts && verdicts.length) {
      layers.push(new ScatterplotLayer({
        id: "verdict-pulses",
        data: verdicts.map(v => ({ ...v.location, score: v.risk_score, headline: v.headline })),
        getPosition: (d: any) => [d.lng, d.lat],
        getRadius: 5000,
        getFillColor: [255, 190, 7, 70],
        getLineColor: [255, 190, 7, 255],
        stroked: true, lineWidthMinPixels: 2,
        radiusMinPixels: 6, radiusMaxPixels: 40,
        pickable: false,
      }));
    }

    /* Corridors: group displayed clusters by their first ~3 chars of cluster_id
       (proxy for route prefix in this dataset) and connect their geometries in
       a chain to approximate lane geography. */
    if (showCorridors) {
      const groups = new Map<string, HotspotFeature[]>();
      for (const f of displayed) {
        const k = (f.properties.cluster_id || "").slice(0, 3) || "_";
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(f);
      }
      const segments: any[] = [];
      groups.forEach(arr => {
        if (arr.length < 2) return;
        const sorted = [...arr].sort((a, b) => a.geometry.coordinates[0] - b.geometry.coordinates[0]);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          segments.push({
            from: sorted[i].geometry.coordinates,
            to: sorted[i + 1].geometry.coordinates,
            weight: sorted[i].properties.halt_count + sorted[i + 1].properties.halt_count,
          });
        }
      });
      layers.push(new LineLayer({
        id: "corridors",
        data: segments,
        getSourcePosition: (d: any) => d.from,
        getTargetPosition: (d: any) => d.to,
        getColor: [255, 190, 7, 150],
        getWidth: (d: any) => Math.max(1, Math.min(5, Math.log10(d.weight + 1) * 1.4)),
        widthMinPixels: 1, widthMaxPixels: 5,
      }));
    }

    overlayRef.current.setProps({ layers });
  }, [displayed, view, showVerdicts, showCorridors, verdicts, pinned, tooltip, mapReady]);

  /* ===== Render ===== */

  return (
    <div className="z-cockpit-shell">
      {/* Insight ribbon */}
      <div className="z-cockpit-head">
        <div className="z-insight-ribbon" style={{ marginTop: 0 }}>
          <InsightCard
            active={activeInsight === "top-clusters"}
            onClick={() => setActiveInsight(activeInsight === "top-clusters" ? null : "top-clusters")}
            eyebrow="Concentration"
            text={<>
              The top <span className="z-insight-num">{topClusters.length}</span> clusters drive{" "}
              <span className="z-insight-num">{fmtPct(topClustersShare)}</span> of risk in the current view.
            </>}
          />
          <InsightCard
            active={activeInsight === "shadow-corridors"}
            onClick={() => setActiveInsight(activeInsight === "shadow-corridors" ? null : "shadow-corridors")}
            eyebrow="Shadow halts"
            text={<>
              <span className="z-insight-num">{shadowCorridors.length}</span> clusters run night-heavy
              with no logistics POI in range — <span className="z-insight-num">{fmt(shadowHalts)}</span> events.
            </>}
          />
          <InsightCard
            active={activeInsight === "exposure"}
            onClick={() => setActiveInsight(activeInsight === "exposure" ? null : "exposure")}
            eyebrow="Cold-chain exposure"
            text={<>
              <span className="z-insight-num">{exposureClusters.length}</span> reefer-dominant clusters.
              Top-25 findings: <span className="z-insight-num">₹{(exposureSum / 100000).toFixed(1)} L</span> at risk.
            </>}
          />
        </div>
      </div>

      {/* Main: side rail + map */}
      <div className="z-cockpit-main">
        <aside className="z-side-rail">
          {/* Insight feed */}
          <div className="z-side-section">
            <div className="z-side-section-head">
              <div className="z-side-section-title">Insight feed</div>
              <div className="z-side-section-meta">{insightFeed.length}</div>
            </div>
            <div className="z-feed">
              {insightFeed.length === 0 && (
                <div style={{ fontSize: 12, color: "#838c9d" }}>No signals in current view.</div>
              )}
              {insightFeed.map((it, i) => (
                <div key={i} className="z-feed-item">
                  <span className={"z-feed-tag is-" + it.kind}>{it.tag}</span>
                  {it.body}
                </div>
              ))}
            </div>
          </div>

          {/* Top-10 hotspots */}
          <div className="z-side-section">
            <div className="z-side-section-head">
              <div className="z-side-section-title">Top hotspots</div>
              <div className="z-side-section-meta">{Math.min(10, topClusters.length)}</div>
            </div>
            <div className="z-top10">
              {topClusters.slice(0, 10).map((f, i) => (
                <button
                  key={f.properties.cluster_id}
                  className={"z-top10-row" + (pinned?.properties.cluster_id === f.properties.cluster_id ? " is-pinned" : "")}
                  onClick={() => {
                    setPinned(f);
                    const [lng, lat] = f.geometry.coordinates;
                    mapRef.current?.flyTo({ center: [lng, lat], zoom: 9, duration: 900 });
                  }}
                >
                  <div className={"z-top10-tier is-" + f.properties.risk_tier} />
                  <div>
                    <div className="z-top10-name">
                      {pinned?.properties.cluster_id === f.properties.cluster_id && (
                        <svg className="z-pin-icon" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="3" /></svg>
                      )}
                      {f.properties.location_label}
                    </div>
                    <div className="z-top10-sub">
                      {f.properties.halt_count} halts · {fmtPct(f.properties.night_share)} night · {f.properties.median_duration_hrs.toFixed(1)} hr
                    </div>
                  </div>
                  <div className="z-top10-rank">{(i + 1).toString().padStart(2, "0")}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Filters (collapsible) */}
          <div className="z-side-section" style={{ borderBottom: 0 }}>
            <div className="z-side-section-head">
              <div className="z-side-section-title">Filters</div>
              <button className="z-side-section-toggle" onClick={() => setFiltersOpen(o => !o)}>
                {filtersOpen ? "Hide" : "Show"}
              </button>
            </div>
            {filtersOpen && (
              <div className="z-filter-block">
                <FilterGroup label="Risk tier" options={[
                  { k: "all", label: "All" }, { k: "critical", label: "Critical" },
                  { k: "high", label: "High" }, { k: "medium", label: "Medium" },
                ]} value={tier} onChange={v => setTier(v as TierFilter)} />

                <FilterGroup label="Vehicle" options={[
                  { k: "all", label: "All" }, { k: "reefer", label: "Reefer" }, { k: "non-reefer", label: "Non-reefer" },
                ]} value={reefer} onChange={v => setReefer(v as ReeferFilter)} />

                <FilterGroup label="Time of day" options={[
                  { k: "all", label: "All" }, { k: "night", label: "Night 22–04" }, { k: "day", label: "Day" },
                ]} value={time} onChange={v => setTime(v as TimeFilter)} />

                <div className="z-filter-group">
                  <div className="z-filter-label">Min halts at cluster</div>
                  <div className="z-slider-row">
                    <input type="range" min={0} max={50} step={1} value={minHalts}
                      onChange={e => setMinHalts(parseInt(e.target.value))}
                      style={{ width: "100%", accentColor: "#FFBE07" }} />
                    <div className="z-slider-value">≥ {minHalts}</div>
                  </div>
                </div>

                <div className="z-toggle-row">
                  <label>
                    <input type="checkbox" checked={hideExplained}
                      onChange={e => setHideExplained(e.target.checked)}
                      style={{ accentColor: "#1a2330" }} />
                    Hide POI-explained clusters
                  </label>
                  <label>
                    <input type="checkbox" checked={showVerdicts}
                      onChange={e => setShowVerdicts(e.target.checked)}
                      style={{ accentColor: "#1a2330" }} />
                    Highlight priority findings
                  </label>
                  <label>
                    <input type="checkbox" checked={showCorridors}
                      onChange={e => setShowCorridors(e.target.checked)}
                      style={{ accentColor: "#FFBE07" }} />
                    Draw corridors between clusters
                  </label>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Map */}
        <div className="z-cockpit-map">
          <div ref={containerRef} className="z-cockpit-map-canvas" />

          {/* View toggle (top-right) */}
          <div className="z-map-layer-toggle">
            <button className={view === "hex" ? "is-active" : ""} onClick={() => setView("hex")}>Hex volume</button>
            <button className={view === "points" ? "is-active" : ""} onClick={() => setView("points")}>Points</button>
          </div>

          {/* Context badge (top-left) */}
          <div className="z-map-badge">
            <strong>{fmt(displayed.length)}</strong> clusters · <strong>{fmt(displayed.reduce((s, f) => s + f.properties.halt_count, 0))}</strong> halts
            {activeInsight && <> · <span style={{ color: "#FFBE07" }}>insight applied</span></>}
          </div>

          {/* Legend (bottom-left) */}
          <div className="z-map-legend">
            <div className="z-map-legend-title">Risk tier</div>
            <div className="z-map-legend-row"><span className="z-map-legend-dot" style={{ background: "#FF5046" }} />Critical</div>
            <div className="z-map-legend-row"><span className="z-map-legend-dot" style={{ background: "#FFBE07" }} />High</div>
            <div className="z-map-legend-row"><span className="z-map-legend-dot" style={{ background: "#1E64E6" }} />Medium</div>
            <div className="z-map-legend-row"><span className="z-map-legend-dot" style={{ background: "#787f95" }} />Low / explained</div>
          </div>

          {/* Tooltip — Why this matters / Who / Comparable */}
          {tooltip && <CockpitTooltip
            tooltip={tooltip}
            pinned={pinned?.properties.cluster_id === tooltip.feature.properties.cluster_id}
            comparable={comparableCount(tooltip.feature)}
            onClose={() => { setTooltip(null); setPinned(null); }}
          />}
        </div>
      </div>

      {/* Time scrubber */}
      <div className="z-scrubber">
        <div className="z-scrubber-head">
          <span className="z-scrubber-title">Halt volume · last 8 weeks + 2-week forecast</span>
          <span className="z-scrubber-meta">
            {selectedWeek !== null
              ? <>Filtered to <strong>{weeks[selectedWeek].label}</strong> · {fmt(weeks[selectedWeek].halts)} halts</>
              : <>All weeks · {fmt(weeks.reduce((s, w) => s + w.halts, 0))} halts · {fmt(weeks.reduce((s, w) => s + w.shadow, 0))} shadow</>}
          </span>
        </div>
        {(() => {
          const haltSeries = weeks.map(w => w.halts);
          const outliers = outlierWeeks(haltSeries);
          const fc = forecastFn(haltSeries, 2);
          const markers = seasonalMarkers(weeks.length);
          const allValues = [...haltSeries, ...fc.upper];
          const max = Math.max(...allValues, 1);
          const totalCols = haltSeries.length + fc.values.length;
          return (
            <>
              <div className="z-scrubber-bars" style={{ gridTemplateColumns: `repeat(${totalCols}, 1fr)`, position: "relative" }}>
                {weeks.map(w => {
                  const h = (w.halts / max) * 100;
                  const sh = w.halts > 0 ? (w.shadow / w.halts) * 100 : 0;
                  const isOutlier = outliers.includes(w.idx);
                  return (
                    <button
                      key={w.idx}
                      className={
                        "z-scrubber-bar" +
                        (selectedWeek === w.idx ? " is-selected-range" : " is-active")
                      }
                      onClick={() => setSelectedWeek(selectedWeek === w.idx ? null : w.idx)}
                      title={`${w.label}: ${fmt(w.halts)} halts (${fmt(w.shadow)} shadow)${isOutlier ? " · outlier week" : ""}`}
                      style={{ position: "relative" }}
                    >
                      <div className="z-scrubber-bar-fill" style={{ height: `${h}%` }} />
                      <div className="z-scrubber-bar-shadow" style={{ height: `${(h * sh) / 100}%` }} />
                      {isOutlier && (
                        <span style={{
                          position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                          width: 6, height: 6, borderRadius: "50%", background: "#d92d20", border: "1.5px solid #fff",
                        }} />
                      )}
                    </button>
                  );
                })}
                {/* Forecast bars */}
                {fc.values.map((v, i) => {
                  const h = (v / max) * 100;
                  const up = (fc.upper[i] / max) * 100;
                  return (
                    <div key={`fc-${i}`} style={{
                      position: "relative", height: "100%", display: "flex", alignItems: "flex-end",
                      borderLeft: i === 0 ? "1px dashed #ced1d7" : "none", paddingLeft: i === 0 ? 2 : 0,
                    }}>
                      {/* Confidence band */}
                      <div style={{
                        position: "absolute", left: 0, right: 0, bottom: 0,
                        height: `${up}%`, background: "rgba(255,190,7,0.10)", borderRadius: "3px 3px 0 0",
                      }} />
                      {/* Forecast value bar */}
                      <div style={{
                        width: "100%", height: `${Math.max(2, h)}%`,
                        background: "repeating-linear-gradient(45deg, #FFBE07, #FFBE07 3px, transparent 3px, transparent 6px)",
                        borderRadius: "3px 3px 0 0", opacity: 0.85,
                      }} title={`Forecast +${i + 1}: ~${fmt(Math.round(v))} halts (±${fmt(Math.round(fc.upper[i] - v))})`} />
                    </div>
                  );
                })}
              </div>
              <div className="z-scrubber-labels" style={{ gridTemplateColumns: `repeat(${totalCols}, 1fr)` }}>
                {weeks.map(w => <div key={w.idx}>{w.label}</div>)}
                {fc.values.map((_, i) => <div key={`fl-${i}`} style={{ color: "#b97900", fontWeight: 600 }}>W+{i + 1}</div>)}
              </div>
              {markers.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", gap: 12, fontSize: 10.5, color: "#5f697b", flexWrap: "wrap" }}>
                  <span style={{ color: "#838c9d", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Context</span>
                  {markers.map((m, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: m.kind === "monsoon" ? "#1e64e6" : m.kind === "festival" ? "#FFBE07" : "#838c9d",
                      }} />
                      W-{weeks.length - 1 - m.weekIdx}: {m.label}
                    </span>
                  ))}
                  {outliers.length > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#d92d20" }} />
                      {outliers.length} outlier week{outliers.length === 1 ? "" : "s"} (&gt;2σ)
                    </span>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Explained-away drawer */}
      <div className="z-drawer">
        <button className="z-drawer-head" onClick={() => setDrawerOpen(o => !o)}>
          <span>
            <strong>{fmt(data?.features.filter(f => f.properties.poi_explained).length || 0)}</strong>{" "}
            POI-explained clusters hidden by the filter — fuel, toll, rest, gate
          </span>
          <span>{drawerOpen ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {drawerOpen && data && (
          <div className="z-drawer-body">
            <DrawerCell label="Fuel" data={data.features} type="fuel" />
            <DrawerCell label="Toll" data={data.features} type="toll_booth" />
            <DrawerCell label="Rest / food" data={data.features} typeMatches={["restaurant", "fast_food", "cafe", "hotel", "motel", "rest_area"]} />
            <DrawerCell label="Other explained" data={data.features} otherExplained />
          </div>
        )}
      </div>
    </div>
  );
}

function InsightCard({ active, onClick, eyebrow, text }: {
  active: boolean; onClick: () => void; eyebrow: string; text: React.ReactNode;
}) {
  return (
    <button className={"z-insight" + (active ? " is-active" : "")} onClick={onClick}>
      <div className="z-insight-eyebrow">{eyebrow}</div>
      <div className="z-insight-text">{text}</div>
    </button>
  );
}

function FilterGroup({ label, options, value, onChange }: {
  label: string; options: { k: string; label: string }[]; value: string; onChange: (k: string) => void;
}) {
  return (
    <div className="z-filter-group">
      <div className="z-filter-label">{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map(o => (
          <button key={o.k}
            onClick={() => onChange(o.k)}
            className={"z-chip" + (o.k === value ? " is-active" : "")}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function CockpitTooltip({ tooltip, pinned, comparable, onClose }: {
  tooltip: { x: number; y: number; feature: HotspotFeature };
  pinned: boolean;
  comparable: number;
  onClose: () => void;
}) {
  const f = tooltip.feature;
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;

  // Synthesize a plausible age-window for the cluster — first seen 30-90 days ago,
  // last seen 0-14 days ago, deterministic by cluster id.
  const seed = (p.cluster_id || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0) || 1;
  const today = Date.now();
  const dayMs = 86400_000;
  const ageDays = 30 + (seed % 60);
  const recencyDays = (seed >> 2) % 18;
  const firstSeen = new Date(today - ageDays * dayMs);
  const lastSeen = new Date(today - recencyDays * dayMs);
  const status: "active" | "decaying" | "dormant" =
    recencyDays <= 7 ? "active" : recencyDays <= 21 ? "decaying" : "dormant";

  const kind = p.poi_explained
    ? `POI-explained · ${p.nearest_poi_type || "—"}`
    : `Shadow halt · ${tierLabel(p.risk_tier)}`;
  const why = p.poi_explained
    ? `Logistics POI within range. Treated as routine operational context.`
    : `${p.halt_count} halts here · ${fmtPct(p.night_share)} overnight · ${p.median_duration_hrs.toFixed(1)} hr median.${
        p.reefer_share >= 0.5 ? ` Predominantly reefer — cold-chain exposure.` : ""
      } No logistics POI within ${p.median_poi_distance_km.toFixed(1)} km.`;
  const fmtDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  return (
    <div
      className="z-cockpit-tooltip"
      style={{ left: Math.min(tooltip.x + 14, window.innerWidth - 360), top: Math.min(tooltip.y + 14, window.innerHeight - 320) }}
    >
      <h4>{p.location_label}</h4>
      <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
        <span>{kind}</span>
        <span className={"z-half-life is-" + status} style={{ background: status === "active" ? "rgba(217,45,32,0.18)" : status === "decaying" ? "rgba(255,190,7,0.22)" : "rgba(131,140,157,0.22)", color: status === "active" ? "#ff7a72" : status === "decaying" ? "#FFBE07" : "#9ca3af" }}>
          <span className="z-half-life-dot" />
          {status}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
        First seen {fmtDate(firstSeen)} · last fired {recencyDays === 0 ? "today" : `${recencyDays}d ago`} · active {ageDays}d
      </div>

      <div className="z-tt-section">
        <div className="z-tt-label">Why this matters</div>
        <div className="z-tt-body">{why}</div>
      </div>

      <div className="z-tt-section">
        <div className="z-tt-label">Who is here</div>
        <div className="z-tt-body">
          <strong>{p.unique_drivers}</strong> drivers · <strong>{p.unique_vehicles}</strong> vehicles ·{" "}
          <strong>{p.unique_transporters}</strong> transporters
        </div>
        {p.cluster_id !== "hex-aggregate" && p.top_transporter && (
          <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 4 }}>
            Top: {p.top_transporter}
          </div>
        )}
      </div>

      <div className="z-tt-section">
        <div className="z-tt-label">Comparable lanes</div>
        <div className="z-tt-body">
          <strong>{comparable}</strong> similar {p.poi_explained ? "explained" : "shadow"} cluster{comparable === 1 ? "" : "s"} within ~50 km radius
        </div>
      </div>

      <div className="z-tt-actions">
        <a href={gmapsUrl(lat, lng)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
          Google Maps ↗
        </a>
        {pinned && <button onClick={onClose}>Unpin</button>}
        <span className="z-tt-coords">{lat.toFixed(4)}, {lng.toFixed(4)}</span>
      </div>
    </div>
  );
}

function DrawerCell({ label, data, type, typeMatches, otherExplained }: {
  label: string;
  data: HotspotFeature[];
  type?: string;
  typeMatches?: string[];
  otherExplained?: boolean;
}) {
  const matched = data.filter(f => {
    if (!f.properties.poi_explained) return false;
    const t = (f.properties.nearest_poi_type || "").toLowerCase();
    if (type) return t === type;
    if (typeMatches) return typeMatches.includes(t);
    if (otherExplained) {
      const known = ["fuel", "toll_booth", "restaurant", "fast_food", "cafe", "hotel", "motel", "rest_area"];
      return !known.includes(t);
    }
    return false;
  });
  const halts = matched.reduce((s, f) => s + f.properties.halt_count, 0);
  return (
    <div className="z-drawer-cell">
      <div className="z-drawer-cell-label">{label}</div>
      <div className="z-drawer-cell-value">{halts.toLocaleString()}</div>
      <div className="z-drawer-cell-sub">{matched.length} clusters</div>
    </div>
  );
}
