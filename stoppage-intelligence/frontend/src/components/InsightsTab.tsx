import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import api from "../api/client";
import { isStaticUpload, fetchStatic } from "../api/static";

const PIE_COLORS = ["#3fb950", "#d29922", "#f85149"];

interface TopCluster {
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
  peak_hour: number | null;
  night_halt_pct: number | null;
}

interface Props {
  uploadId: number;
  radius: number;
}

export default function InsightsTab({ uploadId, radius }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ event_classification: Record<string, number> } | null>(null);
  const [hourly, setHourly] = useState<{ hour: number; count: number }[]>([]);
  const [poiBreakdown, setPoiBreakdown] = useState<{ poi_type: string; total_events: number }[]>([]);
  const [topRoutes, setTopRoutes] = useState<{ route_code: string; event_count: number; trip_count: number }[]>([]);
  const [topClusters, setTopClusters] = useState<TopCluster[]>([]);
  const [unauthorized, setUnauthorized] = useState<TopCluster[]>([]);
  const [selectedMapCluster, setSelectedMapCluster] = useState<TopCluster | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    if (isStaticUpload(uploadId) && radius === 500) {
      // Load from pre-computed static JSON (instant)
      Promise.all([
        fetchStatic("summary.json"),
        fetchStatic("hourly.json"),
        fetchStatic("poi-breakdown.json"),
        fetchStatic("route-breakdown.json"),
        fetchStatic("top-clusters-all.json"),
        fetchStatic("top-clusters-unauthorized.json"),
      ])
        .then(([sumData, hourData, poiData, routeData, topData, unData]) => {
          setSummary(sumData);
          setHourly(hourData.distribution);
          setPoiBreakdown(poiData.breakdown);
          setTopRoutes(routeData.routes);
          setTopClusters(topData.clusters);
          setUnauthorized(unData.clusters);
          setLoading(false);
        })
        .catch((e) => {
          setError(e?.message || "I couldn't load my analysis");
          setLoading(false);
        });
    } else {
      // Try backend API first, fall back to static if empty
      const p = { upload_id: String(uploadId), radius_m: String(radius) };
      Promise.all([
        api.get("/analytics/summary", { params: p }),
        api.get("/analytics/hourly", { params: { upload_id: String(uploadId) } }),
        api.get("/analytics/poi-breakdown", { params: p }),
        api.get("/analytics/route-breakdown", { params: { upload_id: String(uploadId), limit: "12" } }),
        api.get("/analytics/top-clusters", { params: { ...p, limit: "10" } }),
        api.get("/analytics/top-clusters", { params: { ...p, classification: "unauthorized", limit: "10" } }),
      ])
        .then(([sumRes, hourRes, poiRes, routeRes, topRes, unRes]) => {
          // If backend returned empty data, fall back to static
          if (sumRes.data.total_events === 0) {
            return Promise.all([
              fetchStatic("summary.json"),
              fetchStatic("hourly.json"),
              fetchStatic("poi-breakdown.json"),
              fetchStatic("route-breakdown.json"),
              fetchStatic("top-clusters-all.json"),
              fetchStatic("top-clusters-unauthorized.json"),
            ]).then(([s, h, poi, rt, tc, un]) => {
              setSummary(s); setHourly(h.distribution); setPoiBreakdown(poi.breakdown);
              setTopRoutes(rt.routes); setTopClusters(tc.clusters); setUnauthorized(un.clusters);
              setLoading(false);
            });
          }
          setSummary(sumRes.data);
          setHourly(hourRes.data.distribution);
          setPoiBreakdown(poiRes.data.breakdown);
          setTopRoutes(routeRes.data.routes);
          setTopClusters(topRes.data.clusters);
          setUnauthorized(unRes.data.clusters);
          setLoading(false);
        })
        .catch(() => {
          // Backend unreachable — fall back to static
          Promise.all([
            fetchStatic("summary.json"),
            fetchStatic("hourly.json"),
            fetchStatic("poi-breakdown.json"),
            fetchStatic("route-breakdown.json"),
            fetchStatic("top-clusters-all.json"),
            fetchStatic("top-clusters-unauthorized.json"),
          ]).then(([s, h, poi, rt, tc, un]) => {
            setSummary(s); setHourly(h.distribution); setPoiBreakdown(poi.breakdown);
            setTopRoutes(rt.routes); setTopClusters(tc.clusters); setUnauthorized(un.clusters);
            setLoading(false);
          }).catch((e) => {
            setError(e?.message || "I couldn't load my analysis");
            setLoading(false);
          });
        });
    }
  }, [uploadId, radius]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
        <div style={{ textAlign: "center" }}>
          <div className="status-dot processing" style={{ width: 12, height: 12, margin: "0 auto 12px" }} />
          <p style={{ color: "var(--text-secondary)" }}>I'm compiling my analysis...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "var(--red)", marginBottom: 8 }}>I couldn't load my analysis</p>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>{error}</p>
      </div>
    );
  }

  const piData = summary
    ? Object.entries(summary.event_classification)
        .filter(([k]) => k !== "unclassified")
        .map(([k, v]) => ({ name: k.replace("_", " "), value: v }))
    : [];

  const tooltipStyle = {
    contentStyle: { background: "#161b22", border: "1px solid #30363d", borderRadius: 6, fontSize: 12 },
    labelStyle: { color: "#e6edf3" },
  };

  // Build Google Maps links for top clusters
  const getGoogleMapsUrl = (lat: number, lon: number) =>
    `https://www.google.com/maps?q=${lat},${lon}&z=15&output=embed`;

  const getGoogleMapsLink = (lat: number, lon: number) =>
    `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

  return (
    <div style={{ padding: 20, overflowY: "auto" }}>
      {/* Google Maps cluster viewer */}
      <div className="panel" style={{ margin: "0 0 20px", padding: 16 }}>
        <div style={{ display: "flex", gap: 16 }}>
          {/* Cluster list */}
          <div style={{ width: 300, maxHeight: 350, overflowY: "auto" }}>
            <h2 style={{ marginBottom: 12, fontSize: 14 }}>Locations I've Identified</h2>
            {topClusters.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedMapCluster(c)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  marginBottom: 4,
                  background: selectedMapCluster?.id === c.id ? "var(--bg-tertiary)" : "transparent",
                  border: selectedMapCluster?.id === c.id ? "1px solid var(--border)" : "1px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {c.poi_name || `Cluster #${c.id}`}
                    </span>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                      {c.event_count} events &middot; {c.poi_type || "unknown"}
                    </div>
                  </div>
                  <span className={`badge ${c.classification}`} style={{ fontSize: 9 }}>
                    {c.classification?.replace("_", " ")}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Google Maps embed */}
          <div style={{ flex: 1, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", minHeight: 350 }}>
            {selectedMapCluster ? (
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <iframe
                  src={getGoogleMapsUrl(selectedMapCluster.centroid_lat, selectedMapCluster.centroid_lon)}
                  style={{ width: "100%", height: 350, border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Cluster location"
                />
                <a
                  href={getGoogleMapsLink(selectedMapCluster.centroid_lat, selectedMapCluster.centroid_lon)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    position: "absolute", bottom: 10, right: 10,
                    background: "rgba(13,17,23,0.9)", padding: "4px 10px",
                    borderRadius: 4, fontSize: 11, color: "var(--blue)",
                  }}
                >
                  Open in Google Maps
                </a>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 350, color: "var(--text-secondary)", fontSize: 13 }}>
                Select a cluster to see it on the map
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="charts-grid" style={{ padding: 0, marginBottom: 20 }}>
        {/* Classification pie */}
        <div className="panel" style={{ margin: 0 }}>
          <h2>My Classification Breakdown</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={piData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={85}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {piData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Hourly distribution */}
        <div className="panel" style={{ margin: 0 }}>
          <h2>When Your Fleet Stops</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hourly}>
              <XAxis dataKey="hour" tick={{ fill: "#8b949e", fontSize: 11 }} />
              <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} />
              <Tooltip {...tooltipStyle} labelFormatter={(h) => `${h}:00`} />
              <Bar dataKey="count" fill="#58a6ff" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* POI breakdown */}
        <div className="panel" style={{ margin: 0 }}>
          <h2>What's Near Each Halt</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={poiBreakdown.slice(0, 12)} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fill: "#8b949e", fontSize: 11 }} />
              <YAxis type="category" dataKey="poi_type" tick={{ fill: "#8b949e", fontSize: 10 }} width={120} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="total_events" fill="#bc8cff" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top routes */}
        <div className="panel" style={{ margin: 0 }}>
          <h2>Routes That Need Attention</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topRoutes.slice(0, 12)} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fill: "#8b949e", fontSize: 11 }} />
              <YAxis type="category" dataKey="route_code" tick={{ fill: "#8b949e", fontSize: 10 }} width={80} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="event_count" fill="#58a6ff" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top clusters table */}
      <div className="panel" style={{ margin: "0 0 20px" }}>
        <h2>My Top Findings</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Cluster</th><th>Events</th><th>Trips</th><th>Routes</th>
                <th>Classification</th><th>Nearest POI</th><th>Type</th><th>Distance</th>
                <th>Peak Hr</th><th>Night %</th>
              </tr>
            </thead>
            <tbody>
              {topClusters.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-secondary)", padding: 24 }}>I haven't found any clusters matching this filter</td></tr>
              ) : (
                topClusters.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.id}</td>
                    <td style={{ fontWeight: 600 }}>{c.event_count}</td>
                    <td>{c.distinct_trips}</td>
                    <td>{c.distinct_routes}</td>
                    <td><span className={`badge ${c.classification}`}>{c.classification?.replace("_", " ")}</span></td>
                    <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.poi_name || "—"}</td>
                    <td>{c.poi_type || "—"}</td>
                    <td>{c.poi_distance_m != null ? `${c.poi_distance_m}m` : "—"}</td>
                    <td>{c.peak_hour != null ? `${c.peak_hour}:00` : "—"}</td>
                    <td>{c.night_halt_pct != null ? `${c.night_halt_pct}%` : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unauthorized hotspots */}
      {unauthorized.length > 0 && (
        <div className="panel" style={{ margin: 0, borderColor: "rgba(248,81,73,0.3)" }}>
          <h2 style={{ color: "var(--red)" }}>Stops I've Flagged as Unauthorized</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
            These clusters have no identifiable POI within 2km — I consider these your highest risk
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>Cluster</th><th>Events</th><th>Trips</th><th>Routes</th><th>Location</th><th>Peak Hr</th><th>Night %</th></tr>
              </thead>
              <tbody>
                {unauthorized.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.id}</td>
                    <td style={{ color: "var(--red)", fontWeight: 600 }}>{c.event_count}</td>
                    <td>{c.distinct_trips}</td>
                    <td>{c.distinct_routes}</td>
                    <td style={{ fontSize: 11, fontFamily: "monospace" }}>{c.centroid_lat.toFixed(4)}, {c.centroid_lon.toFixed(4)}</td>
                    <td>{c.peak_hour != null ? `${c.peak_hour}:00` : "—"}</td>
                    <td style={{ color: (c.night_halt_pct ?? 0) > 40 ? "var(--red)" : undefined }}>
                      {c.night_halt_pct != null ? `${c.night_halt_pct}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
