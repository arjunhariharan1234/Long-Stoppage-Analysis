import { useEffect, useState } from "react";

interface Props {
  onExplore: () => void;
  stats: {
    totalEvents: number;
    routes: number;
    trips: number;
    knownFunctional: number;
    otherLegit: number;
    unauthorized: number;
  } | null;
}

export default function LandingPage({ onExplore, stats }: Props) {
  const [visible, setVisible] = useState(false);
  const [countUp, setCountUp] = useState(0);

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
  }, []);

  // Counting animation for hero number
  useEffect(() => {
    if (!stats) return;
    const target = stats.totalEvents;
    const duration = 1500;
    const steps = 40;
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setCountUp(target);
        clearInterval(timer);
      } else {
        setCountUp(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [stats]);

  const total = stats
    ? stats.knownFunctional + stats.otherLegit + stats.unauthorized
    : 1;
  const pctKnown = stats ? (stats.knownFunctional / total) * 100 : 0;
  const pctLegit = stats ? (stats.otherLegit / total) * 100 : 0;
  const pctUnauth = stats ? (stats.unauthorized / total) * 100 : 0;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "all 0.6s ease-out",
      }}
    >
      {/* Hero */}
      <div style={{ textAlign: "center", maxWidth: 700, marginBottom: 40 }}>
        {/* Animated truck scene */}
        <div
          style={{
            fontSize: 64,
            marginBottom: 8,
            position: "relative",
            height: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <span style={{ animation: "truckBounce 2s ease-in-out infinite" }}>
            {"\uD83D\uDE9A"}
          </span>
          <span style={{ fontSize: 32, animation: "pinPulse 2s ease-in-out infinite 0.5s" }}>
            {"\uD83D\uDCCD"}
          </span>
          <span style={{ fontSize: 32, animation: "pinPulse 2s ease-in-out infinite 1s" }}>
            {"\uD83D\uDDFA\uFE0F"}
          </span>
        </div>

        <h1
          style={{
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1.2,
            marginBottom: 12,
            background: "linear-gradient(135deg, var(--blue), var(--green))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Stoppage Intelligence
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            maxWidth: 520,
            margin: "0 auto",
          }}
        >
          Analyzing <strong style={{ color: "var(--text-primary)" }}>{countUp.toLocaleString()}</strong> long
          stoppage alerts across{" "}
          <strong style={{ color: "var(--text-primary)" }}>{stats?.routes.toLocaleString() ?? "..."}</strong> routes
          — identifying risky halts, fuel stops, toll booths, and unauthorized locations.
        </p>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            maxWidth: 640,
            width: "100%",
            marginBottom: 32,
          }}
        >
          {[
            { label: "Stoppages", value: stats.totalEvents.toLocaleString(), color: "var(--blue)" },
            { label: "Routes", value: stats.routes.toLocaleString(), color: "var(--purple)" },
            { label: "Trips", value: stats.trips.toLocaleString(), color: "var(--blue)" },
            { label: "Authorized", value: stats.knownFunctional.toLocaleString(), color: "var(--green)" },
            { label: "Legit Stops", value: stats.otherLegit.toLocaleString(), color: "var(--yellow)" },
            { label: "Unauthorized", value: stats.unauthorized.toLocaleString(), color: "var(--red)" },
          ].map((kpi, i) => (
            <div
              key={i}
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "16px 14px",
                textAlign: "center",
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(10px)",
                transition: `all 0.5s ease-out ${0.1 * i}s`,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {kpi.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>
                {kpi.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Classification bar */}
      {stats && (
        <div style={{ maxWidth: 640, width: "100%", marginBottom: 32 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, textAlign: "center" }}>
            Halt Classification Breakdown
          </div>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--bg-tertiary)" }}>
            <div style={{ width: `${pctKnown}%`, background: "var(--green)", transition: "width 1s ease-out" }} />
            <div style={{ width: `${pctLegit}%`, background: "var(--yellow)", transition: "width 1s ease-out 0.2s" }} />
            <div style={{ width: `${pctUnauth}%`, background: "var(--red)", transition: "width 1s ease-out 0.4s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--text-secondary)" }}>
            <span><span style={{ color: "var(--green)" }}>{"\u25CF"}</span> Known Functional ({pctKnown.toFixed(0)}%)</span>
            <span><span style={{ color: "var(--yellow)" }}>{"\u25CF"}</span> Other Legit ({pctLegit.toFixed(0)}%)</span>
            <span><span style={{ color: "var(--red)" }}>{"\u25CF"}</span> Unauthorized ({pctUnauth.toFixed(0)}%)</span>
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={onExplore}
        style={{
          background: "linear-gradient(135deg, var(--blue), #3d8bfd)",
          color: "#fff",
          border: "none",
          padding: "14px 40px",
          borderRadius: 10,
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(88, 166, 255, 0.3)",
          transition: "all 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "0 6px 24px rgba(88, 166, 255, 0.4)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 4px 20px rgba(88, 166, 255, 0.3)";
        }}
      >
        Explore Analysis {"\u2192"}
      </button>

      <p style={{ marginTop: 12, fontSize: 12, color: "var(--text-secondary)" }}>
        JSW Steel — 10 months of long stoppage data, pre-analyzed
      </p>

      {/* Animations */}
      <style>{`
        @keyframes truckBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes pinPulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
