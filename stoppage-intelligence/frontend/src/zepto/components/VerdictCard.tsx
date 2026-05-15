import { useState } from "react";
import type { Verdict } from "../types";
import { ScoreBars } from "./ScoreBars";
import { MiniMap } from "./MiniMap";

interface Props {
  verdict: Verdict;
  rank: number;
  onInvestigate?: (v: Verdict) => void;
  onOpenInMap?: (v: Verdict) => void;
}

function formatINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

function typeClass(t: string) {
  return t === "shadow_hotspot" ? "shadow" : "";
}

function scoreTier(score: number) {
  if (score >= 85) return "score-critical";
  if (score >= 75) return "score-high";
  return "score-medium";
}

export function VerdictCard({ verdict: v, rank, onInvestigate, onOpenInMap }: Props) {
  const [expanded, setExpanded] = useState(rank === 1);

  const evidencePoints = v.evidence.slice(0, 12).map(e => ({ lat: e.lat, lng: e.lng }));

  return (
    <div className={`zepto-verdict ${scoreTier(v.risk_score)}${expanded ? " expanded" : ""}`} onClick={() => setExpanded(e => !e)}>
      <div className="zepto-verdict-header">
        <div className="zepto-verdict-rank">{rank.toString().padStart(2, "0")}</div>
        <div className="zepto-verdict-body">
          <div className={`zepto-verdict-type ${typeClass(v.type)}`}>{v.type_label}</div>
          <div className="zepto-verdict-headline">{v.headline}</div>
          <div className="zepto-verdict-stats">
            <span><strong>{v.stats.count}</strong> halts</span>
            <span><strong>{v.stats.median_duration_hrs.toFixed(1)} hr</strong> median</span>
            <span><strong>{Math.round(v.stats.night_share * 100)}%</strong> overnight</span>
            {v.stats.reefer_share >= 0.5 && <span className="zepto-badge reefer">Reefer</span>}
            {v.stats.night_share >= 0.7 && <span className="zepto-badge night">Night-dominant</span>}
            <span style={{ color: "var(--text-muted)" }}>
              POI: {v.location.nearest_poi_name || "Unmapped"} · {v.location.distance_to_poi_km.toFixed(2)} km away
            </span>
          </div>
        </div>
        <div className="zepto-verdict-right">
          <div className="zepto-verdict-score">{v.risk_score}</div>
          <div className="zepto-verdict-score-label">Risk score · 100</div>
        </div>
      </div>

      {expanded && (
        <div className="zepto-verdict-detail" onClick={e => e.stopPropagation()}>
          <div>
            <div className="narrative">{v.narrative}</div>

            <div className="exposure">
              Estimated cargo exposure for this pattern: <strong>{formatINR(v.estimated_exposure_inr)}</strong>
              {" "}<span style={{ color: "var(--text-muted)" }}>(conservative 3% pilferage benchmark on observed cargo weight)</span>
            </div>

            <div className="recommended">
              <div className="recommended-label">Recommended next step</div>
              {v.recommended_action}
            </div>

            <table className="zepto-evidence">
              <thead>
                <tr>
                  <th>Trip</th>
                  <th>Date / time</th>
                  <th>Duration</th>
                  <th>Weight (kg)</th>
                  <th>Escalation</th>
                  <th>Distance to POI</th>
                </tr>
              </thead>
              <tbody>
                {v.evidence.map((e) => (
                  <tr key={`${e.trip_id}-${e.ts}`}>
                    <td>{e.trip_id}</td>
                    <td>{e.ts}</td>
                    <td>{e.duration_hrs.toFixed(1)} hr</td>
                    <td>{e.net_weight ? e.net_weight.toLocaleString() : "—"}</td>
                    <td>{e.escalation || "—"}</td>
                    <td>{e.distance_to_poi_km != null ? `${e.distance_to_poi_km.toFixed(2)} km` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="zepto-btn primary" onClick={() => onInvestigate?.(v)}>Investigate this entity</button>
              <button className="zepto-btn" onClick={() => onOpenInMap?.(v)}>Open location on map</button>
              <a
                className="zepto-btn"
                href={`https://www.google.com/maps/search/?api=1&query=${v.location.lat.toFixed(6)},${v.location.lng.toFixed(6)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none" }}
              >
                View on Google Maps ↗
              </a>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                {v.location.lat.toFixed(4)}, {v.location.lng.toFixed(4)}
              </span>
            </div>
          </div>
          <div>
            <MiniMap lat={v.location.lat} lng={v.location.lng} zoom={13} height={170} extraPoints={evidencePoints} />
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 8 }}>
                Score components
              </div>
              <ScoreBars breakdown={v.score_breakdown} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
