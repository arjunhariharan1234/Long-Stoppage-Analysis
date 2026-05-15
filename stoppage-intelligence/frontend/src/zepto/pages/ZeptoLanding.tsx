import { useEffect, useState } from "react";
import { api } from "../api";
import type { Summary, Verdict } from "../types";
import { VerdictCard } from "../components/VerdictCard";

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

interface Props {
  onInvestigate: (verdict: Verdict) => void;
  onOpenInMap: (verdict: Verdict) => void;
}

export function ZeptoLanding({ onInvestigate, onOpenInMap }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.summary(), api.verdicts()])
      .then(([s, v]) => { setSummary(s); setVerdicts(v); setLoading(false); })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="zepto-loading">
        <div className="zepto-loading-spinner" />
        <div className="zepto-loading-text">Loading risk findings…</div>
      </div>
    );
  }
  if (!summary) {
    return <div className="zepto-page">Data not available. Run <code>build_zepto_intelligence.py</code>.</div>;
  }

  const exposureSum = verdicts.reduce((acc, v) => acc + (v.estimated_exposure_inr || 0), 0);
  const exposureLakh = (exposureSum / 100000).toFixed(1);

  const fromShort = new Date(summary.data_window.from).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const toShort = new Date(summary.data_window.to).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="zepto-page">
      <div className="zepto-title-block">
        <div className="zepto-eyebrow">In-transit risk intelligence</div>
        <h1 className="zepto-headline-xl">
          <em>{summary.priority_finding_count}</em> priority findings.
        </h1>
        <p className="zepto-sub-short">
          {fmt(summary.in_transit_events)} in-transit halts · {fromShort} – {toShort}
          {" "}<button className="zepto-methodology-trigger" type="button" title="How findings are scored">ⓘ Methodology</button>
        </p>
      </div>

      {/* KPI strip */}
      <div className="zepto-kpi-strip">
        <div className="zepto-kpi">
          <div className="label">In-transit halts</div>
          <div className="value">{fmt(summary.in_transit_events)}</div>
        </div>
        <div className="zepto-kpi">
          <div className="label">Priority findings</div>
          <div className="value accent">{summary.priority_finding_count}</div>
        </div>
        <div className="zepto-kpi">
          <div className="label">Reefer share of risk</div>
          <div className="value">{Math.round(summary.reefer_event_share * 100)}%</div>
        </div>
        <div className="zepto-kpi">
          <div className="label">Night-time share</div>
          <div className="value">{Math.round(summary.night_event_share * 100)}%</div>
        </div>
        <div className="zepto-kpi">
          <div className="label">Cargo exposure (top 25)</div>
          <div className="value warn">₹{exposureLakh} L</div>
        </div>
      </div>

      {/* Themes */}
      {summary.themes && summary.themes.length > 0 && (
        <div className="zepto-themes">
          <div className="title">Pattern observations</div>
          <ul>
            {summary.themes.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      {/* Findings feed */}
      <div className="zepto-section-head">
        <h2>Priority findings <span className="count">({verdicts.length})</span></h2>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Sorted by risk score. Click any row to see evidence, exposure and the recommended next step.
        </div>
      </div>

      {verdicts.map((v, i) => (
        <VerdictCard
          key={v.verdict_id}
          verdict={v}
          rank={i + 1}
          onInvestigate={onInvestigate}
          onOpenInMap={onOpenInMap}
        />
      ))}

      <div style={{ marginTop: 32, padding: "16px 18px", borderTop: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
        <strong style={{ color: "var(--text-secondary)" }}>Methodology.</strong> In-transit filter: ≥2 km from origin and destination, halt ≥30 min, vehicle loaded.
        Eight-factor risk score (0–100) combining frequency, POI distance, duration, night-share, cold-chain status, cargo value, transparency and escalation history.
        Every finding ships with trip-level evidence and is auditable against
        {" "}<code style={{ background: "var(--bg-subtle)", padding: "1px 6px", borderRadius: 4, color: "var(--text-secondary)" }}>zepto_long_stoppage</code> (Databricks Genie workspace).
      </div>
    </div>
  );
}
