import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Skeleton } from "ft-design-system";
import { api } from "../api";
import type { Verdict } from "../types";
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
  if (hoursLeft < 0) return <Badge variant="danger">SLA breached · {Math.abs(hoursLeft).toFixed(0)}h ago</Badge>;
  if (hoursLeft < 4) return <Badge variant="warning">SLA in {hoursLeft.toFixed(1)}h</Badge>;
  return <Badge variant="neutral">SLA in {hoursLeft.toFixed(0)}h</Badge>;
}

export function Queue({ onInvestigate, onOpenInMap }: Props) {
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [, forceTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api.verdicts().then(v => { setVerdicts(v); setLoading(false); }).catch(e => { console.error(e); setLoading(false); });
  }, []);

  useEffect(() => useFindingStateChanges(() => forceTick(t => t + 1)), []);

  const states = listStates();

  const rows = useMemo(() => {
    const items = verdicts.map(v => {
      const s = getState(v.verdict_id);
      return { v, s, sla: slaHoursLeft(s) };
    });
    if (filter === "open") {
      return items.filter(it => !it.s.status.startsWith("closed"));
    }
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
      <div className="mx-auto max-w-[1240px] px-8 py-10">
        <Skeleton className="h-9 w-72 mb-2" />
        <Skeleton className="h-5 w-96 mb-8" />
        {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full mb-2" />)}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-8 py-10">
      <div className="mb-6">
        <div className="text-[11px] tracking-[0.12em] font-semibold uppercase text-[#838c9d] mb-1">Triage queue</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1a2330]">
          {counts.open} open finding{counts.open === 1 ? "" : "s"} · {counts.total - counts.open} closed
        </h1>
        <div className="mt-2 text-[13.5px] text-[#5f697b]">
          Status, owner, and SLA per finding. State is local for this pilot; Phase 3 moves it behind the FT control-room backend with audit trail visible to Zepto DE.
        </div>
      </div>

      {/* Status filter chips */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip k="open" label={`Open · ${counts.open}`} active={filter === "open"} onClick={() => setFilter("open")} />
        <FilterChip k="new" label={`${STATUS_LABELS.new} · ${counts.new}`} active={filter === "new"} onClick={() => setFilter("new")} />
        <FilterChip k="triaging" label={`${STATUS_LABELS.triaging} · ${counts.triaging}`} active={filter === "triaging"} onClick={() => setFilter("triaging")} />
        <FilterChip k="assigned" label={`${STATUS_LABELS.assigned} · ${counts.assigned}`} active={filter === "assigned"} onClick={() => setFilter("assigned")} />
        <FilterChip k="awaiting_evidence" label={`${STATUS_LABELS.awaiting_evidence} · ${counts.awaiting_evidence}`} active={filter === "awaiting_evidence"} onClick={() => setFilter("awaiting_evidence")} />
        <FilterChip k="closed_resolved" label={`Closed · resolved · ${counts.closed_resolved}`} active={filter === "closed_resolved"} onClick={() => setFilter("closed_resolved")} />
        <FilterChip k="closed_no_action" label={`Closed · no action · ${counts.closed_no_action}`} active={filter === "closed_no_action"} onClick={() => setFilter("closed_no_action")} />
        <FilterChip k="all" label={`All · ${counts.total}`} active={filter === "all"} onClick={() => setFilter("all")} />
      </div>

      {/* Rows */}
      {rows.length === 0 && (
        <Card bordered className="!bg-white">
          <div className="p-10 text-center text-[14px] text-[#838c9d]">No findings in this filter.</div>
        </Card>
      )}
      <div className="space-y-2">
        {rows.map(({ v, s, sla }) => (
          <QueueRow
            key={v.verdict_id}
            verdict={v}
            status={s.status}
            assignee={s.assignee}
            slaHrsLeft={sla}
            isOpen={openId === v.verdict_id}
            onToggle={() => setOpenId(openId === v.verdict_id ? null : v.verdict_id)}
            onInvestigate={() => onInvestigate(v)}
            onOpenInMap={() => onOpenInMap(v)}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { k: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "h-7 px-3 text-[11.5px] font-medium rounded-full border transition-colors " +
        (active
          ? "bg-[#1a2330] text-white border-[#1a2330]"
          : "bg-white text-[#5f697b] border-[#e4e7ec] hover:border-[#ced1d7]")
      }
    >
      {label}
    </button>
  );
}

function QueueRow({
  verdict: v, status, assignee, slaHrsLeft, isOpen, onToggle, onInvestigate, onOpenInMap,
}: {
  verdict: Verdict;
  status: Status;
  assignee: string | null;
  slaHrsLeft: number | null;
  isOpen: boolean;
  onToggle: () => void;
  onInvestigate: () => void;
  onOpenInMap: () => void;
}) {
  const tierVariant: "danger" | "warning" | "info" =
    v.risk_score >= 85 ? "danger" : v.risk_score >= 75 ? "warning" : "info";
  const tierLabel = v.risk_score >= 85 ? "Critical" : v.risk_score >= 75 ? "High" : "Medium";

  const s = getState(v.verdict_id);

  return (
    <Card bordered className="!bg-white">
      <div>
        <button
          onClick={onToggle}
          className="w-full text-left p-5 flex items-start gap-4 hover:bg-[#fafbfc] transition-colors"
        >
          <div className="text-[12px] font-semibold text-[#838c9d] tabular-nums w-10 pt-1 shrink-0">
            #{v.verdict_id.replace(/^v_/, "")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={tierVariant}>{tierLabel}</Badge>
              <Badge variant={statusVariant(status) as any}>{STATUS_LABELS[status]}</Badge>
              {slaBadge(slaHrsLeft)}
              {assignee && (
                <span className="text-[11.5px] text-[#838c9d]">→ <span className="text-[#434f64]">{assignee}</span></span>
              )}
              <span className="text-[10.5px] uppercase tracking-wider text-[#838c9d] ml-auto">{v.type_label}</span>
            </div>
            <div className="text-[14.5px] font-semibold text-[#1a2330] leading-snug mb-1">
              {v.headline}
            </div>
            <div className="text-[12.5px] text-[#5f697b]">
              <span className="text-[#1a2330] font-medium">{v.stats.count}</span> halts ·{" "}
              <span className="text-[#1a2330] font-medium">{v.stats.median_duration_hrs.toFixed(1)} hr</span> median ·{" "}
              <span className="text-[#1a2330] font-medium">{Math.round(v.stats.night_share * 100)}%</span> overnight
              {" · "}POI {v.location.nearest_poi_name || "Unmapped"}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[22px] font-semibold tabular-nums text-[#1a2330] leading-none">{v.risk_score}</div>
            <div className="text-[10px] uppercase tracking-wider text-[#838c9d] mt-1">Risk · 100</div>
          </div>
        </button>

        {isOpen && (
          <div className="px-5 pb-5 pt-1 border-t border-[#f0f1f7]">
            <div className="grid grid-cols-[1fr_320px] gap-6 mt-4">
              <div>
                <div className="text-[13px] leading-relaxed text-[#434f64] mb-4">{v.narrative}</div>

                <div className="text-[11.5px] uppercase tracking-wider font-semibold text-[#5f697b] mb-2">Recommended next step</div>
                <div className="text-[13px] text-[#1a2330] mb-4 px-4 py-3 bg-[#fff8e1] border border-[#FFBE07]/30 rounded">
                  {v.recommended_action}
                </div>

                <div className="flex flex-wrap gap-2 mb-5">
                  <Button variant="primary" size="sm" onClick={onInvestigate}>Investigate</Button>
                  <Button variant="secondary" size="sm" onClick={onOpenInMap}>Open in map</Button>
                  <a
                    className="inline-flex items-center h-9 px-3 text-[13px] font-medium border border-[#e4e7ec] text-[#434f64] rounded-md hover:border-[#ced1d7] hover:text-[#1a2330]"
                    href={`https://www.google.com/maps/search/?api=1&query=${v.location.lat.toFixed(6)},${v.location.lng.toFixed(6)}`}
                    target="_blank" rel="noopener noreferrer"
                  >
                    Google Maps ↗
                  </a>
                </div>

                {s.actions_taken.length > 0 && (
                  <div>
                    <div className="text-[11.5px] uppercase tracking-wider font-semibold text-[#5f697b] mb-2">Audit log</div>
                    <ol className="space-y-1.5 text-[12px] text-[#5f697b]">
                      {[...s.actions_taken].reverse().slice(0, 10).map((a, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="text-[#838c9d] tabular-nums w-36 shrink-0">{fmtIST(a.ts)}</span>
                          <span>
                            <span className="text-[#434f64] font-medium">{a.by}</span> · {a.type.replace(/_/g, " ")}
                            {a.details && (
                              <span className="text-[#838c9d]">{" "}({Object.entries(a.details).map(([k, val]) => `${k}: ${String(val).slice(0, 40)}`).join(", ")})</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <ActionPanel verdictId={v.verdict_id} currentStatus={status} currentAssignee={assignee} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ActionPanel({ verdictId, currentStatus, currentAssignee }: {
  verdictId: string; currentStatus: Status; currentAssignee: string | null;
}) {
  const [assignee, setAssignee] = useState(currentAssignee || assigneeOptions()[0]);

  const isClosed = currentStatus.startsWith("closed");

  return (
    <Card bordered className="!bg-[#fafbfc]">
      <div className="p-4 space-y-4">
        <div>
          <div className="text-[11.5px] uppercase tracking-wider font-semibold text-[#5f697b] mb-2">Status</div>
          <div className="space-y-1.5">
            {(["new", "triaging", "awaiting_evidence"] as Status[]).map(s => (
              <button
                key={s}
                disabled={isClosed}
                onClick={() => setStatus(verdictId, s)}
                className={
                  "w-full text-left px-3 py-1.5 rounded text-[12.5px] border transition-colors " +
                  (currentStatus === s
                    ? "bg-[#1a2330] text-white border-[#1a2330]"
                    : "bg-white text-[#434f64] border-[#e4e7ec] hover:border-[#ced1d7] disabled:opacity-50")
                }
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11.5px] uppercase tracking-wider font-semibold text-[#5f697b] mb-2">Assign</div>
          <select
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            disabled={isClosed}
            className="w-full h-8 px-2 text-[12.5px] border border-[#e4e7ec] rounded bg-white text-[#434f64] disabled:opacity-50"
          >
            {assigneeOptions().map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <Button
            variant="secondary"
            size="sm"
            disabled={isClosed}
            onClick={() => assign(verdictId, assignee)}
            className="!mt-2 !w-full"
          >
            Assign · SLA 24h
          </Button>
        </div>

        <div>
          <div className="text-[11.5px] uppercase tracking-wider font-semibold text-[#5f697b] mb-2">Snooze</div>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" disabled={isClosed} onClick={() => snooze(verdictId, 24)}>1d</Button>
            <Button variant="ghost" size="sm" disabled={isClosed} onClick={() => snooze(verdictId, 72)}>3d</Button>
            <Button variant="ghost" size="sm" disabled={isClosed} onClick={() => snooze(verdictId, 168)}>1w</Button>
          </div>
        </div>

        <div>
          <div className="text-[11.5px] uppercase tracking-wider font-semibold text-[#5f697b] mb-2">Close</div>
          <div className="space-y-1.5">
            <Button
              variant="primary"
              size="sm"
              disabled={isClosed}
              onClick={() => close(verdictId, "resolved")}
              className="!w-full"
            >
              Resolved
            </Button>
            <Button
              variant="text"
              size="sm"
              disabled={isClosed}
              onClick={() => close(verdictId, "no_action")}
              className="!w-full"
            >
              No action taken
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
