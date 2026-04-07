import { useState, useEffect } from "react";
import api from "../api/client";
import { isStaticUpload, fetchStatic } from "../api/static";
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
}

const TABS = [
  { id: "map", label: "My Map" },
  { id: "insights", label: "My Analysis" },
  { id: "data", label: "Raw Records" },
] as const;

type TabId = (typeof TABS)[number]["id"];
type ExpandedCard = "clusters" | "known_functional" | "other_legit" | "unauthorized" | null;

export default function ResultsView({ uploadId }: Props) {
  const [tab, setTab] = useState<TabId>("map");
  const [radius, setRadius] = useState(500);
  const [classification, setClassification] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expanded, setExpanded] = useState<ExpandedCard>(null);
  const [expandedData, setExpandedData] = useState<TopCluster[]>([]);
  const [loadingCard, setLoadingCard] = useState(false);

  useEffect(() => {
    if (isStaticUpload(uploadId) && radius === 500) {
      fetchStatic("summary.json").then(setSummary).catch(() => {});
    } else {
      api
        .get("/analytics/summary", { params: { upload_id: uploadId, radius_m: radius } })
        .then((r) => {
          // If backend returns empty (DB wiped), fall back to static
          if (r.data.total_events === 0 && radius === 500) {
            fetchStatic("summary.json").then(setSummary).catch(() => setSummary(r.data));
          } else {
            setSummary(r.data);
          }
        })
        .catch(() => {
          fetchStatic("summary.json").then(setSummary).catch(() => {});
        });
    }
  }, [uploadId, radius]);

  // Close expanded card when filters change
  useEffect(() => {
    setExpanded(null);
    setExpandedData([]);
  }, [uploadId, radius]);

  const handleCardClick = async (card: ExpandedCard) => {
    if (expanded === card) {
      setExpanded(null);
      setExpandedData([]);
      return;
    }

    setExpanded(card);
    setLoadingCard(true);

    if (card === "unauthorized") {
      // No data to fetch for unauthorized - just show the explanation
      setExpandedData([]);
      setLoadingCard(false);
      return;
    }

    try {
      // Try static first for known cards
      const staticFile = card === "clusters" ? "top-clusters-all.json" : `top-clusters-${card}.json`;
      if (isStaticUpload(uploadId) || radius === 500) {
        try {
          const data = await fetchStatic(staticFile);
          if (data.clusters?.length > 0) {
            setExpandedData(data.clusters);
            setLoadingCard(false);
            return;
          }
        } catch { /* fall through to API */ }
      }

      const params: Record<string, string> = {
        upload_id: String(uploadId),
        radius_m: String(radius),
        limit: "15",
      };
      if (card === "known_functional" || card === "other_legit") {
        params.classification = card;
      }

      const res = await api.get("/analytics/top-clusters", { params });
      setExpandedData(res.data.clusters);
    } catch {
      setExpandedData([]);
    } finally {
      setLoadingCard(false);
    }
  };

  const CARD_DESCRIPTIONS: Record<string, { title: string; desc: string }> = {
    clusters: {
      title: "My Top Findings",
      desc: "These are the highest-frequency halt zones I've identified",
    },
    known_functional: {
      title: "Legitimate Logistics Stops",
      desc: "I've verified these stops are near fuel stations, toll booths, restaurants, or industrial gates within 500m",
    },
    other_legit: {
      title: "Other Verified Stops",
      desc: "These halts are near non-logistics POIs \u2014 hospitals, villages, shops \u2014 within 2km. Real stops, but not core logistics.",
    },
    unauthorized: {
      title: "Stops I've Flagged",
      desc: "",
    },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* KPI strip */}
      {summary && (
        <>
          <div className="kpi-strip" style={{ paddingBottom: 0 }}>
            <KpiCard
              label="Events"
              value={summary.valid_events.toLocaleString()}
              color="blue"
            />
            <KpiCard
              label="Clusters"
              value={String(summary.total_clusters)}
              color="blue"
              clickable
              active={expanded === "clusters"}
              onClick={() => handleCardClick("clusters")}
              hint="See my top findings"
            />
            <KpiCard
              label="Trips"
              value={summary.distinct_trips.toLocaleString()}
              color="blue"
            />
            <KpiCard
              label="Routes"
              value={String(summary.distinct_routes)}
              color="blue"
            />
            <KpiCard
              label="Known Functional"
              value={(summary.event_classification.known_functional || 0).toLocaleString()}
              color="green"
              clickable
              active={expanded === "known_functional"}
              onClick={() => handleCardClick("known_functional")}
              hint="See what I found"
            />
            <KpiCard
              label="Other Legit"
              value={(summary.event_classification.other_legit || 0).toLocaleString()}
              color="yellow"
              clickable
              active={expanded === "other_legit"}
              onClick={() => handleCardClick("other_legit")}
              hint="See what I found"
            />
            <KpiCard
              label="Unauthorized"
              value={(summary.event_classification.unauthorized || 0).toLocaleString()}
              color="red"
              clickable
              active={expanded === "unauthorized"}
              onClick={() => handleCardClick("unauthorized")}
              hint="Read my assessment"
            />
          </div>

          {/* Expanded card detail */}
          {expanded && (
            <div
              style={{
                margin: "0 24px",
                background: "var(--bg-secondary)",
                border: `1px solid ${expanded === "unauthorized" ? "rgba(248,81,73,0.4)" : "var(--border)"}`,
                borderRadius: "0 0 8px 8px",
                padding: "16px 20px",
                animation: "slideDown 0.2s ease-out",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600 }}>{CARD_DESCRIPTIONS[expanded]?.title}</h3>
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    {CARD_DESCRIPTIONS[expanded]?.desc}
                  </p>
                </div>
                <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setExpanded(null)}>
                  Close
                </button>
              </div>

              {expanded === "unauthorized" ? (
                <UnauthorizedExplainer
                  count={summary.event_classification.unauthorized || 0}
                  clusterCount={summary.cluster_classification?.unauthorized || 0}
                />
              ) : loadingCard ? (
                <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>Loading...</p>
              ) : (
                <ClusterTable data={expandedData} showClassification={expanded === "clusters"} />
              )}
            </div>
          )}
        </>
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

/* ---------- Sub-components ---------- */

function KpiCard({
  label,
  value,
  color,
  clickable,
  active,
  onClick,
  hint,
}: {
  label: string;
  value: string;
  color: string;
  clickable?: boolean;
  active?: boolean;
  onClick?: () => void;
  hint?: string;
}) {
  return (
    <div
      className="kpi-card"
      onClick={clickable ? onClick : undefined}
      style={{
        cursor: clickable ? "pointer" : "default",
        borderColor: active ? `var(--${color})` : undefined,
        borderBottomLeftRadius: active ? 0 : undefined,
        borderBottomRightRadius: active ? 0 : undefined,
        transition: "border-color 0.15s, transform 0.1s",
        ...(clickable ? { position: "relative" as const } : {}),
      }}
      onMouseEnter={(e) => {
        if (clickable) (e.currentTarget.style.transform = "translateY(-1px)");
      }}
      onMouseLeave={(e) => {
        if (clickable) (e.currentTarget.style.transform = "translateY(0)");
      }}
    >
      <div className="label">{label}</div>
      <div className={`value ${color}`}>{value}</div>
      {clickable && hint && (
        <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 4 }}>
          {active ? "Close" : hint}
        </div>
      )}
    </div>
  );
}

function ClusterTable({ data, showClassification }: { data: TopCluster[]; showClassification: boolean }) {
  if (data.length === 0) {
    return <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No clusters found</p>;
  }

  return (
    <div style={{ maxHeight: 320, overflowY: "auto", borderRadius: 6 }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Location / POI</th>
            <th>Type</th>
            <th>Events</th>
            <th>Trips</th>
            <th>Routes</th>
            <th>Distance</th>
            <th>Peak Hr</th>
            <th>Night %</th>
            {showClassification && <th>Class</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((c, i) => (
            <tr key={c.id}>
              <td style={{ color: "var(--text-secondary)", fontSize: 11 }}>{i + 1}</td>
              <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.poi_name || (
                  <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
                    {c.centroid_lat.toFixed(3)}, {c.centroid_lon.toFixed(3)}
                  </span>
                )}
              </td>
              <td style={{ fontSize: 12 }}>{c.poi_type || "—"}</td>
              <td style={{ fontWeight: 600 }}>{c.event_count}</td>
              <td>{c.distinct_trips}</td>
              <td>{c.distinct_routes}</td>
              <td>{c.poi_distance_m != null ? `${c.poi_distance_m}m` : "—"}</td>
              <td>{c.peak_hour != null ? `${c.peak_hour}:00` : "—"}</td>
              <td style={{ color: (c.night_halt_pct ?? 0) > 40 ? "var(--red)" : undefined }}>
                {c.night_halt_pct != null ? `${c.night_halt_pct}%` : "—"}
              </td>
              {showClassification && (
                <td>
                  <span className={`badge ${c.classification}`} style={{ fontSize: 10 }}>
                    {c.classification?.replace("_", " ")}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnauthorizedExplainer({ count, clusterCount }: { count: number; clusterCount: number }) {
  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
          <div style={{ background: "rgba(248,81,73,0.08)", borderRadius: 8, padding: "12px 16px", flex: 1, border: "1px solid rgba(248,81,73,0.2)" }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>Events</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--red)" }}>{count.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(248,81,73,0.08)", borderRadius: 8, padding: "12px 16px", flex: 1, border: "1px solid rgba(248,81,73,0.2)" }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>Clusters</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--red)" }}>{clusterCount}</div>
          </div>
        </div>

        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--red)" }}>Why I've flagged these stops</h4>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
          These are locations where I found <strong style={{ color: "var(--text-primary)" }}>no known Point of Interest within a 2km radius</strong>.
          The vehicle halted somewhere I can't explain — no fuel station, restaurant, toll booth, industrial zone, village, or any other identifiable landmark nearby.
        </p>

        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Why you should care</h4>
        <ul style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8, paddingLeft: 20 }}>
          <li>I found no explainable reason for the vehicle to stop at this location</li>
          <li>This could indicate <strong style={{ color: "var(--text-primary)" }}>theft risk</strong>, pilferage, or unauthorized detours</li>
          <li>It could also mean <strong style={{ color: "var(--text-primary)" }}>vehicle breakdowns</strong> in remote areas</li>
          <li>Or <strong style={{ color: "var(--text-primary)" }}>driver rest</strong> in undesignated locations</li>
          <li>Repeated unauthorized stops at the same location are what I consider the <strong style={{ color: "var(--red)" }}>highest-risk pattern</strong></li>
        </ul>

        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, marginTop: 12 }}>What I recommend</h4>
        <ul style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Review the high-frequency unauthorized clusters I've marked on <strong style={{ color: "var(--text-primary)" }}>My Map</strong> (red dots)</li>
          <li>Cross-reference with your route plans — is the stop on or off the planned route?</li>
          <li>Check the night halt percentage — I flag unauthorized stops with &gt;40% night halts as priority</li>
          <li>Escalate recurring clusters to your operations team for on-ground verification</li>
        </ul>
      </div>
    </div>
  );
}
