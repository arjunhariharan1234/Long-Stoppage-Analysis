import { useEffect, useMemo, useState } from "react";
import { Badge, Button } from "ft-design-system";
import { api } from "../api";
import type { Verdict, BrainScore } from "../types";
import {
  STATUS_LABELS, statusVariant, getState, listStates, assign, snooze,
  close, setStatus, assigneeOptions, slaHoursLeft, useFindingStateChanges,
  type Status,
} from "../findingState";

type StatusFilter = "open" | "all" | Status;

interface Props {
  onInvestigate: (v: Verdict) => void;
  onOpenInMap: (v: Verdict) => void;
}

function fmtIST(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function slaBadge(hoursLeft: number | null) {
  if (hoursLeft == null) return null;
  if (hoursLeft < 0) return <Badge variant="danger">SLA breached</Badge>;
  if (hoursLeft < 4) return <Badge variant="warning">SLA in {hoursLeft.toFixed(1)}h</Badge>;
  return <Badge variant="neutral">SLA in {hoursLeft.toFixed(0)}h</Badge>;
}

function pickBrainForVerdict(v: Verdict, brainByTrip: Map<string, BrainScore>): BrainScore | null {
  let best: BrainScore | null = null;
  for (const ev of v.evidence) {
    const b = brainByTrip.get(ev.trip_id);
    if (!b) continue;
    if (!best || b.brain_score > best.brain_score) best = b;
  }
  return best;
}

export function Queue({ onInvestigate, onOpenInMap }: Props) {
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [, forceTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [brainByTrip, setBrainByTrip] = useState<Map<string, BrainScore>>(new Map());

  useEffect(() => {
    api.verdicts().then(v => { setVerdicts(v); setLoading(false); }).catch(e => { console.error(e); setLoading(false); });
    api.brainScores()
      .then(file => {
        const m = new Map<string, BrainScore>();
        for (const s of file.scores) m.set(s.trip_id, s);
        setBrainByTrip(m);
      })
      .catch(() => setBrainByTrip(new Map()));
  }, []);

  useEffect(() => useFindingStateChanges(() => forceTick(t => t + 1)), []);

  const states = listStates();

  const rows = useMemo(() => {
    const items = verdicts.map(v => {
      const s = getState(v.verdict_id);
      return { v, s, sla: slaHoursLeft(s) };
    });
    if (filter === "open") return items.filter(it => !it.s.status.startsWith("closed"));
    if (filter === "all") return items;
    return items.filter(it => it.s.status === filter);
  }, [verdicts, filter, states]);

  const counts = useMemo(() => {
    const c = { open: 0, new: 0, triaging: 0, assigned: 0, awaiting_evidence: 0, closed_resolved: 0, closed_no_action: 0, total: verdicts.length };
    for (const v of verdicts) {
      const s = getState(v.verdict_id);
      c[s.status] += 1;
      if (!s.status.startsWith("closed")) c.open += 1;
    }
    return c;
  }, [verdicts, states]);

  if (loading) {
    return (
      <div className="z-container z-page">
        <div style={{ height: 32, width: 280, background: "#f0f1f7", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 18, width: 400, background: "#f0f1f7", borderRadius: 4, marginBottom: 48 }} />
        {[0,1,2,3,4].map(i => <div key={i} style={{ height: 88, background: "#f0f1f7", borderRadius: 8, marginBottom: 8 }} />)}
      </div>
    );
  }

  return (
    <div className="z-container z-page">
      {/* Status filter chips */}
      <div className="z-chip-row">
        <FilterChip label={`Open · ${counts.open}`} active={filter === "open"} onClick={() => setFilter("open")} />
        <FilterChip label={`${STATUS_LABELS.new} · ${counts.new}`} active={filter === "new"} onClick={() => setFilter("new")} />
        <FilterChip label={`${STATUS_LABELS.triaging} · ${counts.triaging}`} active={filter === "triaging"} onClick={() => setFilter("triaging")} />
        <FilterChip label={`${STATUS_LABELS.assigned} · ${counts.assigned}`} active={filter === "assigned"} onClick={() => setFilter("assigned")} />
        <FilterChip label={`Awaiting · ${counts.awaiting_evidence}`} active={filter === "awaiting_evidence"} onClick={() => setFilter("awaiting_evidence")} />
        <FilterChip label={`Resolved · ${counts.closed_resolved}`} active={filter === "closed_resolved"} onClick={() => setFilter("closed_resolved")} />
        <FilterChip label={`No action · ${counts.closed_no_action}`} active={filter === "closed_no_action"} onClick={() => setFilter("closed_no_action")} />
        <FilterChip label={`All · ${counts.total}`} active={filter === "all"} onClick={() => setFilter("all")} />
      </div>

      {rows.length === 0 ? (
        <div className="z-empty">No findings in this filter.</div>
      ) : (
        <div className="z-panel z-panel-list">
          {rows.map(({ v, s, sla }) => (
            <QueueRow
              key={v.verdict_id}
              verdict={v}
              status={s.status}
              assignee={s.assignee}
              slaHrsLeft={sla}
              brain={pickBrainForVerdict(v, brainByTrip)}
              isOpen={openId === v.verdict_id}
              onToggle={() => setOpenId(openId === v.verdict_id ? null : v.verdict_id)}
              onInvestigate={() => onInvestigate(v)}
              onOpenInMap={() => onOpenInMap(v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={"z-chip" + (active ? " is-active" : "")}>
      {label}
    </button>
  );
}

function QueueRow({
  verdict: v, status, assignee, slaHrsLeft, brain, isOpen, onToggle, onInvestigate, onOpenInMap,
}: {
  verdict: Verdict; status: Status; assignee: string | null; slaHrsLeft: number | null;
  brain: BrainScore | null;
  isOpen: boolean; onToggle: () => void; onInvestigate: () => void; onOpenInMap: () => void;
}) {
  const tierVariant: "danger" | "warning" | "info" =
    v.risk_score >= 85 ? "danger" : v.risk_score >= 75 ? "warning" : "info";
  const tierLabel = v.risk_score >= 85 ? "Critical" : v.risk_score >= 75 ? "High" : "Medium";

  const s = getState(v.verdict_id);

  return (
    <div>
      <div className="z-finding is-expandable" onClick={onToggle}>
        <div className="z-finding-rank">#{v.verdict_id.replace(/^v_/, "")}</div>
        <div className="z-finding-body">
          <div className="z-finding-badges">
            <Badge variant={tierVariant}>{tierLabel}</Badge>
            <Badge variant={statusVariant(status) as any}>{STATUS_LABELS[status]}</Badge>
            {slaBadge(slaHrsLeft)}
            {brain && (() => {
              const cls = brain.tier === "high" ? "is-critical" : brain.tier === "medium" ? "is-medium" : "is-low";
              return (
                <span
                  className={`brain-pill ${cls}`}
                  title={`Brain ${brain.brain_score} · ${brain.matched_signals.map(s => s.id).join(", ")}`}
                >
                  Brain {brain.brain_score}
                </span>
              );
            })()}
            {assignee && (
              <span style={{ fontSize: 12, color: "#838c9d" }}>
                → <span style={{ color: "#434f64" }}>{assignee}</span>
              </span>
            )}
            <span className="z-finding-type" style={{ marginLeft: "auto" }}>{v.type_label}</span>
          </div>
          <div className="z-finding-headline">{v.headline}</div>
          <div className="z-finding-meta">
            <span><strong>{v.stats.count}</strong> halts</span>
            <span><strong>{v.stats.median_duration_hrs.toFixed(1)} hr</strong> median</span>
            <span><strong>{Math.round(v.stats.night_share * 100)}%</strong> overnight</span>
            <span className="z-finding-sep">·</span>
            <span className="z-finding-poi">POI {v.location.nearest_poi_name || "Unmapped"}</span>
          </div>
        </div>
        <div className="z-finding-right">
          <div className="z-finding-score">
            <div className="z-finding-score-num">{v.risk_score}</div>
            <div className="z-finding-score-label">Risk · 100</div>
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="z-finding-detail" onClick={e => e.stopPropagation()}>
          <div>
            <div className="z-finding-narrative">{v.narrative}</div>

            <div className="z-finding-recco-label">Recommended next step</div>
            <div className="z-finding-recco">{v.recommended_action}</div>

            <div className="z-finding-action-bar">
              <Button variant="primary" size="sm" onClick={onInvestigate}>Investigate</Button>
              <Button variant="secondary" size="sm" onClick={onOpenInMap}>Open in map</Button>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${v.location.lat.toFixed(6)},${v.location.lng.toFixed(6)}`}
                target="_blank" rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", height: 32, padding: "0 12px",
                  fontSize: 13, fontWeight: 500, color: "#434f64",
                  border: "1px solid #e4e7ec", borderRadius: 4, background: "#fff", textDecoration: "none",
                }}
              >
                Google Maps ↗
              </a>
            </div>

            {s.actions_taken.length > 0 && (
              <>
                <div className="z-finding-recco-label">Audit log</div>
                <ol className="z-audit">
                  {[...s.actions_taken].reverse().slice(0, 10).map((a, i) => (
                    <li key={i} className="z-audit-row">
                      <span className="z-audit-time">{fmtIST(a.ts)}</span>
                      <span>
                        <span className="z-audit-by">{a.by}</span> · {a.type.replace(/_/g, " ")}
                        {a.details && (
                          <span className="z-audit-details">
                            {" "}({Object.entries(a.details).map(([k, val]) => `${k}: ${String(val).slice(0, 40)}`).join(", ")})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>

          <ActionPanel verdictId={v.verdict_id} currentStatus={status} currentAssignee={assignee} />
        </div>
      )}
    </div>
  );
}

function ActionPanel({ verdictId, currentStatus, currentAssignee }: {
  verdictId: string; currentStatus: Status; currentAssignee: string | null;
}) {
  const [assignee, setAssignee] = useState(currentAssignee || assigneeOptions()[0]);
  const isClosed = currentStatus.startsWith("closed");

  return (
    <div className="z-action-panel">
      <div className="z-action-panel-section">
        <div className="z-action-panel-label">Status</div>
        {(["new", "triaging", "awaiting_evidence"] as Status[]).map(s => (
          <button
            key={s}
            disabled={isClosed}
            onClick={() => setStatus(verdictId, s)}
            className={"z-status-btn" + (currentStatus === s ? " is-active" : "")}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="z-action-panel-section">
        <div className="z-action-panel-label">Assign</div>
        <select
          value={assignee}
          onChange={e => setAssignee(e.target.value)}
          disabled={isClosed}
          className="z-select"
        >
          {assigneeOptions().map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <Button
          variant="secondary" size="sm" disabled={isClosed}
          onClick={() => assign(verdictId, assignee)}
          className="!w-full"
        >
          Assign · SLA 24h
        </Button>
      </div>

      <div className="z-action-panel-section">
        <div className="z-action-panel-label">Snooze</div>
        <div className="z-snooze-row">
          <Button variant="ghost" size="sm" disabled={isClosed} onClick={() => snooze(verdictId, 24)}>1d</Button>
          <Button variant="ghost" size="sm" disabled={isClosed} onClick={() => snooze(verdictId, 72)}>3d</Button>
          <Button variant="ghost" size="sm" disabled={isClosed} onClick={() => snooze(verdictId, 168)}>1w</Button>
        </div>
      </div>

      <div className="z-action-panel-section">
        <div className="z-action-panel-label">Close</div>
        <Button variant="primary" size="sm" disabled={isClosed} onClick={() => close(verdictId, "resolved")} className="!w-full">
          Resolved
        </Button>
        <Button variant="text" size="sm" disabled={isClosed} onClick={() => close(verdictId, "no_action")} className="!w-full">
          No action taken
        </Button>
      </div>
    </div>
  );
}
