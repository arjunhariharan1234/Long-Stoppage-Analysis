// Local-only finding state. Phase 1 ships as a browser-local store so the workflow
// is demoable; Phase 3 moves this behind the FastAPI backend.

export type Status =
  | "new"
  | "triaging"
  | "assigned"
  | "awaiting_evidence"
  | "closed_resolved"
  | "closed_no_action";

export interface ActionEntry {
  type: "assigned" | "snoozed" | "status_changed" | "comment" | "closed";
  by: string;
  ts: string;
  details?: Record<string, unknown>;
}

export interface FindingState {
  verdict_id: string;
  status: Status;
  assignee: string | null;
  due_at: string | null;
  snoozed_until: string | null;
  comments: { by: string; ts: string; body: string }[];
  actions_taken: ActionEntry[];
}

const LS_KEY = "zepto.finding_state.v1";
const ME = "you@freighttiger.com";

const ASSIGNEES = [
  "ops.lead@zepto.com",
  "security@zepto.com",
  "de.team@zepto.com",
  "ft.product@freighttiger.com",
  "ft.controltower@freighttiger.com",
];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  triaging: "Triaging",
  assigned: "Assigned",
  awaiting_evidence: "Awaiting evidence",
  closed_resolved: "Closed · resolved",
  closed_no_action: "Closed · no action",
};

export function statusVariant(s: Status): "info" | "warning" | "success" | "neutral" | "danger" | "default" {
  if (s === "new") return "info";
  if (s === "triaging") return "warning";
  if (s === "assigned") return "warning";
  if (s === "awaiting_evidence") return "neutral";
  if (s === "closed_resolved") return "success";
  if (s === "closed_no_action") return "default";
  return "default";
}

function nowIso() {
  return new Date().toISOString();
}

function loadAll(): Record<string, FindingState> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(map: Record<string, FindingState>) {
  localStorage.setItem(LS_KEY, JSON.stringify(map));
}

export function getState(verdict_id: string): FindingState {
  const map = loadAll();
  if (map[verdict_id]) return map[verdict_id];
  return {
    verdict_id,
    status: "new",
    assignee: null,
    due_at: null,
    snoozed_until: null,
    comments: [],
    actions_taken: [],
  };
}

export function listStates(): Record<string, FindingState> {
  return loadAll();
}

function persist(state: FindingState) {
  const map = loadAll();
  map[state.verdict_id] = state;
  saveAll(map);
  // notify listeners
  window.dispatchEvent(new CustomEvent("zepto-finding-state-changed", { detail: state.verdict_id }));
}

export function setStatus(verdict_id: string, status: Status, note?: string): FindingState {
  const cur = getState(verdict_id);
  const next: FindingState = {
    ...cur,
    status,
    actions_taken: [...cur.actions_taken, {
      type: "status_changed",
      by: ME,
      ts: nowIso(),
      details: { to: status, note },
    }],
  };
  persist(next);
  return next;
}

export function assign(verdict_id: string, to: string): FindingState {
  const cur = getState(verdict_id);
  const slaHours = 24; // default SLA, phase 3 will tier this
  const due = new Date(Date.now() + slaHours * 3600_000).toISOString();
  const next: FindingState = {
    ...cur,
    status: "assigned",
    assignee: to,
    due_at: due,
    actions_taken: [...cur.actions_taken, {
      type: "assigned",
      by: ME,
      ts: nowIso(),
      details: { to, due_at: due },
    }],
  };
  persist(next);
  return next;
}

export function snooze(verdict_id: string, hours: number): FindingState {
  const cur = getState(verdict_id);
  const until = new Date(Date.now() + hours * 3600_000).toISOString();
  const next: FindingState = {
    ...cur,
    snoozed_until: until,
    actions_taken: [...cur.actions_taken, {
      type: "snoozed",
      by: ME,
      ts: nowIso(),
      details: { until },
    }],
  };
  persist(next);
  return next;
}

export function comment(verdict_id: string, body: string): FindingState {
  const cur = getState(verdict_id);
  const c = { by: ME, ts: nowIso(), body };
  const next: FindingState = {
    ...cur,
    comments: [...cur.comments, c],
    actions_taken: [...cur.actions_taken, { type: "comment", by: ME, ts: nowIso() }],
  };
  persist(next);
  return next;
}

export function close(verdict_id: string, resolution: "resolved" | "no_action", note?: string): FindingState {
  const cur = getState(verdict_id);
  const next: FindingState = {
    ...cur,
    status: resolution === "resolved" ? "closed_resolved" : "closed_no_action",
    actions_taken: [...cur.actions_taken, {
      type: "closed",
      by: ME,
      ts: nowIso(),
      details: { resolution, note },
    }],
  };
  persist(next);
  return next;
}

export function assigneeOptions() {
  return ASSIGNEES;
}

export function slaHoursLeft(state: FindingState): number | null {
  if (!state.due_at) return null;
  const diffMs = new Date(state.due_at).getTime() - Date.now();
  return diffMs / 3600_000;
}

export function useFindingStateChanges(onChange: () => void) {
  if (typeof window !== "undefined") {
    window.addEventListener("zepto-finding-state-changed", onChange);
  }
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("zepto-finding-state-changed", onChange);
    }
  };
}
