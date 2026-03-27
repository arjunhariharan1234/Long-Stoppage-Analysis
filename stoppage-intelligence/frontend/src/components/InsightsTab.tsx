import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import api from "../api/client";

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

  useEffect(() => {
    setLoading(true);
    setError(null);

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
        setSummary(sumRes.data);
        setHourly(hourRes.data.distribution);
        setPoiBreakdown(poiRes.data.breakdown);
        setTopRoutes(routeRes.data.routes);
        setTopClusters(topRes.data.clusters);
        setUnauthorized(unRes.data.clusters);
        setLoading(false);
      })
      .catch((e) => {
        setError(e?.response?.data?.detail || e?.message || "Failed to load insights");
        setLoading(false);
      });
  }, [uploadId, radius]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
        <div style={{ textAlign: "center" }}>
          <div className="status-dot processing" style={{ width: 12, height: 12, margin: "0 auto 12px" }} />
          <p style={{ color: "var(--text-secondary)" }}>Loading insights...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "var(--red)", marginBottom: 8 }}>Failed to load insights</p>
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

  return (
    <div style={{ padding: 20, overflowY: "auto" }}>
      <div className="charts-grid" style={{ padding: 0, marginBottom: 20 }}>
        {/* Classification pie */}
        <div className="panel" style={{ margin: 0 }}>
          <h2>Event Classification</h2>
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
          <h2>Stoppage by Hour of Day</h2>
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
          <h2>Stoppages by POI Type</h2>
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
          <h2>Top Routes by Stoppages</h2>
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
        <h2>Top Halt Clusters</h2>
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
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-secondary)", padding: 24 }}>No clusters found</td></tr>
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
          <h2 style={{ color: "var(--red)" }}>Unauthorized Halt Hotspots</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
            Clusters with no known POI within 2km — highest operational risk
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
