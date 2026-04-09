import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import api from "../api/client";
import { isStaticUpload, fetchStatic } from "../api/static";

interface ClusterData {
  id: number;
  coordinates: [number, number];
  event_count: number;
  distinct_trips: number;
  distinct_routes: number;
  classification: string;
  poi_name: string | null;
  poi_type: string | null;
  poi_distance_m: number | null;
  peak_hour: number | null;
  night_halt_pct: number | null;
  first_seen: string | null;
  last_seen: string | null;
  top_routes: string[];
  dispatch_branches: string[];
  route_label: string;
  branch_label: string;
}

interface ClusterDetail {
  id: number;
  centroid_lat: number;
  centroid_lon: number;
  event_count: number;
  distinct_trips: number;
  distinct_routes: number;
  classification: string;
  poi_name: string | null;
  poi_type: string | null;
  poi_distance_m: number | null;
  poi_match_radius_m: number | null;
  peak_hour: number | null;
  night_halt_pct: number | null;
  first_seen: string | null;
  last_seen: string | null;
  events: {
    id: number;
    trip_id: string;
    route_code: string;
    event_timestamp: string;
    lat: number;
    lon: number;
  }[];
}

interface Props {
  uploadId: number;
  radius: number;
  classification: string;
}

const CLASS_COLORS: Record<string, [number, number, number]> = {
  known_functional: [63, 185, 80],
  other_legit: [210, 153, 34],
  unauthorized: [248, 81, 73],
};

const DARK_BASEMAP = {
  version: 8 as const,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: "&copy; CARTO &copy; OpenStreetMap",
    },
  },
  layers: [
    {
      id: "carto-dark",
      type: "raster" as const,
      source: "carto",
    },
  ],
};

type ViewMode = "clusters" | "hexbin";

export default function MapTab({ uploadId, radius, classification }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [selected, setSelected] = useState<ClusterDetail | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("hexbin");
  const [hexRadius, setHexRadius] = useState(3000);
  const [count, setCount] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_BASEMAP,
      center: [77, 18],
      zoom: 5,
      pitch: 45,
      bearing: -15,
      maxPitch: 85,
      dragRotate: true,
      touchPitch: true,
      touchZoomRotate: true,
      pitchWithRotate: true,
    });

    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        visualizePitch: true,
      }),
      "top-left"
    );

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      style: { pointerEvents: "none" },
    });
    map.addControl(overlay as unknown as maplibregl.IControl);
    overlayRef.current = overlay;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Load cluster data
  useEffect(() => {
    const params = new URLSearchParams({
      upload_id: String(uploadId),
      radius_m: String(radius),
    });
    if (classification) params.set("classification", classification);

    const fetchClusters = isStaticUpload(uploadId) && radius === 500 && !classification
      ? fetchStatic("clusters-geojson.json")
      : api.get(`/map/clusters?${params}`).then((r) => r.data);

    fetchClusters.then((geojson: any) => {
      const features = geojson.features;
      const data: ClusterData[] = features.map((f: any) => ({
        id: f.properties.id,
        coordinates: f.geometry.coordinates as [number, number],
        event_count: f.properties.event_count,
        distinct_trips: f.properties.distinct_trips,
        distinct_routes: f.properties.distinct_routes,
        classification: f.properties.classification,
        poi_name: f.properties.poi_name,
        poi_type: f.properties.poi_type,
        poi_distance_m: f.properties.poi_distance_m,
        peak_hour: f.properties.peak_hour,
        night_halt_pct: f.properties.night_halt_pct,
        first_seen: f.properties.first_seen,
        last_seen: f.properties.last_seen,
        top_routes: f.properties.top_routes || [],
        dispatch_branches: f.properties.dispatch_branches || [],
        route_label: f.properties.route_label || "",
        branch_label: f.properties.branch_label || "",
      }));
      setClusters(data);
      setCount(data.length);

      // Fit bounds
      if (data.length > 0 && mapRef.current) {
        const bounds = new maplibregl.LngLatBounds();
        data.forEach((d) => bounds.extend(d.coordinates));
        mapRef.current.fitBounds(bounds, { padding: 80, pitch: 45, bearing: -15 });
      }
    });
  }, [uploadId, radius, classification]);

  // Handle cluster click
  const handleClick = useCallback((info: any) => {
    if (info.object) {
      const d = info.object as ClusterData;
      if (d.id) {
        api.get(`/clusters/${d.id}`).then((res) => setSelected(res.data));
      }
    }
  }, []);

  // Update deck.gl layers
  useEffect(() => {
    if (!overlayRef.current) return;

    const layers = [];

    if (viewMode === "hexbin") {
      layers.push(
        new HexagonLayer({
          id: "hexbin",
          data: clusters,
          getPosition: (d: ClusterData) => d.coordinates,
          getElevationWeight: (d: ClusterData) => d.event_count,
          getColorWeight: (d: ClusterData) => d.event_count,
          elevationScale: 100,
          extruded: true,
          radius: hexRadius,
          coverage: 0.88,
          upperPercentile: 95,
          colorRange: [
            [35, 51, 64],
            [29, 82, 79],
            [46, 137, 75],
            [110, 183, 54],
            [210, 153, 34],
            [248, 81, 73],
          ],
          elevationRange: [0, 8000],
          pickable: true,
          opacity: 0.85,
          material: {
            ambient: 0.6,
            diffuse: 0.6,
            shininess: 40,
          },
          onHover: ((info: any) => {
            if (info.object && info.x !== undefined) {
              const points: ClusterData[] = info.object.points?.map((p: any) => p.source) || [];
              const totalEvents = points.reduce((s: number, p: ClusterData) => s + p.event_count, 0);
              const clusterCount = points.length;

              const labels: string[] = [];
              const classCount: Record<string, number> = {};
              points.forEach((p: ClusterData) => {
                const cls = p.classification || "unknown";
                classCount[cls] = (classCount[cls] || 0) + p.event_count;
                if (p.poi_name && p.classification !== "unauthorized") {
                  labels.push(p.poi_name);
                }
              });

              const lines: string[] = [`${totalEvents.toLocaleString()} stoppages (${clusterCount} clusters)`];
              const uniqueLabels = [...new Set(labels)].slice(0, 3);
              if (uniqueLabels.length > 0) lines.push(uniqueLabels.join(", "));

              const parts: string[] = [];
              if (classCount.known_functional) parts.push(`${classCount.known_functional} authorized`);
              if (classCount.other_legit) parts.push(`${classCount.other_legit} legit`);
              if (classCount.unauthorized) parts.push(`${classCount.unauthorized} unauthorized`);
              if (parts.length > 0) lines.push(parts.join(" · "));

              setTooltip({ x: info.x, y: info.y, text: lines.join("\n") });
            } else {
              setTooltip(null);
            }
            return true;
          }) as any,
        })
      );

    }

    if (viewMode === "clusters") {
      // Scatterplot layer for clusters
      layers.push(
        new ScatterplotLayer({
          id: "cluster-scatter",
          data: clusters,
          getPosition: (d: ClusterData) => d.coordinates,
          getRadius: (d: ClusterData) => {
            const base = Math.sqrt(d.event_count) * 120;
            return Math.max(base, 400);
          },
          getFillColor: (d: ClusterData) => {
            const c = CLASS_COLORS[d.classification] || [139, 148, 158];
            return [...c, 200] as [number, number, number, number];
          },
          getLineColor: [255, 255, 255, 60],
          lineWidthMinPixels: 1,
          stroked: true,
          pickable: true,
          onClick: handleClick,
          onHover: ((info: any) => {
            if (info.object && info.x !== undefined) {
              const d = info.object as ClusterData;
              const label = d.classification === "unauthorized"
                ? "Unauthorized"
                : d.poi_name || d.poi_type || "Unknown";
              setTooltip({
                x: info.x, y: info.y,
                text: `${label}\n${d.event_count} stoppages · ${d.distinct_trips} trips`,
              });
            } else {
              setTooltip(null);
            }
            return true;
          }) as any,
          radiusMinPixels: 4,
          radiusMaxPixels: 60,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 80],
        })
      );

      // Text labels
      layers.push(
        new TextLayer({
          id: "cluster-labels",
          data: clusters.filter((d) => d.event_count >= 10),
          getPosition: (d: ClusterData) => d.coordinates,
          getText: (d: ClusterData) => String(d.event_count),
          getSize: (d: ClusterData) => {
            if (d.event_count > 500) return 14;
            if (d.event_count > 100) return 12;
            return 10;
          },
          getColor: [255, 255, 255, 230],
          getTextAnchor: "middle" as const,
          getAlignmentBaseline: "center" as const,
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          fontWeight: 700,
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 180],
          billboard: true,
          sizeUnits: "pixels" as const,
          pickable: false,
        })
      );
    }

    overlayRef.current.setProps({ layers });
  }, [clusters, viewMode, hexRadius, handleClick]);

  return (
    <div style={{ flex: 1, position: "relative", minHeight: 550, background: "#0a0e14" }}>
      {/* Controls overlay */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: selected ? 396 : 12,
          zIndex: 5,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          transition: "right 0.2s",
        }}
      >
        {/* View mode toggle */}
        <div
          style={{
            background: "rgba(13,17,23,0.92)",
            borderRadius: 8,
            padding: "8px 12px",
            border: "1px solid var(--border)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            View
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className={`btn ${viewMode === "clusters" ? "primary" : ""}`}
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => setViewMode("clusters")}
            >
              Clusters
            </button>
            <button
              className={`btn ${viewMode === "hexbin" ? "primary" : ""}`}
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => setViewMode("hexbin")}
            >
              Hexbin
            </button>
          </div>
          {viewMode === "hexbin" && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 4 }}>
                Hex Radius: {(hexRadius / 1000).toFixed(1)}km
              </div>
              <input
                type="range"
                min={500}
                max={10000}
                step={500}
                value={hexRadius}
                onChange={(e) => setHexRadius(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--blue)" }}
              />
            </div>
          )}
        </div>

        {/* Legend */}
        <div
          style={{
            background: "rgba(13,17,23,0.92)",
            borderRadius: 8,
            padding: "10px 12px",
            border: "1px solid var(--border)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            {count} clusters
          </div>
          {viewMode === "clusters" ? (
            Object.entries(CLASS_COLORS).map(([k, c]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: `rgb(${c.join(",")})`, display: "inline-block" }} />
                <span style={{ color: "var(--text-primary)" }}>{k.replace("_", " ")}</span>
              </div>
            ))
          ) : (
            <>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
                Height &amp; color = halt density
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Low</span>
                <div style={{
                  flex: 1, height: 8, borderRadius: 4,
                  background: "linear-gradient(90deg, rgb(35,51,64), rgb(29,82,79), rgb(46,137,75), rgb(110,183,54), rgb(210,153,34), rgb(248,81,73))",
                }} />
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>High</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)" }}>
                <span>Few stops</span>
                <span>Hotspot</span>
              </div>
            </>
          )}
          <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 6, lineHeight: 1.5 }}>
            Scroll to zoom &middot; Right-drag to tilt &middot; Two-finger rotate
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x + 12,
            top: tooltip.y - 12,
            background: "rgba(13,17,23,0.95)",
            border: "1px solid var(--border-light)",
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--text-primary)",
            whiteSpace: "pre-line",
            lineHeight: 1.5,
            pointerEvents: "none",
            zIndex: 20,
            maxWidth: 260,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Map */}
      <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 550 }} />

      {/* Cluster detail panel */}
      {selected && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 380,
            height: "100%",
            background: "rgba(22,27,34,0.97)",
            borderLeft: "1px solid var(--border)",
            overflowY: "auto",
            padding: 20,
            zIndex: 10,
            backdropFilter: "blur(12px)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>Cluster #{selected.id}</h3>
            <button className="btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setSelected(null)}>
              Close
            </button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <span className={`badge ${selected.classification}`} style={{ fontSize: 12, padding: "3px 10px" }}>
              {selected.classification?.replace("_", " ")}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Events", value: selected.event_count, color: "var(--blue)" },
              { label: "Trips", value: selected.distinct_trips, color: "var(--text-primary)" },
              { label: "Routes", value: selected.distinct_routes, color: "var(--text-primary)" },
            ].map((m) => (
              <div key={m.label} style={{ background: "var(--bg-tertiary)", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: m.color, marginTop: 2 }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Nearest POI</div>
              <div style={{ fontSize: 14, marginTop: 2 }}>
                {selected.poi_name || "No POI found within 2km"}
                {selected.poi_distance_m != null && (
                  <span style={{ color: "var(--text-secondary)", fontSize: 12, marginLeft: 6 }}>
                    {selected.poi_distance_m}m
                  </span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>POI Type</div>
              <div style={{ fontSize: 14, marginTop: 2 }}>{selected.poi_type || "N/A"}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Peak Hour</div>
                <div style={{ fontSize: 14, marginTop: 2 }}>{selected.peak_hour != null ? `${selected.peak_hour}:00` : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Night Halt %</div>
                <div style={{ fontSize: 14, marginTop: 2, color: (selected.night_halt_pct ?? 0) > 40 ? "var(--red)" : undefined }}>
                  {selected.night_halt_pct != null ? `${selected.night_halt_pct}%` : "—"}
                </div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Location</div>
              <div style={{ fontSize: 12, marginTop: 2, fontFamily: "monospace", color: "var(--text-secondary)" }}>
                {selected.centroid_lat.toFixed(5)}, {selected.centroid_lon.toFixed(5)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Active Period</div>
              <div style={{ fontSize: 12, marginTop: 2, color: "var(--text-secondary)" }}>
                {selected.first_seen?.split("T")[0]} to {selected.last_seen?.split("T")[0]}
              </div>
            </div>
          </div>

          {/* Route breakdown */}
          {selected.events.length > 0 && (() => {
            const routeCounts: Record<string, number> = {};
            selected.events.forEach((e) => {
              if (e.route_code) routeCounts[e.route_code] = (routeCounts[e.route_code] || 0) + 1;
            });
            const sorted = Object.entries(routeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
            const branchCounts: Record<string, number> = {};
            sorted.forEach(([r, c]) => {
              const branch = r.includes("-") ? r.split("-")[0] : r;
              branchCounts[branch] = (branchCounts[branch] || 0) + c;
            });
            return (
              <div style={{ marginTop: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Dispatch Branches
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {Object.entries(branchCounts).sort((a, b) => b[1] - a[1]).map(([branch, cnt]) => (
                    <span key={branch} style={{
                      background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                      borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600,
                    }}>
                      {branch} <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>({cnt})</span>
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Top Routes
                </div>
                {sorted.map(([route, cnt]) => (
                  <div key={route} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3, fontSize: 12 }}>
                    <span style={{ fontFamily: "monospace" }}>{route}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{
                        width: Math.min(cnt / sorted[0][1] * 80, 80), height: 6,
                        background: "var(--blue)", borderRadius: 3, opacity: 0.7,
                      }} />
                      <span style={{ color: "var(--text-secondary)", fontSize: 11, minWidth: 24, textAlign: "right" }}>{cnt}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {selected.events.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Recent Events ({selected.events.length})
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto", borderRadius: 6, border: "1px solid var(--border)" }}>
                <table style={{ fontSize: 11 }}>
                  <thead>
                    <tr><th>Trip</th><th>Route</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {selected.events.slice(0, 30).map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontFamily: "monospace" }}>{e.trip_id}</td>
                        <td>{e.route_code}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{e.event_timestamp?.replace("T", " ").slice(0, 16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
