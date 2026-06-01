import { useEffect, useMemo, useState } from "react";
import { Badge, Button } from "ft-design-system";
import { api } from "../api";
import type { BrainScore, BrainSignal, BrainSimilarCase } from "../types";

interface Props {
  tripId: string;
  onBack: () => void;
}

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
  if (tier === "high") return "HIGH RISK";
  if (tier === "medium") return "MEDIUM RISK";
  return "LOW RISK";
}

function tierClass(tier: BrainScore["tier"]): string {
  if (tier === "high") return "is-critical";
  if (tier === "medium") return "is-medium";
  return "is-low";
}

function aliasLocation(s?: string): string {
  if (!s) return "—";
  // strip the leading site code, keep the human part
  const tail = s.includes(" - ") ? s.split(" - ").slice(1).join(" - ") : s;
  return tail || s;
}

// One reason card. Click to expand the raw evidence values.
function ReasonCard({ signal }: { signal: BrainSignal }) {
  const [open, setOpen] = useState(false);
  const evidenceEntries = Object.entries(signal.evidence ?? {});
  return (
    <div className="susp-reason">
      <div className="susp-reason-head">
        <div className="susp-reason-text">{signal.human_text || signal.name}</div>
        <Badge className="is-low">+{signal.weight} pts</Badge>
      </div>
      {evidenceEntries.length > 0 && (
        <button className="susp-reason-toggle" onClick={() => setOpen(!open)}>
          {open ? "Hide details" : "What the system saw"}
        </button>
      )}
      {open && evidenceEntries.length > 0 && (
        <dl className="susp-reason-evidence">
          {evidenceEntries.map(([k, v]) => (
            <div key={k} className="susp-reason-evidence-row">
              <dt>{k.replace(/_/g, " ")}</dt>
              <dd>{String(v)}</dd>
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

export function SuspectedTripDetail({ tripId, onBack }: Props) {
  const [score, setScore] = useState<BrainScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.brainScores()
      .then(file => {
        const hit = file.scores.find(s => s.trip_id === tripId) ?? null;
        if (!hit) setError(`Trip ${tripId} not in brain scores`);
        setScore(hit);
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

  return (
    <div className="z-container susp-page">
      {/* Top bar */}
      <div className="susp-topbar">
        <Button variant="secondary" size="sm" onClick={onBack}>← Back to review</Button>
        <div className="susp-topbar-trip">Trip {score.trip_id}</div>
      </div>

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

      {/* Why flagged — reasons in plain English, click to expand evidence */}
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
              {score.closure_mode && (
                <span className="susp-timeline-gap"> · {score.closure_mode}</span>
              )}
            </div>
          </li>
        </ol>
      </section>

      {/* Identity */}
      <section className="susp-section susp-identity">
        <h3 className="susp-section-title">Who & where</h3>
        <div className="susp-identity-grid">
          <div className="susp-identity-cell">
            <div className="susp-identity-label">Driver</div>
            <div className="susp-identity-value">{score.driver_name || "—"}</div>
            <div className="susp-identity-sub">{score.driver_number || ""}</div>
          </div>
          <div className="susp-identity-cell">
            <div className="susp-identity-label">Vehicle</div>
            <div className="susp-identity-value">{score.vehicle || "—"}</div>
          </div>
          <div className="susp-identity-cell">
            <div className="susp-identity-label">Transporter</div>
            <div className="susp-identity-value">{score.transporter || "—"}</div>
          </div>
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

      {/* Operational stats */}
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
