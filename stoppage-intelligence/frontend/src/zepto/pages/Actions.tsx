import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  DriverRollup, VehicleRollup, TransporterRollup,
} from "../types";
import {
  ActionKind, FTAction, REASON_CODES, listActions, liftAction,
  measureOutcome, aggregateImpact, subscribe,
} from "../lib/actionsStore";
import { ActionModal } from "../components/ActionModal";
import { Sparkline } from "../components/Sparkline";

function fmt(n: number) { return n.toLocaleString("en-IN"); }
function fmtINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const KIND_LABEL: Record<ActionKind, string> = {
  blacklist_driver: "Driver",
  blacklist_transporter: "Transporter",
  blacklist_vehicle: "Vehicle",
  redzone: "Redzone",
};

function reasonLabel(kind: ActionKind, code: string): string {
  return REASON_CODES[kind].find(r => r.code === code)?.label || code;
}

export function Actions() {
  const [drivers, setDrivers] = useState<DriverRollup[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRollup[]>([]);
  const [transporters, setTransporters] = useState<TransporterRollup[]>([]);
  const [actions, setActions] = useState<FTAction[]>([]);
  const [modalKind, setModalKind] = useState<ActionKind | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.drivers(), api.vehicles(), api.transporters()])
      .then(([d, v, t]) => { setDrivers(d); setVehicles(v); setTransporters(t); })
      .catch(e => console.error(e));
    setActions(listActions());
    return subscribe(() => setActions(listActions()));
  }, []);

  const impact = useMemo(() => aggregateImpact(actions), [actions]);
  const active = useMemo(() => actions.filter(a => a.status === "active"), [actions]);
  const history = useMemo(() => actions.filter(a => a.status !== "active"), [actions]);

  function effPillClass(pct: number): string {
    if (pct === 0) return "is-zero";
    if (pct >= 70) return "is-high";
    if (pct >= 40) return "is-mid";
    return "is-low";
  }

  return (
    <div className="z-container z-page">
      {/* Take action + impact */}
      <div className="z-action-hero">
        <div className="z-action-take">
          <h2 className="z-action-take-title">Take an action</h2>
          <p className="z-action-take-sub">
            Mitigate risk you've identified. Actions are reversible and tracked — every blacklist and redzone
            measures its own effectiveness over time.
          </p>
          <div className="z-action-take-buttons">
            <button className="z-action-cta" onClick={() => setModalKind("blacklist_driver")}>
              <span className="z-action-cta-icon">D</span>
              <span className="z-action-cta-title">Blacklist driver</span>
              <span className="z-action-cta-sub">Flag a driver across the platform</span>
            </button>
            <button className="z-action-cta" onClick={() => setModalKind("blacklist_transporter")}>
              <span className="z-action-cta-icon">T</span>
              <span className="z-action-cta-title">Blacklist transporter</span>
              <span className="z-action-cta-sub">Escalate findings for an entire fleet</span>
            </button>
            <button className="z-action-cta" onClick={() => setModalKind("redzone")}>
              <span className="z-action-cta-icon">Z</span>
              <span className="z-action-cta-title">Mark redzone</span>
              <span className="z-action-cta-sub">Auto-escalate halts inside a geographic zone</span>
            </button>
          </div>
        </div>

        <div className="z-impact-row" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          <div className="z-impact-tile">
            <div className="z-impact-label">Active actions</div>
            <div className="z-impact-value">{impact.total_active}</div>
            <div className="z-impact-sub">{impact.total_lifted} lifted</div>
          </div>
          <div className="z-impact-tile">
            <div className="z-impact-label">Avg effectiveness</div>
            <div className="z-impact-value">{impact.avg_effectiveness_pct}%</div>
            <div className="z-impact-sub">% reduction vs baseline</div>
          </div>
          <div className="z-impact-tile">
            <div className="z-impact-label">Halts prevented</div>
            <div className="z-impact-value z-impact-good">{fmt(impact.prevented_halts)}</div>
            <div className="z-impact-sub">across all active actions</div>
          </div>
          <div className="z-impact-tile">
            <div className="z-impact-label">Exposure addressed</div>
            <div className="z-impact-value z-impact-good">{fmtINR(impact.prevented_exposure_inr)}</div>
            <div className="z-impact-sub">est. cargo value prevented</div>
          </div>
        </div>
      </div>

      {/* Active actions table */}
      <div className="z-section-row" style={{ marginBottom: 12 }}>
        <span className="z-section-row-title">Active actions</span>
        <span className="z-section-row-sub">Click any row to inspect outcome + audit log</span>
      </div>
      {active.length === 0 ? (
        <div className="z-action-empty">
          No active actions yet. Use the buttons above, or click <strong>Blacklist</strong> from any
          driver / vehicle / transporter detail in Investigate.
        </div>
      ) : (
        <div className="z-action-table">
          <div className="z-action-table-head">
            <div></div>
            <div>Target</div>
            <div>Reason</div>
            <div>Taken</div>
            <div>Effectiveness</div>
            <div>Status</div>
            <div></div>
          </div>
          {active.map(a => {
            const outcome = measureOutcome(a);
            const isOpen = expandedId === a.id;
            return (
              <div key={a.id}>
                <button className="z-action-row" onClick={() => setExpandedId(isOpen ? null : a.id)}>
                  <div className="z-action-row-kind">
                    <span style={{
                      width: 8, height: 8, borderRadius: 2,
                      background: a.kind === "redzone" ? "#d92d20" : a.kind === "blacklist_transporter" ? "#FFBE07" : "#1a2330",
                    }} />
                  </div>
                  <div>
                    <div className="z-action-row-target">{a.target.label}</div>
                    <div className="z-action-row-target-sub">
                      {KIND_LABEL[a.kind]}{a.target.sub ? ` · ${a.target.sub}` : ""}
                    </div>
                  </div>
                  <div className="z-action-reason">
                    {reasonLabel(a.kind, a.reason_code)}
                    {a.reason_note && <span className="z-action-reason-code">{a.reason_note.slice(0, 60)}{a.reason_note.length > 60 ? "…" : ""}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#434f64" }}>
                    {fmtDate(a.taken_at)}
                    <div style={{ fontSize: 11.5, color: "#838c9d", marginTop: 2 }}>
                      {outcome.weeksActive < 1 ? "this week" : `${outcome.weeksActive}w ago`}
                    </div>
                  </div>
                  <div>
                    <span className={"z-action-eff-pill " + effPillClass(outcome.effectiveness_pct)}>
                      {outcome.effectiveness_pct === 0 ? "measuring…" : `${Math.round(outcome.effectiveness_pct)}% ↓`}
                    </span>
                  </div>
                  <div>
                    <span className="z-action-status-pill is-active">
                      <span className="z-action-status-dot" />
                      {a.severity}
                    </span>
                  </div>
                  <div className="z-action-row-chev">{isOpen ? "▴" : "▾"}</div>
                </button>
                {isOpen && <ActionDetail action={a} outcome={outcome} onLift={() => setExpandedId(null)} />}
              </div>
            );
          })}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <>
          <div className="z-section-divider">
            <div className="z-section-row" style={{ marginBottom: 12 }}>
              <span className="z-section-row-title">History · lifted &amp; expired</span>
              <span className="z-section-row-sub">{history.length} action{history.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="z-action-table">
            <div className="z-action-table-head">
              <div></div>
              <div>Target</div>
              <div>Reason</div>
              <div>Taken</div>
              <div>Final effect</div>
              <div>Status</div>
              <div></div>
            </div>
            {history.map(a => {
              const outcome = measureOutcome(a);
              return (
                <div key={a.id} className="z-action-row" style={{ opacity: 0.75 }}>
                  <div className="z-action-row-kind">
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: "#a7afb9" }} />
                  </div>
                  <div>
                    <div className="z-action-row-target">{a.target.label}</div>
                    <div className="z-action-row-target-sub">{KIND_LABEL[a.kind]}</div>
                  </div>
                  <div className="z-action-reason">{reasonLabel(a.kind, a.reason_code)}</div>
                  <div style={{ fontSize: 12.5, color: "#434f64" }}>{fmtDate(a.taken_at)}</div>
                  <div>
                    <span className={"z-action-eff-pill " + effPillClass(outcome.effectiveness_pct)}>
                      {Math.round(outcome.effectiveness_pct)}%
                    </span>
                  </div>
                  <div>
                    <span className={"z-action-status-pill is-" + a.status}>
                      <span className="z-action-status-dot" />
                      {a.status}
                    </span>
                  </div>
                  <div></div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal */}
      {modalKind && (
        <ActionModal
          kind={modalKind}
          drivers={drivers}
          vehicles={vehicles}
          transporters={transporters}
          onClose={() => setModalKind(null)}
        />
      )}
    </div>
  );
}

function ActionDetail({ action, outcome, onLift }: {
  action: FTAction;
  outcome: ReturnType<typeof measureOutcome>;
  onLift: () => void;
}) {
  const [showLift, setShowLift] = useState(false);
  const [liftReason, setLiftReason] = useState("");

  function confirmLift() {
    liftAction(action.id, liftReason || "(no reason given)");
    onLift();
  }

  // Combined series for the sparkline — baseline 6 weeks + post-action weeks
  const series = [...outcome.baseSeries, ...outcome.postSeries];

  return (
    <div className="z-action-detail">
      <div>
        <h4>Why this action</h4>
        <div className="z-action-detail-meta" style={{ marginBottom: 16 }}>
          <strong>{action.target.label}</strong> · {reasonLabel(action.kind, action.reason_code)} · severity <strong>{action.severity}</strong>
          {action.reason_note && <div style={{ marginTop: 6 }}>{action.reason_note}</div>}
        </div>

        {action.evidence.length > 0 && (
          <>
            <h4>Evidence</h4>
            <ul className="z-action-evidence-list" style={{ marginBottom: 16 }}>
              {action.evidence.map((e, i) => (
                <li key={i}>
                  <span className="z-action-evidence-kind">{e.kind}</span>
                  <span>{e.label}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <h4>Audit trail</h4>
        <ul className="z-action-audit">
          {[...action.audit].reverse().map((entry, i) => (
            <li key={i}>
              <span className="z-action-audit-time">{fmtDateTime(entry.ts)}</span>
              <span>
                <strong style={{ color: "#1a2330", fontWeight: 600 }}>{entry.by}</strong> · {entry.action}
                {entry.detail && <span style={{ color: "#838c9d" }}> — {entry.detail}</span>}
              </span>
            </li>
          ))}
        </ul>

        {!showLift ? (
          <div className="z-action-detail-buttons">
            <button className="z-btn-secondary" onClick={() => setShowLift(true)}>Lift action</button>
          </div>
        ) : (
          <div style={{ marginTop: 16, padding: 14, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6 }}>
            <div className="z-form-row" style={{ marginBottom: 10 }}>
              <label className="z-form-label">Lift reason</label>
              <textarea
                className="z-form-textarea"
                value={liftReason}
                onChange={e => setLiftReason(e.target.value)}
                placeholder="Why is this being lifted? e.g. driver completed retraining; transporter rectified SLA; zone secured."
                autoFocus
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="z-btn-secondary" onClick={() => setShowLift(false)}>Cancel</button>
              <button className="z-btn-primary is-destructive" onClick={confirmLift}>Confirm lift</button>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="z-action-outcome">
          <div className="z-action-outcome-head">
            <span className="z-action-outcome-title">Outcome — last 6 + {outcome.postSeries.length} weeks</span>
          </div>
          <Sparkline
            values={series}
            width={280}
            height={56}
            stroke="#1a2330"
            fill="rgba(26,35,48,0.06)"
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6, fontSize: 10, color: "#838c9d", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            <span>Baseline</span>
            <span style={{ textAlign: "right" }}>Post-action</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="z-action-outcome-row">
              <span>Halts prevented</span>
              <strong>{fmt(outcome.prevented_halts)}</strong>
            </div>
            <div className="z-action-outcome-row">
              <span>Exposure prevented</span>
              <strong>{fmtINR(outcome.prevented_exposure_inr)}</strong>
            </div>
            <div className="z-action-outcome-row">
              <span>Effectiveness</span>
              <strong>{Math.round(outcome.effectiveness_pct)}% reduction</strong>
            </div>
            <div className="z-action-outcome-row">
              <span>Active duration</span>
              <strong>{outcome.weeksActive === 0 ? "&lt; 1 week" : `${outcome.weeksActive} weeks`}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
