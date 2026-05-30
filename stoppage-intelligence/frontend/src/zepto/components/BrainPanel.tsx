import { useEffect, useState } from "react";
import { Badge } from "ft-design-system";
import { api } from "../api";
import type { BrainScore } from "../types";

interface Props {
  tripId: string | null;
}

function tierClass(tier: BrainScore["tier"]): string {
  if (tier === "high") return "is-critical";
  if (tier === "medium") return "is-high";
  return "is-low";
}

export function BrainPanel({ tripId }: Props) {
  const [score, setScore] = useState<BrainScore | null>(null);
  const [version, setVersion] = useState<string>("");
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tripId) {
      setScore(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api.brainScores()
      .then(file => {
        const hit = file.scores.find(s => s.trip_id === tripId) ?? null;
        setScore(hit);
        setVersion(file.version);
        setGeneratedAt(file.generated_at);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, [tripId]);

  if (!tripId) return <div className="zepto-empty">Pick a trip to see brain analysis.</div>;
  if (loading) return <div className="zepto-empty">Loading brain…</div>;
  if (error) return <div className="zepto-empty">Brain unavailable: {error}</div>;
  if (!score) return <div className="zepto-empty">No brain score for trip {tripId}.</div>;

  return (
    <div className="brain-panel">
      <header className="brain-panel-header">
        <div className="brain-score">
          <span className="brain-score-value">{score.brain_score}</span>
          <Badge className={tierClass(score.tier)}>{score.tier.toUpperCase()}</Badge>
        </div>
        <div className="brain-context">
          <div><strong>Vehicle</strong> {score.vehicle || "—"}</div>
          <div><strong>Driver</strong> {score.driver_number || "—"}</div>
          <div><strong>Transporter</strong> {score.transporter || "—"}</div>
        </div>
      </header>

      <section className="brain-section">
        <h4>Matched signals ({score.matched_signals.length})</h4>
        {score.matched_signals.length === 0 ? (
          <div className="zepto-empty">No signals fired.</div>
        ) : (
          <ul className="brain-signal-list">
            {score.matched_signals.map(s => (
              <li key={s.id} className="brain-signal-item">
                <div className="brain-signal-head">
                  <code>{s.id}</code>
                  <span className="brain-signal-name">{s.name}</span>
                  <Badge className="is-low">+{s.weight}</Badge>
                </div>
                {Object.keys(s.evidence).length > 0 && (
                  <pre className="brain-signal-evidence">
                    {JSON.stringify(s.evidence, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="brain-section">
        <h4>Most-similar past cases</h4>
        {score.similar_cases.length === 0 ? (
          <div className="zepto-empty">No case-base match.</div>
        ) : (
          <ul className="brain-case-list">
            {score.similar_cases.map(c => (
              <li key={c.case_id} className="brain-case-item">
                <div className="brain-case-head">
                  <code>{c.case_id}</code>
                  <span>{c.city}</span>
                  <Badge className="is-medium">{Math.round(c.similarity * 100)}% similar</Badge>
                </div>
                <p className="brain-case-rca">{c.rca_summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="brain-panel-footer">
        codex {version} · generated {generatedAt}
      </footer>
    </div>
  );
}
