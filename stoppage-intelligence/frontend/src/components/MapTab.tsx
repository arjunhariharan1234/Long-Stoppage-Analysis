import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import api from "../api/client";

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

const CLASS_COLORS: Record<string, string> = {
  known_functional: "#3fb950",
  other_legit: "#d29922",
  unauthorized: "#f85149",
};

export default function MapTab({ uploadId, radius, classification }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<ClusterDetail | null>(null);
  const [count, setCount] = useState(0);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [77, 18],
      zoom: 5,
    });
    map.addControl(new maplibregl.NavigationControl());
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Load data
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const params = new URLSearchParams({
      upload_id: String(uploadId),
      radius_m: String(radius),
    });
    if (classification) params.set("classification", classification);

    api.get(`/map/clusters?${params}`).then((r) => {
      const geojson = r.data;
      setCount(geojson.features.length);

      if (map.getLayer("cl-circle")) map.removeLayer("cl-circle");
      if (map.getLayer("cl-label")) map.removeLayer("cl-label");
      if (map.getSource("cl")) map.removeSource("cl");

      map.addSource("cl", { type: "geojson", data: geojson });

      map.addLayer({
        id: "cl-circle",
        type: "circle",
        source: "cl",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "event_count"],
            5, 6, 50, 12, 200, 20, 1000, 30,
          ],
          "circle-color": [
            "match", ["get", "classification"],
            "known_functional", CLASS_COLORS.known_functional,
            "other_legit", CLASS_COLORS.other_legit,
            "unauthorized", CLASS_COLORS.unauthorized,
            "#8b949e",
          ],
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 0.3,
        },
      });

      map.addLayer({
        id: "cl-label",
        type: "symbol",
        source: "cl",
        layout: {
          "text-field": ["get", "event_count"],
          "text-size": 10,
          "text-allow-overlap": false,
        },
        paint: { "text-color": "#fff" },
      });

      // Click
      map.on("click", "cl-circle", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as { id: number };
        const res = await api.get(`/clusters/${props.id}`);
        setSelected(res.data);
      });
      map.on("mouseenter", "cl-circle", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "cl-circle", () => { map.getCanvas().style.cursor = ""; });

      // Fit
      if (geojson.features.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const f of geojson.features) {
          bounds.extend(f.geometry.coordinates as [number, number]);
        }
        map.fitBounds(bounds, { padding: 60 });
      }
    });
  }, [uploadId, radius, classification]);

  return (
    <div style={{ flex: 1, position: "relative", minHeight: 550 }}>
      {/* Legend */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 5,
          background: "rgba(13,17,23,0.9)",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 12,
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{count} clusters</div>
        {Object.entries(CLASS_COLORS).map(([k, c]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "inline-block" }} />
            <span>{k.replace("_", " ")}</span>
          </div>
        ))}
      </div>

      <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 550 }} />

      {/* Detail panel */}
      {selected && (
        <div className="cluster-detail">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3>Cluster #{selected.id}</h3>
            <button className="btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setSelected(null)}>
              Close
            </button>
          </div>

          <span className={`badge ${selected.classification}`}>
            {selected.classification?.replace("_", " ")}
          </span>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
            <div className="field">
              <div className="field-label">Events</div>
              <div className="field-value">{selected.event_count}</div>
            </div>
            <div className="field">
              <div className="field-label">Trips</div>
              <div className="field-value">{selected.distinct_trips}</div>
            </div>
            <div className="field">
              <div className="field-label">Routes</div>
              <div className="field-value">{selected.distinct_routes}</div>
            </div>
            <div className="field">
              <div className="field-label">Peak Hour</div>
              <div className="field-value">{selected.peak_hour != null ? `${selected.peak_hour}:00` : "—"}</div>
            </div>
            <div className="field">
              <div className="field-label">Night Halt %</div>
              <div className="field-value" style={{ color: (selected.night_halt_pct ?? 0) > 40 ? "var(--red)" : undefined }}>
                {selected.night_halt_pct != null ? `${selected.night_halt_pct}%` : "—"}
              </div>
            </div>
            <div className="field">
              <div className="field-label">POI Distance</div>
              <div className="field-value">{selected.poi_distance_m != null ? `${selected.poi_distance_m}m` : "—"}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="field">
              <div className="field-label">Nearest POI</div>
              <div className="field-value">{selected.poi_name || "None found within 2km"}</div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <div className="field-label">POI Type</div>
              <div className="field-value">{selected.poi_type || "—"}</div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <div className="field-label">Location</div>
              <div className="field-value" style={{ fontSize: 12, fontFamily: "monospace" }}>
                {selected.centroid_lat.toFixed(5)}, {selected.centroid_lon.toFixed(5)}
              </div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <div className="field-label">Active Period</div>
              <div className="field-value" style={{ fontSize: 12 }}>
                {selected.first_seen?.split("T")[0]} to {selected.last_seen?.split("T")[0]}
              </div>
            </div>
          </div>

          {selected.events.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ marginBottom: 8 }}>Recent Events</h3>
              <div style={{ maxHeight: 250, overflowY: "auto" }}>
                <table style={{ fontSize: 11 }}>
                  <thead>
                    <tr><th>Trip</th><th>Route</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {selected.events.slice(0, 30).map((e) => (
                      <tr key={e.id}>
                        <td>{e.trip_id}</td>
                        <td>{e.route_code}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{e.event_timestamp?.replace("T", " ").slice(0, 16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
