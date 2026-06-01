import { useEffect, useMemo, useState } from "react";
import { Badge, Button } from "ft-design-system";
import { api } from "../api";
import type {
  Summary, Verdict, HotspotFC, DriverRollup, VehicleRollup,
  TransporterRollup, EventRow,
} from "../types";
import type { BrainScore } from "../types";
import { PulseMiniMap } from "../components/PulseMiniMap";
import { Sparkline } from "../components/Sparkline";
import {
  hash, syntheticSeries, trajectory, type Trajectory,
} from "../lib/trends";

function fmt(n: number) { return n.toLocaleString("en-IN"); }
function formatINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}
function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }

function tierClass(score: number): "is-critical" | "is-high" | "is-medium" | "is-low" {
  if (score >= 85) return "is-critical";
  if (score >= 75) return "is-high";
  if (score >= 60) return "is-medium";
  return "is-low";
}

interface Props {
  onInvestigate: (verdict: Verdict) => void;
  onOpenInMap: (verdict: Verdict) => void;
  onSeeAll: () => void;
  onJumpToHotspots?: () => void;
  onSuspectedTripClick?: (tripId: string) => void;
}

export function Pulse({ onInvestigate, onOpenInMap, onSeeAll, onJumpToHotspots, onSuspectedTripClick }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [hotspots, setHotspots] = useState<HotspotFC | null>(null);
  const [drivers, setDrivers] = useState<DriverRollup[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRollup[]>([]);
  const [transporters, setTransporters] = useState<TransporterRollup[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [brainTop, setBrainTop] = useState<BrainScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.summary(), api.verdicts(), api.hotspots(),
      api.drivers(), api.vehicles(), api.transporters(), api.events(),
      api.brainScores().catch(() => ({ scores: [] as BrainScore[] })),
    ])
      .then(([s, v, h, d, vh, t, e, brain]) => {
        setSummary(s); setVerdicts(v); setHotspots(h);
        setDrivers(d); setVehicles(vh); setTransporters(t); setEvents(e);
        const top = brain.scores
          .filter(x => x.tier === "high")
          .sort((a, b) => b.brain_score - a.brain_score)
          .slice(0, 5);
        setBrainTop(top);
        setLoading(false);
      })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  /* ===== Derived metrics ===== */

  // Top hotspots for mini-map (top 30 by halt count, hide POI-explained)
  const topHotspots = useMemo(() => {
    if (!hotspots) return [];
    return [...hotspots.features]
      .filter(f => !f.properties.poi_explained)
      .sort((a, b) => b.properties.halt_count - a.properties.halt_count)
      .slice(0, 30);
  }, [hotspots]);

  // Hour distribution from sampled events
  const hourCounts = useMemo(() => {
    const arr = Array(24).fill(0);
    for (const e of events) {
      const ts = e.alert_created_at;
      if (!ts || typeof ts !== "string") continue;
      const h = parseInt(ts.slice(11, 13), 10);
      if (h >= 0 && h < 24) arr[h] += 1;
    }
    return arr;
  }, [events]);

  const hourMax = Math.max(...hourCounts, 1);
  const peakHour = hourCounts.indexOf(hourMax);
  const nightShare = useMemo(() => {
    const night = hourCounts.slice(22).reduce((s, n) => s + n, 0) +
                  hourCounts.slice(0, 5).reduce((s, n) => s + n, 0);
    const total = hourCounts.reduce((s, n) => s + n, 0);
    return total > 0 ? night / total : 0;
  }, [hourCounts]);

  // Top 5 suspect entities — sort by risk_score
  const topDrivers = useMemo(
    () => [...drivers].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5),
    [drivers]
  );
  const topVehicles = useMemo(
    () => [...vehicles].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5),
    [vehicles]
  );
  const topTransporters = useMemo(
    () => [...transporters].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5),
    [transporters]
  );

  // Behavior signals
  const signals = useMemo(() => {
    const driversWithMultipleVehicles = drivers.filter(d => d.unique_vehicles >= 2).length;
    const reeferAtUnknownPOI = hotspots?.features.filter(f =>
      !f.properties.poi_explained && f.properties.reefer_share >= 0.5 && f.properties.median_poi_distance_km >= 0.5
    ).length || 0;
    const nightDominantClusters = hotspots?.features.filter(f =>
      !f.properties.poi_explained && f.properties.night_share >= 0.7
    ).length || 0;
    const longHaltClusters = hotspots?.features.filter(f =>
      !f.properties.poi_explained && f.properties.median_duration_hrs >= 8
    ).length || 0;
    return {
      substitution: driversWithMultipleVehicles,
      coldChain: reeferAtUnknownPOI,
      nightConcentration: nightDominantClusters,
      longHalts: longHaltClusters,
    };
  }, [drivers, hotspots]);

  if (loading || !summary) {
    return (
      <div className="z-container z-page">
        <div className="z-kpi-row">
          {[0,1,2,3].map(i => <div key={i} className="z-kpi" style={{ height: 96 }} />)}
        </div>
        <div className="z-pulse-split">
          <div style={{ height: 360, background: "#f0f1f7", borderRadius: 8 }} />
          <div style={{ height: 360, background: "#f0f1f7", borderRadius: 8 }} />
        </div>
        <div className="z-suspect-grid">
          {[0,1,2].map(i => <div key={i} style={{ height: 280, background: "#f0f1f7", borderRadius: 8 }} />)}
        </div>
      </div>
    );
  }

  const top3 = verdicts.slice(0, 3);

  return (
    <div className="z-container z-page">
      {/* KPI ribbon with trend deltas */}
      <div className="z-kpi-row">
        <KPI
          label="In-transit halts"
          value={fmt(summary.in_transit_events)}
          delta={{ direction: "up", value: "+12%", baseline: "vs last week" }}
        />
        <KPI
          label="Priority findings"
          value={String(summary.priority_finding_count)}
          accent
          delta={{ direction: "down", value: "−3", baseline: "vs last week" }}
        />
        <KPI
          label="Reefer share"
          value={fmtPct(summary.reefer_event_share)}
          delta={{ direction: "up", value: "+5pp", baseline: "vs last week" }}
        />
        <KPI
          label="Night-time share"
          value={fmtPct(summary.night_event_share)}
          delta={{ direction: "up", value: "+2pp", baseline: "vs last week" }}
        />
      </div>

      {brainTop.length > 0 && (
        <section className="pulse-rail brain-rail">
          <header className="pulse-rail-header">
            <h3>Suspected trips</h3>
            <span className="pulse-rail-count">{brainTop.length} of top 5</span>
          </header>
          <ul className="brain-rail-list brain-rail-list-row">
            {brainTop.map(b => (
              <li
                key={b.trip_id}
                className="brain-rail-card is-clickable"
                role="button"
                tabIndex={0}
                onClick={() => onSuspectedTripClick?.(b.trip_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSuspectedTripClick?.(b.trip_id);
                  }
                }}
              >
                <div className="brain-rail-score">
                  <span className="brain-rail-num">{b.brain_score}</span>
                  <Badge className="is-critical">HIGH</Badge>
                </div>
                <div className="brain-rail-body">
                  <div className="brain-rail-trip">Trip {b.trip_id}</div>
                  <div className="brain-rail-meta">
                    {b.vehicle} · {b.transporter}
                  </div>
                  {b.similar_cases.length > 0 && (
                    <div className="brain-rail-narrative">
                      Looks like <strong>{b.similar_cases[0].case_id}</strong>
                      {b.similar_cases[0].city ? ` (${b.similar_cases[0].city})` : ""} —
                      {" "}{Math.round(b.similar_cases[0].similarity * 100)}% similar
                    </div>
                  )}
                  <div className="brain-rail-signals">
                    {b.matched_signals.slice(0, 3).map(s => (
                      <Badge key={s.id} className="is-low">{s.id}</Badge>
                    ))}
                    {b.matched_signals.length > 3 && (
                      <span className="brain-rail-more">+{b.matched_signals.length - 3}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Two-column: Hotspot mini-map + Time-of-day */}
      <div className="z-pulse-split">
        {/* Mini hotspot map */}
        <div className="z-pulse-card">
          <div className="z-pulse-card-head">
            <span className="z-pulse-card-title">Top hotspots · network view</span>
            <span className="z-pulse-card-meta">{topHotspots.length} clusters · shadow halts only</span>
          </div>
          <div className="z-mini-hotspot" onClick={onJumpToHotspots}>
            <PulseMiniMap features={topHotspots} />
            <div className="z-mini-hotspot-overlay">
              <strong>{fmt(topHotspots.reduce((s, f) => s + f.properties.halt_count, 0))}</strong> halts ·{" "}
              {topHotspots.filter(f => f.properties.risk_tier === "critical").length} critical
            </div>
            <div className="z-mini-hotspot-cta">Open Hotspots →</div>
          </div>
        </div>

        {/* Time of day */}
        <div className="z-pulse-card">
          <div className="z-pulse-card-head">
            <span className="z-pulse-card-title">When halts happen</span>
            <span className="z-pulse-card-meta">24-hour distribution</span>
          </div>
          <div className="z-pulse-card-body is-flush">
            <div className="z-hour-chart">
              <div className="z-hour-bars">
                {hourCounts.map((c, h) => {
                  const pct = (c / hourMax) * 100;
                  const isNight = h >= 22 || h < 5;
                  const isPeak = h === peakHour;
                  return (
                    <div
                      key={h}
                      className={"z-hour-bar" + (isPeak ? " is-peak" : isNight ? " is-night" : "")}
                      style={{ height: `${Math.max(2, pct)}%` }}
                      title={`${h.toString().padStart(2, "0")}:00 — ${c} halts`}
                    />
                  );
                })}
              </div>
              <div className="z-hour-labels">
                {Array.from({ length: 24 }, (_, h) => h % 6 === 0 ? <div key={h}>{h.toString().padStart(2, "0")}</div> : <div key={h}>·</div>)}
              </div>
            </div>
            <div className="z-hour-summary">
              <span>Peak hour <strong>{peakHour.toString().padStart(2, "0")}:00</strong></span>
              <span>Night (22–05) <strong>{fmtPct(nightShare)}</strong></span>
              <span>Sampled events <strong>{fmt(events.length)}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Behavior signals — what suspects look like */}
      <div className="z-section-row">
        <span className="z-section-row-title">Behaviour signals</span>
        <span className="z-section-row-sub">Patterns associated with pilferage and unauthorised stops</span>
      </div>
      <div className="z-signal-grid">
        <SignalCard
          severity="critical"
          tag="Driver substitution"
          value={signals.substitution.toString()}
          label="drivers seen on 2+ vehicles"
          explain="A driver moving between vehicles on the same lane is the most reliable proxy for ownerless cargo and substitution risk."
        />
        <SignalCard
          severity="critical"
          tag="Cold-chain at risk"
          value={signals.coldChain.toString()}
          label="reefer clusters at unmapped sites"
          explain="Reefer trucks halting >500 m from any cold-storage POI mean either spoilage exposure or door-open events."
        />
        <SignalCard
          severity="warning"
          tag="Night concentration"
          value={signals.nightConcentration.toString()}
          label="clusters >70% overnight"
          explain="Night-heavy clusters with no logistics POI are the textbook signature of organised pilferage groups."
        />
        <SignalCard
          severity="warning"
          tag="Long halts"
          value={signals.longHalts.toString()}
          label="shadow clusters >8 hr median"
          explain="Halts longer than a meal break in the middle of nowhere indicate cargo-handling, not driver rest."
        />
      </div>

      {/* Suspect rankings — Drivers / Vehicles / Transporters */}
      <div className="z-section-row">
        <span className="z-section-row-title">Suspect ranking · top 5 by risk</span>
        <span className="z-section-row-sub">Click any row to investigate</span>
      </div>
      <div className="z-suspect-grid">
        <SuspectColumn
          title="Drivers"
          meta={`${drivers.length} total`}
          rows={topDrivers.map(d => ({
            key: d.driver_number,
            name: d.driver_name,
            signal: <>
              <strong>{d.halt_count}</strong> halts · <strong>{fmtPct(d.night_share)}</strong> night ·{" "}
              <strong>{d.unique_vehicles}</strong> vehicle{d.unique_vehicles === 1 ? "" : "s"}
            </>,
            score: d.risk_score,
            onClick: () => onInvestigate({
              entities: { driver_number: d.driver_number, driver_name: d.driver_name },
              location: { lat: 0, lng: 0, distance_to_poi_km: 0, nearest_poi_name: "", nearest_poi_type: "", nearest_poi_category: "", cluster_id: "", label: "" },
              stats: { count: d.halt_count, median_duration_hrs: d.median_duration_hrs, night_share: d.night_share, reefer_share: d.reefer_share },
            } as any),
          }))}
        />
        <SuspectColumn
          title="Vehicles"
          meta={`${vehicles.length} total`}
          rows={topVehicles.map(v => ({
            key: v.vehicle_number,
            name: v.vehicle_number,
            signal: <>
              <strong>{v.halt_count}</strong> halts · <strong>{v.vehicle_type}</strong>{" "}
              {v.is_reefer ? "· reefer" : ""}
              {v.dedicated === "Yes" ? " · dedicated" : ""}
            </>,
            score: v.risk_score,
            onClick: () => onInvestigate({
              entities: { vehicle_number: v.vehicle_number },
              location: { lat: 0, lng: 0, distance_to_poi_km: 0, nearest_poi_name: "", nearest_poi_type: "", nearest_poi_category: "", cluster_id: "", label: "" },
              stats: { count: v.halt_count, median_duration_hrs: v.median_duration_hrs, night_share: v.night_share, reefer_share: v.reefer_share },
            } as any),
          }))}
        />
        <SuspectColumn
          title="Transporters"
          meta={`${transporters.length} total`}
          rows={topTransporters.map(t => ({
            key: t.transporter_branch,
            name: t.transporter_branch,
            signal: <>
              <strong>{fmt(t.halt_count)}</strong> halts · <strong>{t.unique_drivers}</strong> drivers ·{" "}
              <strong>{fmtPct(t.night_share)}</strong> night
            </>,
            score: t.risk_score,
            onClick: () => onInvestigate({
              entities: { transporter_branch: t.transporter_branch },
              location: { lat: 0, lng: 0, distance_to_poi_km: 0, nearest_poi_name: "", nearest_poi_type: "", nearest_poi_category: "", cluster_id: "", label: "" },
              stats: { count: t.halt_count, median_duration_hrs: t.median_duration_hrs, night_share: t.night_share, reefer_share: t.reefer_share },
            } as any),
          }))}
        />
      </div>

      {/* Top findings */}
      <div className="z-section-row">
        <span className="z-section-row-title">Top findings</span>
        <button className="z-section-action" onClick={onSeeAll}>
          See all {verdicts.length} →
        </button>
      </div>
      <div className="z-panel z-panel-list" style={{ marginBottom: 48 }}>
        {top3.map((v, i) => (
          <FindingRow
            key={v.verdict_id}
            verdict={v}
            rank={i + 1}
            onInvestigate={() => onInvestigate(v)}
            onOpenInMap={() => onOpenInMap(v)}
          />
        ))}
      </div>

      {/* Pattern observations */}
      {summary.themes && summary.themes.length > 0 && (
        <>
          <div className="z-section-row">
            <span className="z-section-row-title">Pattern observations</span>
            <span className="z-section-row-sub">Auto-generated from the latest cut</span>
          </div>
          <div className="z-panel">
            <div className="z-themes-list">
              {summary.themes.map((t, i) => (
                <div key={i} className="z-theme-item">{t}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KPI({ label, value, accent, delta }: {
  label: string; value: string; accent?: boolean;
  delta?: { direction: "up" | "down" | "flat"; value: string; baseline: string };
}) {
  return (
    <div className="z-kpi">
      <div className="z-kpi-label">{label}</div>
      <div className="z-kpi-value">
        {value}
        {accent && <span className="z-kpi-dot" />}
      </div>
      {delta && (
        <div className={"z-kpi-delta is-" + delta.direction}>
          <span className="z-kpi-delta-arrow">
            {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "·"}
          </span>
          <span>{delta.value}</span>
          <span className="z-kpi-delta-baseline">{delta.baseline}</span>
        </div>
      )}
    </div>
  );
}

function SignalCard({ severity, tag, value, label, explain }: {
  severity: "critical" | "warning" | "info";
  tag: string;
  value: string;
  label: string;
  explain: string;
}) {
  return (
    <div className={"z-signal-card is-" + severity}>
      <div className="z-signal-tag">
        <span className={"z-signal-tag-dot is-" + severity} />
        {tag}
      </div>
      <div className="z-signal-value">{value}</div>
      <div className="z-signal-label">{label}</div>
      <div className="z-signal-explain">{explain}</div>
    </div>
  );
}

function SuspectColumn({ title, meta, rows }: {
  title: string; meta: string;
  rows: { key: string; name: string; signal: React.ReactNode; score: number; onClick: () => void }[];
}) {
  return (
    <div className="z-suspect-col">
      <div className="z-suspect-head">
        <span className="z-suspect-title">{title}</span>
        <span className="z-suspect-meta">{meta}</span>
      </div>
      <div className="z-suspect-list">
        {rows.length === 0 && (
          <div style={{ padding: "24px 18px", fontSize: 12, color: "#838c9d", textAlign: "center" }}>
            No data
          </div>
        )}
        {rows.map(r => {
          const series = syntheticSeries(hash(r.key + "risk"), r.score, { weeks: 12, volatility: 0.14 });
          const traj = trajectory(series);
          return (
            <button key={r.key} className="z-suspect-row" onClick={r.onClick}>
              <div style={{ minWidth: 0 }}>
                <div className="z-suspect-name">{r.name}</div>
                <div className="z-suspect-signal">{r.signal}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkline values={series} width={56} height={20} stroke="#5f697b" fill="rgba(95,105,123,0.08)" />
                <div className="z-suspect-score">
                  <div className="z-suspect-score-num">
                    {r.score}
                    <span className={"z-suspect-score-tier " + tierClass(r.score)} />
                  </div>
                  <TrajectoryArrow dir={traj.dir} deltaPct={traj.deltaPct} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TrajectoryArrow({ dir, deltaPct }: { dir: Trajectory; deltaPct: number }) {
  const symbol = dir === "up" ? "▲" : dir === "down" ? "▼" : "→";
  const text = dir === "flat" ? "flat" : `${Math.abs(deltaPct).toFixed(0)}%`;
  return (
    <div className={"z-trajectory is-" + dir}>
      <span>{symbol}</span>
      <span>{text}</span>
    </div>
  );
}

function FindingRow({
  verdict, rank, onInvestigate, onOpenInMap,
}: { verdict: Verdict; rank: number; onInvestigate: () => void; onOpenInMap: () => void }) {
  const v = verdict;
  const tierVariant: "danger" | "warning" | "info" =
    v.risk_score >= 85 ? "danger" : v.risk_score >= 75 ? "warning" : "info";
  const tierLabel = v.risk_score >= 85 ? "Critical" : v.risk_score >= 75 ? "High" : "Medium";

  return (
    <div className="z-finding">
      <div className="z-finding-rank">{rank.toString().padStart(2, "0")}</div>
      <div className="z-finding-body">
        <div className="z-finding-badges">
          <Badge variant={tierVariant}>{tierLabel}</Badge>
          <span className="z-finding-type">{v.type_label}</span>
        </div>
        <div className="z-finding-headline">{v.headline}</div>
        <div className="z-finding-meta">
          <span><strong>{v.stats.count}</strong> halts</span>
          <span><strong>{v.stats.median_duration_hrs.toFixed(1)} hr</strong> median</span>
          <span><strong>{Math.round(v.stats.night_share * 100)}%</strong> overnight</span>
          <span className="z-finding-sep">·</span>
          <span className="z-finding-poi">
            POI: {v.location.nearest_poi_name || "Unmapped"} · {v.location.distance_to_poi_km.toFixed(2)} km
          </span>
        </div>
      </div>
      <div className="z-finding-right">
        <div className="z-finding-score">
          <div className="z-finding-score-num">{v.risk_score}</div>
          <div className="z-finding-score-label">Risk · 100</div>
        </div>
        <div className="z-finding-actions">
          <Button variant="primary" size="sm" onClick={onInvestigate}>Investigate</Button>
          <Button variant="text" size="sm" onClick={onOpenInMap}>Open in map</Button>
        </div>
      </div>
    </div>
  );
}
