import { useState, useEffect } from "react";
import api from "../api/client";

interface Event {
  id: number;
  external_id: string;
  trip_id: string;
  route_code: string;
  alert_status: string;
  event_timestamp: string | null;
  lat: number;
  lon: number;
  nearest_poi_name: string | null;
  nearest_poi_type: string | null;
  nearest_poi_distance_m: number | null;
  classification: string;
  cluster_id: number | null;
}

interface Props {
  uploadId: number;
  classification: string;
}

export default function DataTab({ uploadId, classification }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [routeFilter, setRouteFilter] = useState("");
  const limit = 50;

  useEffect(() => {
    setPage(0);
  }, [uploadId, classification, routeFilter]);

  useEffect(() => {
    const params: Record<string, string> = {
      upload_id: String(uploadId),
      limit: String(limit),
      offset: String(page * limit),
    };
    if (classification) params.classification = classification;
    if (routeFilter) params.route_code = routeFilter;

    api.get("/events", { params }).then((r) => {
      setEvents(r.data.events);
      setTotal(r.data.total);
    });
  }, [uploadId, classification, routeFilter, page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div style={{ padding: 20, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{total.toLocaleString()} events</span>
        <input
          placeholder="Filter by route code..."
          value={routeFilter}
          onChange={(e) => setRouteFilter(e.target.value)}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 13,
            width: 200,
          }}
        />
      </div>

      <div className="panel" style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Trip ID</th>
                <th>Route</th>
                <th>Timestamp</th>
                <th>Lat</th>
                <th>Lon</th>
                <th>Nearest POI</th>
                <th>POI Type</th>
                <th>Distance</th>
                <th>Classification</th>
                <th>Cluster</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{e.trip_id}</td>
                  <td>{e.route_code}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {e.event_timestamp?.replace("T", " ").slice(0, 16) || "—"}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{e.lat?.toFixed(4)}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{e.lon?.toFixed(4)}</td>
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.nearest_poi_name || "—"}
                  </td>
                  <td>{e.nearest_poi_type || "—"}</td>
                  <td>{e.nearest_poi_distance_m != null ? `${e.nearest_poi_distance_m}m` : "—"}</td>
                  <td>
                    <span className={`badge ${e.classification}`}>
                      {e.classification?.replace("_", " ")}
                    </span>
                  </td>
                  <td>{e.cluster_id ?? "—"}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "var(--text-secondary)", padding: 24 }}>
                    No events found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16 }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)} style={{ fontSize: 12 }}>
            Previous
          </button>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Page {page + 1} of {totalPages}
          </span>
          <button className="btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} style={{ fontSize: 12 }}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
