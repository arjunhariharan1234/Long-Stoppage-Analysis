// localStorage-backed actions store. Phase 3 moves this behind the FT control-room backend;
// the store interface stays the same so the swap is a one-file change.

import { hash, syntheticSeries } from "./trends";

export type ActionKind =
  | "blacklist_driver"
  | "blacklist_transporter"
  | "blacklist_vehicle"
  | "redzone";

export type Severity = "advisory" | "restricted" | "blocked";
export type Status = "active" | "lifted" | "expired";

export interface EvidenceRef {
  kind: "verdict" | "cluster" | "trip" | "url" | "note";
  ref: string;
  label: string;
}

export interface AuditEntry {
  ts: string;
  by: string;
  action: "created" | "updated" | "lifted" | "expired" | "note";
  detail?: string;
}

export interface FTAction {
  id: string;
  kind: ActionKind;
  target: {
    type: "driver" | "vehicle" | "transporter" | "zone";
    key: string;
    label: string;
    sub?: string; // e.g. driver number under driver name
  };
  severity: Severity;
  reason_code: string;
  reason_note?: string;
  evidence: EvidenceRef[];
  status: Status;
  taken_by: string;
  taken_at: string;
  effective_from: string;
  effective_until?: string;
  lifted_reason?: string;
  lifted_at?: string;
  audit: AuditEntry[];
  // Zone-specific
  zone?: {
    lat: number;
    lng: number;
    radius_m: number;
    name: string;
  };
  // Baseline snapshot (captured at creation; used for outcome measurement)
  baseline_halts_per_week: number;
  baseline_exposure_per_week_inr: number;
}

const LS_KEY = "zepto.actions.v1";
const ME = "you@freighttiger.com";

export const REASON_CODES: Record<ActionKind, { code: string; label: string }[]> = {
  blacklist_driver: [
    { code: "repeated_shadow_halts", label: "Repeated shadow halts" },
    { code: "suspected_substitution", label: "Suspected driver substitution" },
    { code: "cold_chain_breach", label: "Cold-chain breach pattern" },
    { code: "night_concentration", label: "Night-time halt concentration" },
    { code: "confirmed_pilferage", label: "Confirmed pilferage incident" },
    { code: "other", label: "Other (see notes)" },
  ],
  blacklist_transporter: [
    { code: "sla_breach", label: "SLA breach pattern" },
    { code: "fleet_pattern", label: "Fleet-wide pattern" },
    { code: "low_compliance", label: "Low POI compliance" },
    { code: "data_hygiene", label: "GPS / data integrity issues" },
    { code: "confirmed_pilferage", label: "Confirmed pilferage involvement" },
    { code: "other", label: "Other (see notes)" },
  ],
  blacklist_vehicle: [
    { code: "habitual_shadow", label: "Habitual shadow halts" },
    { code: "device_tampering", label: "GPS tampering suspected" },
    { code: "reefer_failure", label: "Cold-chain failure pattern" },
    { code: "other", label: "Other (see notes)" },
  ],
  redzone: [
    { code: "shadow_cluster", label: "High shadow-halt cluster" },
    { code: "incident_history", label: "Pilferage incident history" },
    { code: "off_route_pattern", label: "Off-route halt pattern" },
    { code: "security_concern", label: "Security / law-enforcement advisory" },
    { code: "other", label: "Other (see notes)" },
  ],
};

const CHANGE_EVENT = "zepto-actions-changed";

function loadAll(): FTAction[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAll(actions: FTAction[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(actions));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function listActions(): FTAction[] {
  return loadAll();
}

export function listActive(): FTAction[] {
  return loadAll().filter(a => a.status === "active");
}

export function getAction(id: string): FTAction | undefined {
  return loadAll().find(a => a.id === id);
}

export function activeForTarget(type: FTAction["target"]["type"], key: string): FTAction | undefined {
  return loadAll().find(a => a.status === "active" && a.target.type === type && a.target.key === key);
}

export function createAction(input: Omit<FTAction, "id" | "status" | "taken_by" | "taken_at" | "audit"> & { baseline_halts_per_week?: number; baseline_exposure_per_week_inr?: number }): FTAction {
  const now = new Date().toISOString();
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const action: FTAction = {
    ...input,
    id,
    status: "active",
    taken_by: ME,
    taken_at: now,
    audit: [{ ts: now, by: ME, action: "created", detail: `${input.kind} · ${input.severity}` }],
    baseline_halts_per_week: input.baseline_halts_per_week ?? 0,
    baseline_exposure_per_week_inr: input.baseline_exposure_per_week_inr ?? 0,
  };
  const all = loadAll();
  all.unshift(action);
  saveAll(all);
  return action;
}

export function liftAction(id: string, reason: string): FTAction | undefined {
  const all = loadAll();
  const idx = all.findIndex(a => a.id === id);
  if (idx < 0) return undefined;
  const now = new Date().toISOString();
  all[idx] = {
    ...all[idx],
    status: "lifted",
    lifted_reason: reason,
    lifted_at: now,
    audit: [...all[idx].audit, { ts: now, by: ME, action: "lifted", detail: reason }],
  };
  saveAll(all);
  return all[idx];
}

export function addNote(id: string, note: string): FTAction | undefined {
  const all = loadAll();
  const idx = all.findIndex(a => a.id === id);
  if (idx < 0) return undefined;
  const now = new Date().toISOString();
  all[idx] = {
    ...all[idx],
    audit: [...all[idx].audit, { ts: now, by: ME, action: "note", detail: note }],
  };
  saveAll(all);
  return all[idx];
}

export function subscribe(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/* ===========================================================================
   Outcome measurement (synthetic for the pilot)

   Given the platform is single-period, we model post-action effectiveness
   deterministically from the action age and target seed. When the backend
   ships real weekly history, replace these with real measured deltas.
   =========================================================================== */

export interface Outcome {
  weeksActive: number;
  baseSeries: number[];      // last 6 weeks pre-action
  postSeries: number[];      // weeks since action
  prevented_halts: number;
  prevented_exposure_inr: number;
  effectiveness_pct: number; // 0-100; % reduction vs baseline
}

export function measureOutcome(action: FTAction): Outcome {
  const ms = Date.now() - new Date(action.taken_at).getTime();
  const weeksActive = Math.max(0, Math.round(ms / (7 * 24 * 3600 * 1000)));

  const seed = hash(action.id);
  const base = action.baseline_halts_per_week || 4;
  const baseSeries = syntheticSeries(seed, base, { weeks: 6, volatility: 0.12, trend: "flat" });

  // Post-action: blocked severity gets ~80-95% reduction, restricted ~60-75%, advisory ~30-50%.
  const reductionTarget =
    action.severity === "blocked" ? 0.88 :
    action.severity === "restricted" ? 0.68 :
    0.40;
  // Ramp up effectiveness over the first 2 weeks
  const weeksToShow = Math.max(1, Math.min(weeksActive + 1, 8));
  const postSeries: number[] = [];
  for (let i = 0; i < weeksToShow; i++) {
    const ramp = Math.min(1, i / 2);
    const target = base * (1 - reductionTarget * ramp);
    const noise = Math.sin(seed * 0.13 + i * 1.9) * 0.08;
    postSeries.push(Math.max(0, target + base * noise));
  }

  const baselineAvg = baseSeries.reduce((s, n) => s + n, 0) / baseSeries.length;
  const postAvg = postSeries.reduce((s, n) => s + n, 0) / Math.max(1, postSeries.length);
  const effectiveness_pct = baselineAvg > 0 ? Math.max(0, Math.min(100, ((baselineAvg - postAvg) / baselineAvg) * 100)) : 0;

  // Prevent: every halt has an avg exposure value
  const avgExposurePerHalt = (action.baseline_exposure_per_week_inr || 0) / Math.max(1, base);
  const prevented_halts = Math.round((baselineAvg - postAvg) * weeksToShow);
  const prevented_exposure_inr = Math.round(prevented_halts * avgExposurePerHalt);

  return { weeksActive, baseSeries, postSeries, prevented_halts, prevented_exposure_inr, effectiveness_pct };
}

export function aggregateImpact(actions: FTAction[]): {
  total_active: number;
  total_lifted: number;
  prevented_halts: number;
  prevented_exposure_inr: number;
  avg_effectiveness_pct: number;
} {
  let active = 0, lifted = 0;
  let preventedHalts = 0;
  let preventedExposure = 0;
  let effSum = 0;
  let effCount = 0;
  for (const a of actions) {
    if (a.status === "active") active += 1;
    if (a.status === "lifted") lifted += 1;
    if (a.status !== "lifted") {
      const o = measureOutcome(a);
      preventedHalts += o.prevented_halts;
      preventedExposure += o.prevented_exposure_inr;
      effSum += o.effectiveness_pct;
      effCount += 1;
    }
  }
  return {
    total_active: active,
    total_lifted: lifted,
    prevented_halts: preventedHalts,
    prevented_exposure_inr: preventedExposure,
    avg_effectiveness_pct: effCount > 0 ? Math.round(effSum / effCount) : 0,
  };
}
