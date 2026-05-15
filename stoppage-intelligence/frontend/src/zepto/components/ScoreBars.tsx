import type { VerdictScoreBreakdown } from "../types";

const COMPONENTS: { key: keyof VerdictScoreBreakdown; label: string; max: number }[] = [
  { key: "frequency",   label: "Repeated halts",     max: 25 },
  { key: "poi_absence", label: "POI distance",       max: 20 },
  { key: "duration",    label: "Stop duration",      max: 15 },
  { key: "night_share", label: "Night-time share",   max: 15 },
  { key: "reefer",      label: "Cold-chain risk",    max: 10 },
  { key: "cargo_value", label: "Cargo value",        max: 5  },
  { key: "transparency",label: "Low transparency",   max: 5  },
  { key: "escalation",  label: "Escalation history", max: 5  },
];

export function ScoreBars({ breakdown }: { breakdown: VerdictScoreBreakdown }) {
  return (
    <div className="zepto-score-bars">
      {COMPONENTS.map(c => {
        const v = breakdown[c.key] ?? 0;
        const pct = Math.min(100, (v / c.max) * 100);
        return (
          <div className="zepto-score-bar" key={c.key}>
            <div className="label">{c.label}</div>
            <div className="bar-bg">
              <div className="bar-fg" style={{ width: `${pct}%`, opacity: v > 0 ? 1 : 0.2 }} />
            </div>
            <div className="value">{v}</div>
          </div>
        );
      })}
    </div>
  );
}
