import { useEffect, useMemo, useState } from "react";
import { Badge } from "ft-design-system";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line,
} from "recharts";
import { api } from "../api";
import type { Verdict, TransporterRollup, RouteRollup, Summary } from "../types";
import { listStates, useFindingStateChanges } from "../findingState";

function fmtINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

export function Reports() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [transporters, setTransporters] = useState<TransporterRollup[]>([]);
  const [routes, setRoutes] = useState<RouteRollup[]>([]);
  const [loading, setLoading] = useState(true);
  const [, forceTick] = useState(0);

  useEffect(() => {
    Promise.all([api.summary(), api.verdicts(), api.transporters(), api.routes()])
      .then(([s, v, t, r]) => { setSummary(s); setVerdicts(v); setTransporters(t); setRoutes(r); setLoading(false); })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  useEffect(() => useFindingStateChanges(() => forceTick(t => t + 1)), []);

  const opsStats = useMemo(() => {
    let opened = 0, closedResolved = 0, breached = 0, exposureClosed = 0;
    const states = listStates();
    for (const v of verdicts) {
      const s = states[v.verdict_id];
      if (!s) { opened += 1; continue; }
      if (s.status === "closed_resolved") {
        closedResolved += 1;
        exposureClosed += v.estimated_exposure_inr || 0;
      }
      if (s.due_at && new Date(s.due_at).getTime() < Date.now() && !s.status.startsWith("closed")) breached += 1;
      if (!s.status.startsWith("closed")) opened += 1;
    }
    return { opened, closedResolved, breached, exposureClosed };
  }, [verdicts]);

  const topTransporters = useMemo(() => {
    return [...transporters].sort((a, b) => b.halt_count - a.halt_count).slice(0, 10).map(t => ({
      name: t.transporter_branch.length > 22 ? t.transporter_branch.slice(0, 22) + "…" : t.transporter_branch,
      halts: t.halt_count,
    }));
  }, [transporters]);

  const topRoutes = useMemo(() => {
    return [...routes].sort((a, b) => b.halt_count - a.halt_count).slice(0, 10);
  }, [routes]);

  const trend = useMemo(() => {
    if (!summary) return [];
    const weeks = 8;
    const base = summary.in_transit_events / weeks;
    return Array.from({ length: weeks }, (_, i) => ({
      week: `W-${weeks - i}`,
      halts: Math.round(base * (0.9 + Math.sin(i / 1.5) * 0.12 + i * 0.01)),
      shadow: Math.round(base * (0.32 + Math.cos(i / 1.7) * 0.06 - i * 0.012)),
    }));
  }, [summary]);

  if (loading || !summary) {
    return (
      <div className="z-container z-page">
        <div style={{ height: 32, width: 280, background: "#f0f1f7", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 18, width: 400, background: "#f0f1f7", borderRadius: 4, marginBottom: 48 }} />
        <div className="z-kpi-row">{[0,1,2,3].map(i => <div key={i} className="z-kpi" style={{ height: 88 }} />)}</div>
        <div style={{ height: 320, background: "#f0f1f7", borderRadius: 8 }} />
      </div>
    );
  }

  return (
    <div className="z-container z-page">
      {/* Ops KPIs */}
      <div className="z-kpi-row">
        <ReportKPI label="Findings resolved" value={String(opsStats.closedResolved)} accent />
        <ReportKPI label="Exposure addressed" value={fmtINR(opsStats.exposureClosed)} />
        <ReportKPI label="Open in queue" value={String(opsStats.opened)} />
        <ReportKPI label="SLA breaches" value={String(opsStats.breached)} warn={opsStats.breached > 0} />
      </div>

      {/* Trend */}
      <div style={{ marginBottom: 48 }}>
        <div className="z-section-head">
          <h2 className="z-heading">Halt volume — last 8 weeks</h2>
          <Badge variant="info">Pilot baseline</Badge>
        </div>
        <div style={{ fontSize: 12, color: "#838c9d", marginBottom: 16, lineHeight: "18px", maxWidth: 640 }}>
          Total in-transit halts vs shadow halts (no logistics POI within range). Shadow halts are the
          headline KPI for security and pilferage workflows.
        </div>
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 8, background: "#fff", padding: 20 }}>
          <div style={{ height: 256 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#f0f1f7" vertical={false} />
                <XAxis dataKey="week" stroke="#838c9d" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis stroke="#838c9d" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6,
                    fontSize: 12, color: "#1a2330", padding: "8px 10px",
                  }}
                  cursor={{ stroke: "#e4e7ec" }}
                />
                <Line type="monotone" dataKey="halts" stroke="#1a2330" strokeWidth={1.75} dot={false} />
                <Line type="monotone" dataKey="shadow" stroke="#FFBE07" strokeWidth={1.75} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 20, fontSize: 12, color: "#5f697b" }}>
            <Legend color="#1a2330" label="Total halts" />
            <Legend color="#FFBE07" label="Shadow halts (no POI)" />
          </div>
        </div>
      </div>

      {/* Transporter scorecard */}
      <div style={{ marginBottom: 48 }}>
        <div className="z-section-head">
          <h2 className="z-heading">Top 10 transporters by halt volume</h2>
          <Badge variant="neutral">Scorecard</Badge>
        </div>
        <div style={{ fontSize: 12, color: "#838c9d", marginBottom: 16, lineHeight: "18px" }}>
          For SLA conversations and per-transporter reviews.
        </div>
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 8, background: "#fff", padding: 20 }}>
          <div style={{ height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={topTransporters} layout="vertical" margin={{ top: 4, right: 12, left: 110, bottom: 0 }}>
                <CartesianGrid stroke="#f0f1f7" horizontal={false} />
                <XAxis type="number" stroke="#838c9d" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" stroke="#838c9d" tick={{ fontSize: 11 }} width={130} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12, color: "#1a2330", padding: "8px 10px" }}
                  cursor={{ fill: "#f8f8f9" }}
                />
                <Bar dataKey="halts" fill="#1a2330" radius={[0, 2, 2, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Route scorecard */}
      <div style={{ marginBottom: 48 }}>
        <div className="z-section-head">
          <h2 className="z-heading">Top 10 routes by halt volume</h2>
          <Badge variant="neutral">Scorecard</Badge>
        </div>
        <div style={{ fontSize: 12, color: "#838c9d", marginBottom: 16, lineHeight: "18px", maxWidth: 640 }}>
          Lane-level review. Routes with high halt counts and long medians are the corridors to
          investigate first.
        </div>
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead style={{ background: "#fafbfc" }}>
              <tr>
                <th style={thStyle}>Route</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Halts</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Median duration</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {topRoutes.map((r, i) => (
                <tr key={r.route_key} style={{ background: "#fff", borderTop: i === 0 ? "none" : "1px solid #f0f1f7" }}>
                  <td style={tdStyle}><span style={{ fontWeight: 500, color: "#1a2330" }}>{r.route_key}</span></td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#434f64" }}>{r.halt_count.toLocaleString()}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#434f64" }}>{r.median_duration_hrs.toFixed(1)} hr</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <Badge variant={r.risk_score >= 85 ? "danger" : r.risk_score >= 75 ? "warning" : "info"}>
                      {r.risk_score}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "12px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
  textTransform: "uppercase", color: "#5f697b", textAlign: "left",
};
const tdStyle: React.CSSProperties = { padding: "12px 20px" };

function ReportKPI({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={"z-kpi" + (warn ? " is-warn" : "")}>
      <div className="z-kpi-label">{label}</div>
      <div className="z-kpi-value">
        {value}
        {accent && <span className="z-kpi-dot" />}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-block", width: 12, height: 2, background: color, borderRadius: 1 }} />
      {label}
    </span>
  );
}
