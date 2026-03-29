import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import api from "../api/client";

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

    api.get(`/map/clusters?${params}`).then((r) => {
      const features = r.data.features;
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
            View Mode
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
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              Height &amp; color = stoppage density
            </div>
          )}
          <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 6, lineHeight: 1.5 }}>
            Scroll to zoom<br />
            Right-drag to tilt &amp; orbit<br />
            Two-finger rotate to pitch
          </div>
        </div>
      </div>

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
                {selected.poi_name || "None found within 2km"}
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
