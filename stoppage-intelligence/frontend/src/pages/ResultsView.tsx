import { useState, useEffect } from "react";
import api from "../api/client";
import MapTab from "../components/MapTab";
import InsightsTab from "../components/InsightsTab";
import DataTab from "../components/DataTab";

interface Summary {
  filename: string;
  total_events: number;
  valid_events: number;
  invalid_events: number;
  distinct_trips: number;
  distinct_routes: number;
  total_clusters: number;
  event_classification: Record<string, number>;
  cluster_classification: Record<string, number>;
}

interface Props {
  uploadId: number;
}

const TABS = [
  { id: "map", label: "Map View" },
  { id: "insights", label: "Insights" },
  { id: "data", label: "Data Table" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function ResultsView({ uploadId }: Props) {
  const [tab, setTab] = useState<TabId>("map");
  const [radius, setRadius] = useState(500);
  const [classification, setClassification] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    api
      .get("/analytics/summary", { params: { upload_id: uploadId, radius_m: radius } })
      .then((r) => setSummary(r.data));
  }, [uploadId, radius]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* KPI strip */}
      {summary && (
        <div className="kpi-strip" style={{ paddingBottom: 0 }}>
          <div className="kpi-card">
            <div className="label">Events</div>
            <div className="value blue">{summary.valid_events.toLocaleString()}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Clusters</div>
            <div className="value blue">{summary.total_clusters}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Trips</div>
            <div className="value blue">{summary.distinct_trips.toLocaleString()}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Routes</div>
            <div className="value blue">{summary.distinct_routes}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Known Functional</div>
            <div className="value green">
              {(summary.event_classification.known_functional || 0).toLocaleString()}
            </div>
          </div>
          <div className="kpi-card">
            <div className="label">Other Legit</div>
            <div className="value yellow">
              {(summary.event_classification.other_legit || 0).toLocaleString()}
            </div>
          </div>
          <div className="kpi-card">
            <div className="label">Unauthorized</div>
            <div className="value red">
              {(summary.event_classification.unauthorized || 0).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Tab bar + filters */}
      <div className="filter-bar" style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`btn ${tab === t.id ? "primary" : ""}`}
              onClick={() => setTab(t.id)}
              style={{ fontSize: 13 }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <div>
            <label>Radius </label>
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
              <option value={200}>200m</option>
              <option value={500}>500m</option>
              <option value={1000}>1km</option>
              <option value={2000}>2km</option>
            </select>
          </div>
          <div>
            <label>Classification </label>
            <select value={classification} onChange={(e) => setClassification(e.target.value)}>
              <option value="">All</option>
              <option value="known_functional">Known Functional</option>
              <option value="other_legit">Other Legit</option>
              <option value="unauthorized">Unauthorized</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {tab === "map" && (
          <MapTab uploadId={uploadId} radius={radius} classification={classification} />
        )}
        {tab === "insights" && (
          <InsightsTab uploadId={uploadId} radius={radius} />
        )}
        {tab === "data" && (
          <DataTab uploadId={uploadId} classification={classification} />
        )}
      </div>
    </div>
  );
}
