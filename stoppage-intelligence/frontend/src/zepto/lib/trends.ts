// Deterministic time-series synthesis. The current data file is a single-period
// snapshot, so true history doesn't exist yet. These helpers produce plausible
// 12-week trajectories anchored to current values, seeded by the entity key so
// the same entity always shows the same shape across visits. When the backend
// starts serving real weekly history, drop this module and pass real series.

const WEEKS = 12;

export function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

/** Plausible series ending at `current`. Range stays roughly within ±volatility. */
export function syntheticSeries(seed: number, current: number, opts?: {
  weeks?: number; volatility?: number; trend?: "up" | "down" | "flat" | "auto";
}): number[] {
  const weeks = opts?.weeks ?? WEEKS;
  const volatility = opts?.volatility ?? 0.18;
  const trend = opts?.trend ?? "auto";

  // Determine direction
  const autoSign = ((seed >> 3) & 1) === 1 ? 1 : -1;
  const sign = trend === "up" ? 1 : trend === "down" ? -1 : trend === "flat" ? 0 : autoSign;
  const slope = sign * (0.12 + ((seed % 7) / 100));

  const start = Math.max(0, current * (1 - slope * weeks * 0.04));
  const out: number[] = [];
  for (let i = 0; i < weeks; i++) {
    const t = i / (weeks - 1 || 1);
    const linear = start + (current - start) * t;
    const noise = Math.sin(seed * 0.1 + i * 1.3) * volatility + Math.cos(seed * 0.07 + i * 0.7) * volatility * 0.5;
    out.push(Math.max(0, linear + Math.abs(linear) * noise));
  }
  out[weeks - 1] = current; // anchor
  return out;
}

/** Trajectory: compares last 4 weeks vs previous 4. */
export type Trajectory = "up" | "down" | "flat";
export function trajectory(series: number[]): { dir: Trajectory; deltaPct: number } {
  if (series.length < 8) return { dir: "flat", deltaPct: 0 };
  const recent = series.slice(-4);
  const prior = series.slice(-8, -4);
  const r = recent.reduce((s, n) => s + n, 0) / recent.length;
  const p = prior.reduce((s, n) => s + n, 0) / prior.length;
  if (p === 0) return { dir: r > 0 ? "up" : "flat", deltaPct: 0 };
  const delta = (r - p) / p;
  if (Math.abs(delta) < 0.08) return { dir: "flat", deltaPct: delta * 100 };
  return { dir: delta > 0 ? "up" : "down", deltaPct: delta * 100 };
}

/** Computes "this week vs last week" tier movement across a set of entities. */
export function cohortMovement<T extends { key: string; risk: number }>(entities: T[]): {
  promoted: { entity: T; from: Tier; to: Tier }[];
  demoted: { entity: T; from: Tier; to: Tier }[];
  unchanged: number;
} {
  const promoted: { entity: T; from: Tier; to: Tier }[] = [];
  const demoted: { entity: T; from: Tier; to: Tier }[] = [];
  let unchanged = 0;

  for (const e of entities) {
    const series = syntheticSeries(hash(e.key + "risk"), e.risk, { weeks: 4, volatility: 0.12 });
    const lastWeek = series[series.length - 2] ?? e.risk;
    const fromTier = tierOf(lastWeek);
    const toTier = tierOf(e.risk);
    if (fromTier === toTier) {
      unchanged += 1;
      continue;
    }
    const movement = { entity: e, from: fromTier, to: toTier };
    // Worse tier = promoted to risk
    if (tierIndex(toTier) > tierIndex(fromTier)) promoted.push(movement);
    else demoted.push(movement);
  }
  return { promoted, demoted, unchanged };
}

export type Tier = "critical" | "high" | "medium" | "low";
export function tierOf(score: number): Tier {
  if (score >= 85) return "critical";
  if (score >= 75) return "high";
  if (score >= 60) return "medium";
  return "low";
}
function tierIndex(t: Tier): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[t];
}

/** Forecast next N weeks via simple linear regression on the last K weeks. */
export function forecast(series: number[], ahead = 2): {
  values: number[]; upper: number[]; lower: number[];
} {
  const k = Math.min(series.length, 8);
  const recent = series.slice(-k);
  // OLS
  const n = recent.length;
  const xs = recent.map((_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = recent.reduce((s, y) => s + y, 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * recent[i], 0);
  const slope = (n * sumXY - sumX * sumY) / Math.max(1e-9, n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Residual std
  const preds = xs.map(x => intercept + slope * x);
  const resid = recent.map((y, i) => y - preds[i]);
  const meanRes = resid.reduce((s, r) => s + r, 0) / n;
  const std = Math.sqrt(resid.reduce((s, r) => s + (r - meanRes) ** 2, 0) / Math.max(1, n - 1));

  const out: number[] = [], upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < ahead; i++) {
    const x = n + i;
    const v = Math.max(0, intercept + slope * x);
    out.push(v);
    upper.push(v + 1.96 * std);
    lower.push(Math.max(0, v - 1.96 * std));
  }
  return { values: out, upper, lower };
}

/** Returns indices of weeks where the value is > 2σ above (or below) the rolling mean. */
export function outlierWeeks(series: number[]): number[] {
  if (series.length < 4) return [];
  const mean = series.reduce((s, n) => s + n, 0) / series.length;
  const std = Math.sqrt(series.reduce((s, n) => s + (n - mean) ** 2, 0) / series.length);
  if (std === 0) return [];
  return series.map((v, i) => (Math.abs(v - mean) / std > 2 ? i : -1)).filter(i => i >= 0);
}

/** Seasonal markers — map weeks-back index → human label. Based on today's
 *  IST date. Handles a 12-week look-back. */
export function seasonalMarkers(weeks = WEEKS, today: Date = new Date()): { weekIdx: number; label: string; kind: "monsoon" | "festival" | "regulatory" }[] {
  const out: { weekIdx: number; label: string; kind: "monsoon" | "festival" | "regulatory" }[] = [];
  const oneWeek = 7 * 24 * 3600 * 1000;

  // Helper: was `date` within the visible window?
  const inWindow = (d: Date) => {
    const diffWeeks = Math.round((today.getTime() - d.getTime()) / oneWeek);
    return diffWeeks >= 0 && diffWeeks < weeks;
  };
  const weekIdx = (d: Date) => {
    const diffWeeks = Math.round((today.getTime() - d.getTime()) / oneWeek);
    return weeks - 1 - diffWeeks; // newest week = weeks-1
  };

  const year = today.getFullYear();
  const markers: { d: Date; label: string; kind: "monsoon" | "festival" | "regulatory" }[] = [
    { d: new Date(year, 5, 1), label: "Monsoon onset", kind: "monsoon" },
    { d: new Date(year, 8, 30), label: "Monsoon end", kind: "monsoon" },
    // Festivals (approx — production: read from a holiday API)
    { d: new Date(year, 9, 24), label: "Dussehra", kind: "festival" },
    { d: new Date(year, 10, 12), label: "Diwali", kind: "festival" },
    // Regulatory quarter-ends
    { d: new Date(year, 2, 31), label: "GST Q4 close", kind: "regulatory" },
    { d: new Date(year, 5, 30), label: "GST Q1 close", kind: "regulatory" },
    { d: new Date(year, 8, 30), label: "GST Q2 close", kind: "regulatory" },
    { d: new Date(year, 11, 31), label: "GST Q3 close", kind: "regulatory" },
    // Last year's markers in case window straddles year boundary
    { d: new Date(year - 1, 11, 31), label: "GST Q3 close", kind: "regulatory" },
    { d: new Date(year - 1, 10, 1), label: "Diwali", kind: "festival" },
  ];

  for (const m of markers) {
    if (inWindow(m.d)) out.push({ weekIdx: weekIdx(m.d), label: m.label, kind: m.kind });
  }
  return out;
}

/** Pattern half-life for a cluster — from real event timestamps. */
export function halfLife(events: { ts: string }[], now: Date = new Date()): {
  firstSeen: Date | null;
  lastSeen: Date | null;
  daysActive: number;
  daysSinceLast: number;
  status: "active" | "decaying" | "dormant";
} {
  let first: number | null = null;
  let last: number | null = null;
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (isNaN(t)) continue;
    if (first === null || t < first) first = t;
    if (last === null || t > last) last = t;
  }
  if (first === null || last === null) {
    return { firstSeen: null, lastSeen: null, daysActive: 0, daysSinceLast: 0, status: "dormant" };
  }
  const dayMs = 24 * 3600 * 1000;
  const daysActive = Math.max(1, Math.round((last - first) / dayMs));
  const daysSinceLast = Math.max(0, Math.round((now.getTime() - last) / dayMs));
  let status: "active" | "decaying" | "dormant";
  if (daysSinceLast <= 7) status = "active";
  else if (daysSinceLast <= 21) status = "decaying";
  else status = "dormant";
  return { firstSeen: new Date(first), lastSeen: new Date(last), daysActive, daysSinceLast, status };
}
