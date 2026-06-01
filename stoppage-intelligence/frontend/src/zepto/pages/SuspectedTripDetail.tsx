import { useEffect, useMemo, useState } from "react";
import { Badge, Button } from "ft-design-system";
import { api } from "../api";
import type {
  BrainScore, BrainSignal, BrainSimilarCase, BrainRollupsFile, BrainEntityRollup,
  TripRow, TripHalt,
} from "../types";
import { TripDetail } from "../components/TripDetail";

interface Props {
  tripId: string;
  onBack: () => void;
  onOpenSuspectedTrip?: (tripId: string) => void;
}

/* ---------------- helpers ---------------- */

function fmtTs(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return iso; }
}

function fmtGap(fromIso?: string | null, toIso?: string | null): string {
  if (!fromIso || !toIso) return "";
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (isNaN(a) || isNaN(b)) return "";
  const mins = Math.round((b - a) / 60000);
  if (mins < 0) return "";
  if (mins < 60) return `${mins} min later`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs}h later` : `${hrs}h ${rem}m later`;
}

function tierLabel(tier: BrainScore["tier"]): string {
  return tier === "high" ? "HIGH RISK" : tier === "medium" ? "MEDIUM RISK" : "LOW RISK";
}

function tierClass(tier: BrainScore["tier"]): string {
  return tier === "high" ? "is-critical" : tier === "medium" ? "is-medium" : "is-low";
}

function aliasLocation(s?: string): string {
  if (!s) return "—";
  const tail = s.includes(" - ") ? s.split(" - ").slice(1).join(" - ") : s;
  return tail || s;
}

/* Synthesize a TripRow from a BrainScore so we can reuse the existing TripDetail map. */
function synthesizeTripRow(b: BrainScore): TripRow {
  const clusters = (b as any).halt_clusters as { lat: number; lng: number; ping_count: number }[] | undefined;
  const totalStop = b.stoppage_hrs ?? 0;
  const oLat = (b as any).origin_lat as number | null;
  const oLng = (b as any).origin_lng as number | null;
  const dLat = (b as any).destination_lat as number | null;
  const dLng = (b as any).destination_lng as number | null;
  const totalPings = clusters && clusters.length ? clusters.reduce((a, c) => a + c.ping_count, 0) : 1;
  let halts: TripHalt[] = (clusters ?? []).map((c) => ({
    ts: "",
    lat: c.lat,
    lng: c.lng,
    duration_hrs: totalPings > 0 ? Math.round((totalStop * c.ping_count / totalPings) * 100) / 100 : 0,
    escalation: 2,
    poi_name: "Unmapped halt",
    poi_type: "No POI within 2km",
    poi_category: "",
    distance_to_poi_km: null,
    cluster_id: `${c.lat},${c.lng}`,
    cluster_halt_count: 1,
    is_night: false,
    address: "",
  } as TripHalt));

  // Telemetry reports stoppage time but GPS pings were too sparse to detect
  // a spatial cluster — fabricate one synthetic halt at the route midpoint
  // so the stats panel doesn't read "0 halts · 7.1h max halt" (a contradiction).
  if (halts.length === 0 && totalStop >= 0.25 && oLat != null && oLng != null && dLat != null && dLng != null) {
    halts = [{
      ts: "",
      lat: (oLat + dLat) / 2,
      lng: (oLng + dLng) / 2,
      duration_hrs: Math.round(totalStop * 100) / 100,
      escalation: 2,
      poi_name: "Reported stoppage (location approximate)",
      poi_type: "Telemetry-only",
      poi_category: "",
      distance_to_poi_km: null,
      cluster_id: "synth",
      cluster_halt_count: 1,
      is_night: false,
      address: "",
    } as TripHalt];
  }

  return {
    trip_id: String(b.trip_id),
    master_trip_id: String(b.trip_id),
    origin: b.origin || "",
    destination: b.destination || "",
    origin_lat: (b as any).origin_lat ?? null,
    origin_lng: (b as any).origin_lng ?? null,
    destination_lat: (b as any).destination_lat ?? null,
    destination_lng: (b as any).destination_lng ?? null,
    vehicle_number: b.vehicle || "",
    vehicle_type: "",
    transporter_branch: b.transporter || "",
    driver_name: b.driver_name || "",
    driver_number: b.driver_number || "",
    zone: "",
    inbound_or_outbound: "Outbound",
    trip_status: "closed",
    halt_count: halts.length,
    max_stoppage_hrs: halts.length ? Math.max(...halts.map(h => h.duration_hrs)) : totalStop,
    total_stoppage_hrs: totalStop,
    max_escalation: b.tier === "high" ? 3 : b.tier === "medium" ? 2 : 1,
    first_alert_at: b.first_ping_outside_origin || b.gate_out || "",
    latest_alert_at: b.trip_closure_time || "",
    total_planned_distance: b.google_distance_km ?? null,
    total_transit_distance: b.transit_distance_km ?? null,
    is_reefer: /REEFER|COLD/i.test(b.origin || ""),
    night_share: 0,
    top_poi_name: "",
    top_poi_type: "",
    top_poi_category: "",
    top_poi_distance_km: null,
    unmapped_halts: halts.length,
    halts,
  };
}

/* ---------------- subcomponents ---------------- */

/* Translate the brain's raw evidence key/value into an operator-friendly
   label and value. The brain emits things like {stoppage_share: 0.49} or
   {detour_ratio: 2.26} which are technical; we surface them as natural
   English numbers an ops manager can act on. */
function formatEvidence(key: string, raw: unknown): { label: string; value: string } | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  const isNum = !isNaN(n);
  switch (key) {
    case "detour_ratio":
      return isNum
        ? { label: "Detour size", value: `${n.toFixed(2)}× the planned distance` }
        : null;
    case "stoppage_share":
      return isNum
        ? { label: "Time stopped", value: `${Math.round(n * 100)}% of the trip` }
        : null;
    case "excess_km":
      return isNum
        ? { label: "Extra distance vs plan", value: `${n.toFixed(1)} km` }
        : null;
    case "pings_per_km":
      return isNum
        ? { label: "GPS ping density", value: `${n.toFixed(2)} pings per km${n < 0.5 ? " (sparse)" : ""}` }
        : null;
    case "unloading_hrs":
      return isNum
        ? { label: "Time spent unloading", value: n < 0.1 ? "< 6 minutes" : `${(n * 60).toFixed(0)} minutes` }
        : null;
    case "eta_breach_hrs":
      return isNum
        ? { label: "How late vs planned ETA", value: `${n.toFixed(1)} hours late` }
        : null;
    case "loading_time_hrs":
      return isNum
        ? { label: "Time spent loading", value: `${n.toFixed(1)} hours` }
        : null;
    case "gate_to_first_ping_min":
      return isNum
        ? { label: "GPS-off window after departure", value: `${n.toFixed(0)} minutes` }
        : null;
    case "tracking_health":
      return isNum
        ? { label: "Tracking quality", value: `${n.toFixed(0)} / 100 (poor)` }
        : null;
    case "alerts_count":
      return isNum
        ? { label: "Platform alerts raised", value: `${n.toFixed(0)}` }
        : null;
    case "destination_entry_present":
      return { label: "Recorded arrival at destination", value: raw ? "Yes" : "No" };
    case "transit_distance_km":
      return isNum ? { label: "Distance actually driven", value: `${n.toFixed(1)} km` } : null;
    case "geofence_breached":
      return { label: "Geofence breached", value: raw ? "Yes" : "No" };
    case "origin":
      return { label: "Origin", value: String(raw) };
    case "destination":
      return { label: "Destination", value: String(raw) };
    case "closure_mode":
      return { label: "Trip closed by", value: String(raw) };
    default:
      // Last-resort fallback: convert key to title case so we never leak
      // raw snake_case keys to the user.
      return {
        label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: String(raw),
      };
  }
}

function ReasonCard({ signal }: { signal: BrainSignal }) {
  const [open, setOpen] = useState(false);
  const evidenceItems = useMemo(() => {
    return Object.entries(signal.evidence ?? {})
      .map(([k, v]) => formatEvidence(k, v))
      .filter((x): x is { label: string; value: string } => x !== null);
  }, [signal]);
  return (
    <div className="susp-reason">
      <div className="susp-reason-head">
        <div className="susp-reason-text">{signal.human_text || signal.name}</div>
        <Badge className="is-low">+{signal.weight} pts</Badge>
      </div>
      {evidenceItems.length > 0 && (
        <button className="susp-reason-toggle" onClick={() => setOpen(!open)}>
          {open ? "Hide details" : "What the system saw"}
        </button>
      )}
      {open && evidenceItems.length > 0 && (
        <dl className="susp-reason-evidence">
          {evidenceItems.map((item) => (
            <div key={item.label} className="susp-reason-evidence-row">
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function SimilarCaseCard({ c }: { c: BrainSimilarCase }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="susp-similar">
      <div className="susp-similar-head">
        <div className="susp-similar-headline">
          {c.headline || (c.city ? `Past theft in ${c.city}` : "Past theft incident")}
        </div>
        <Badge className="is-medium">{Math.round(c.similarity * 100)}% match</Badge>
      </div>
      {c.rca_summary && (
        <>
          <button className="susp-reason-toggle" onClick={() => setOpen(!open)}>
            {open ? "Hide investigator notes" : "Read investigator notes"}
          </button>
          {open && <p className="susp-similar-rca">{c.rca_summary}</p>}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, flag }: { label: string; value: string; sub?: string; flag?: boolean }) {
  return (
    <div className={`susp-stat ${flag ? "is-flagged" : ""}`}>
      <div className="susp-stat-label">{label}</div>
      <div className="susp-stat-value">{value}</div>
      {sub && <div className="susp-stat-sub">{sub}</div>}
    </div>
  );
}

/* Entity-drill modal: click driver/transporter → show their other suspected trips. */
function EntityDrillModal({
  kind, name, subtitle, rollup, suspectedTrips, onClose, onSelectTrip,
}: {
  kind: "Driver" | "Vehicle" | "Transporter";
  name: string;
  subtitle?: string;
  rollup: BrainEntityRollup | null;
  suspectedTrips: BrainScore[];
  onClose: () => void;
  onSelectTrip: (tripId: string) => void;
}) {
  return (
    <div className="susp-modal-backdrop" onClick={onClose}>
      <div className="susp-modal" onClick={(e) => e.stopPropagation()}>
        <header className="susp-modal-head">
          <div>
            <div className="susp-modal-kind">{kind}</div>
            <div className="susp-modal-name">{name}</div>
            {subtitle && <div className="susp-modal-sub">{subtitle}</div>}
          </div>
          <button className="susp-modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="susp-modal-body">
          <div className="susp-modal-stats">
            <div className="susp-modal-stat">
              <div className="susp-modal-stat-label">Trips in cohort</div>
              <div className="susp-modal-stat-value">{rollup?.trips ?? "—"}</div>
            </div>
            <div className="susp-modal-stat">
              <div className="susp-modal-stat-label">Brain-flagged</div>
              <div className="susp-modal-stat-value">{rollup?.trips_with_brain_hit ?? "—"}</div>
            </div>
            <div className="susp-modal-stat">
              <div className="susp-modal-stat-label">Average risk score</div>
              <div className="susp-modal-stat-value">{rollup?.risk_score ?? "—"}</div>
            </div>
          </div>
          <h4 className="susp-modal-section-title">Suspected trips for this {kind.toLowerCase()}</h4>
          {suspectedTrips.length === 0 ? (
            <p className="zepto-empty">No other suspected trips for this {kind.toLowerCase()}.</p>
          ) : (
            <ul className="susp-modal-trip-list">
              {suspectedTrips.slice(0, 20).map(t => (
                <li key={t.trip_id} className="susp-modal-trip-row" onClick={() => onSelectTrip(t.trip_id)}>
                  <div className="susp-modal-trip-id">Trip {t.trip_id}</div>
                  <div className="susp-modal-trip-route">{aliasLocation(t.origin)} → {aliasLocation(t.destination)}</div>
                  <Badge className={tierClass(t.tier)}>{t.brain_score}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- main ---------------- */

type Tab = "trip" | "brain";

export function SuspectedTripDetail({ tripId, onBack, onOpenSuspectedTrip }: Props) {
  const [score, setScore] = useState<BrainScore | null>(null);
  const [allScores, setAllScores] = useState<BrainScore[]>([]);
  const [rollups, setRollups] = useState<BrainRollupsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("brain");
  const [drill, setDrill] = useState<{ kind: "Driver" | "Vehicle" | "Transporter"; key: string; name: string; sub?: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.brainScores(),
      api.brainRollups().catch(() => null),
    ])
      .then(([file, rups]) => {
        const hit = file.scores.find(s => s.trip_id === tripId) ?? null;
        if (!hit) setError(`Trip ${tripId} not in brain scores`);
        setScore(hit);
        setAllScores(file.scores);
        setRollups(rups);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, [tripId]);

  const sortedSignals = useMemo(
    () => (score ? [...score.matched_signals].sort((a, b) => b.weight - a.weight) : []),
    [score]
  );

  const synthRow = useMemo(() => (score ? synthesizeTripRow(score) : null), [score]);

  const drillRollup = useMemo<BrainEntityRollup | null>(() => {
    if (!drill || !rollups) return null;
    const list = drill.kind === "Driver" ? rollups.drivers
               : drill.kind === "Vehicle" ? rollups.vehicles
               : rollups.transporters;
    const keyField = drill.kind === "Driver" ? "driver_number"
                   : drill.kind === "Vehicle" ? "vehicle" : "transporter";
    return list.find((r) => (r as any)[keyField] === drill.key) ?? null;
  }, [drill, rollups]);

  const drillSuspectedTrips = useMemo<BrainScore[]>(() => {
    if (!drill) return [];
    const field: keyof BrainScore = drill.kind === "Driver" ? "driver_number"
                                 : drill.kind === "Vehicle" ? "vehicle" : "transporter";
    return allScores
      .filter(s => s[field] === drill.key && s.trip_id !== tripId && s.brain_score > 0)
      .sort((a, b) => b.brain_score - a.brain_score);
  }, [drill, allScores, tripId]);

  // Auto-switch to "Trip view" once we have GPS data; otherwise stay on
  // "Why suspected". Kept above the early-return so the hook order is
  // stable across loading vs loaded renders (React rules-of-hooks).
  const hasGeoForTab =
    synthRow != null && synthRow.origin_lat != null && synthRow.destination_lat != null;
  useEffect(() => {
    if (hasGeoForTab) setTab("trip");
  }, [hasGeoForTab]);

  if (loading) {
    return <div className="z-container susp-loading">Loading trip {tripId}…</div>;
  }
  if (error || !score) {
    return (
      <div className="z-container susp-loading">
        <Button variant="secondary" size="sm" onClick={onBack}>← Back to review</Button>
        <p style={{ marginTop: 16 }}>{error || `No data for trip ${tripId}.`}</p>
      </div>
    );
  }

  const distKm = score.transit_distance_km ?? 0;
  const planKm = score.google_distance_km ?? 0;
  const detourKm = Math.max(0, distKm - planKm);
  const hasGeo = hasGeoForTab;

  return (
    <div className="z-container susp-page">
      {/* Top bar */}
      <div className="susp-topbar">
        <Button variant="secondary" size="sm" onClick={onBack}>← Back to review</Button>
        <div className="susp-topbar-trip">
          Trip {score.trip_id}
          {(() => {
            const ds = score.trip_closure_time || score.first_ping_outside_origin;
            if (!ds) return null;
            const d = new Date(ds);
            if (isNaN(d.getTime())) return null;
            return (
              <span className="susp-topbar-date">
                · {d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            );
          })()}
        </div>
        <Badge className={tierClass(score.tier)}>{tierLabel(score.tier)} · {score.brain_score}</Badge>
      </div>

      {/* Always-visible quick-review: why this trip is suspected. Lives
          outside the tabs so the user sees the reason regardless of which
          tab is active. */}
      {sortedSignals.length > 0 && (
        <section className="susp-quick-review">
          <div className="susp-quick-review-head">
            <h3 className="susp-quick-review-title">Why this trip is suspected</h3>
            <span className="susp-quick-review-count">
              {sortedSignals.length} risk pattern{sortedSignals.length === 1 ? "" : "s"} matched
            </span>
          </div>
          <ul className="susp-quick-review-list">
            {sortedSignals.slice(0, 4).map(s => (
              <li key={s.id} className="susp-quick-review-item">
                <span className="susp-quick-review-bullet" />
                {s.human_text || s.name}
              </li>
            ))}
            {sortedSignals.length > 4 && (
              <li className="susp-quick-review-more">
                + {sortedSignals.length - 4} more — see <strong>Why suspected</strong> tab
              </li>
            )}
          </ul>
          {score.similar_cases.length > 0 && score.similar_cases[0].city && (
            <div className="susp-quick-review-similar">
              Looks like a past theft in <strong>{score.similar_cases[0].city}</strong>
              {" "}— {Math.round(score.similar_cases[0].similarity * 100)}% behavioural match.
            </div>
          )}
        </section>
      )}

      {/* Tabs — Trip view only renders when GPS path is available so we
          never expose a broken/empty tab. */}
      <div className="susp-tabs">
        {hasGeo && (
          <button
            className={`susp-tab ${tab === "trip" ? "is-active" : ""}`}
            onClick={() => setTab("trip")}
          >
            Trip view
          </button>
        )}
        <button
          className={`susp-tab ${tab === "brain" ? "is-active" : ""}`}
          onClick={() => setTab("brain")}
        >
          Why suspected
        </button>
      </div>

      {tab === "trip" && hasGeo && synthRow && (
        <div className="susp-tripview">
          <TripDetail
            trip={synthRow}
            onBack={onBack}
            aliasLocation={aliasLocation}
          />
        </div>
      )}

      {tab === "brain" && (
        <>
          {/* Verdict header */}
          <header className="susp-verdict">
            <div className="susp-verdict-score-block">
              <div className="susp-verdict-score">{score.brain_score}</div>
              <Badge className={tierClass(score.tier)}>{tierLabel(score.tier)}</Badge>
            </div>
            <div className="susp-verdict-body">
              <h2 className="susp-verdict-title">Why this trip is suspected</h2>
              <p className="susp-verdict-summary">
                {sortedSignals.length > 0
                  ? `${sortedSignals.length} behavioural pattern${sortedSignals.length > 1 ? "s" : ""} from past theft cases matched on this trip.`
                  : "No specific signals fired, but the trip is on a watchlist route or context."}
              </p>
              {score.recommended_action && (
                <div className="susp-verdict-action">
                  <strong>What to do next:</strong> {score.recommended_action}
                </div>
              )}
            </div>
          </header>

          {/* Why flagged */}
          <section className="susp-section">
            <h3 className="susp-section-title">
              Why it was flagged
              <span className="susp-section-count">{sortedSignals.length}</span>
            </h3>
            {sortedSignals.length === 0 ? (
              <p className="zepto-empty">No specific patterns fired on this trip.</p>
            ) : (
              <div className="susp-reasons">
                {sortedSignals.map(s => <ReasonCard key={s.id} signal={s} />)}
              </div>
            )}
          </section>

          {/* Trip timeline */}
          <section className="susp-section">
            <h3 className="susp-section-title">Trip timeline</h3>
            <ol className="susp-timeline">
              <li className="susp-timeline-item">
                <div className="susp-timeline-label">Trip started (gate-out)</div>
                <div className="susp-timeline-time">{fmtTs(score.gate_out)}</div>
              </li>
              <li className="susp-timeline-item">
                <div className="susp-timeline-label">First GPS ping outside origin</div>
                <div className="susp-timeline-time">
                  {fmtTs(score.first_ping_outside_origin)}
                  {score.gate_out && score.first_ping_outside_origin && (
                    <span className="susp-timeline-gap">
                      · {fmtGap(score.gate_out, score.first_ping_outside_origin)}
                    </span>
                  )}
                </div>
              </li>
              <li className="susp-timeline-item">
                <div className="susp-timeline-label">Planned arrival (Google ETA)</div>
                <div className="susp-timeline-time">{fmtTs(score.google_eta)}</div>
              </li>
              <li className="susp-timeline-item">
                <div className="susp-timeline-label">
                  Arrived at destination
                  {!score.destination_entry && <span className="susp-warning"> · missing</span>}
                </div>
                <div className="susp-timeline-time">{fmtTs(score.destination_entry)}</div>
              </li>
              <li className="susp-timeline-item">
                <div className="susp-timeline-label">Trip closed</div>
                <div className="susp-timeline-time">
                  {fmtTs(score.trip_closure_time)}
                  {score.google_eta && score.trip_closure_time && (
                    <span className="susp-timeline-gap">
                      · {fmtGap(score.google_eta, score.trip_closure_time)} after planned ETA
                    </span>
                  )}
                </div>
              </li>
            </ol>
          </section>

          {/* Who & where — with drill-downs */}
          <section className="susp-section susp-identity">
            <h3 className="susp-section-title">Who & where</h3>
            <div className="susp-identity-grid">
              <button
                type="button"
                className="susp-identity-cell is-clickable"
                onClick={() => score.driver_number && setDrill({
                  kind: "Driver",
                  key: score.driver_number,
                  name: score.driver_name || score.driver_number,
                  sub: score.driver_number,
                })}
                disabled={!score.driver_number}
              >
                <div className="susp-identity-label">Driver ↗</div>
                <div className="susp-identity-value">{score.driver_name || "—"}</div>
                <div className="susp-identity-sub">{score.driver_number || ""}</div>
              </button>
              <button
                type="button"
                className="susp-identity-cell is-clickable"
                onClick={() => score.vehicle && setDrill({
                  kind: "Vehicle",
                  key: score.vehicle,
                  name: score.vehicle,
                })}
                disabled={!score.vehicle}
              >
                <div className="susp-identity-label">Vehicle ↗</div>
                <div className="susp-identity-value">{score.vehicle || "—"}</div>
              </button>
              <button
                type="button"
                className="susp-identity-cell is-clickable"
                onClick={() => score.transporter && setDrill({
                  kind: "Transporter",
                  key: score.transporter,
                  name: score.transporter,
                })}
                disabled={!score.transporter}
              >
                <div className="susp-identity-label">Transporter ↗</div>
                <div className="susp-identity-value">{score.transporter || "—"}</div>
              </button>
              <div className="susp-identity-cell">
                <div className="susp-identity-label">Origin</div>
                <div className="susp-identity-value">{aliasLocation(score.origin)}</div>
              </div>
              <div className="susp-identity-cell">
                <div className="susp-identity-label">Destination</div>
                <div className="susp-identity-value">{aliasLocation(score.destination)}</div>
              </div>
            </div>
          </section>

          {/* Stats */}
          <section className="susp-section">
            <h3 className="susp-section-title">Operational stats</h3>
            <div className="susp-stats-grid">
              <Stat label="Distance driven" value={`${distKm.toFixed(1)} km`} sub={`planned ${planKm.toFixed(1)} km`} flag={detourKm >= 15} />
              <Stat label="Extra distance" value={`${detourKm.toFixed(1)} km`} flag={detourKm >= 15} />
              <Stat label="Transit time" value={`${(score.transit_time_hrs ?? 0).toFixed(1)} h`} />
              <Stat label="Time stopped" value={`${(score.stoppage_hrs ?? 0).toFixed(1)} h`} flag={(score.stoppage_hrs ?? 0) >= 1} />
              <Stat label="Loading time" value={`${(score.loading_time_hrs ?? 0).toFixed(1)} h`} flag={(score.loading_time_hrs ?? 0) >= 3} />
              <Stat label="Unloading time" value={`${(score.unloading_time_hrs ?? 0).toFixed(2)} h`} flag={(score.unloading_time_hrs ?? 0) < 0.1 && (score.transit_time_hrs ?? 0) >= 1} />
              <Stat label="ETA breach" value={`${(score.eta_breach_hrs ?? 0).toFixed(1)} h`} flag={(score.eta_breach_hrs ?? 0) >= 4} />
              <Stat label="GPS pings" value={String(score.total_pings ?? 0)} flag={(score.total_pings ?? 0) < 50} />
              <Stat label="Tracking health" value={`${((score.tracking_health ?? 0) || 0).toFixed(0)} / 100`} flag={(score.tracking_health ?? 100) < 70} />
            </div>
            {score.alerts_text && (
              <div className="susp-alerts">
                <strong>Platform alerts during the trip:</strong> {score.alerts_text}
              </div>
            )}
          </section>

          {/* Similar past incidents */}
          <section className="susp-section">
            <h3 className="susp-section-title">
              Similar past theft incidents
              <span className="susp-section-count">{score.similar_cases.length}</span>
            </h3>
            {score.similar_cases.length === 0 ? (
              <p className="zepto-empty">No similar past incidents found.</p>
            ) : (
              <div className="susp-similars">
                {score.similar_cases.map(c => <SimilarCaseCard key={c.case_id} c={c} />)}
              </div>
            )}
          </section>
        </>
      )}

      {drill && (
        <EntityDrillModal
          kind={drill.kind}
          name={drill.name}
          subtitle={drill.sub}
          rollup={drillRollup}
          suspectedTrips={drillSuspectedTrips}
          onClose={() => setDrill(null)}
          onSelectTrip={(tid) => {
            setDrill(null);
            if (onOpenSuspectedTrip) onOpenSuspectedTrip(tid);
          }}
        />
      )}
    </div>
  );
}
