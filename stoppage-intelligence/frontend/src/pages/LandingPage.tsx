import { useEffect, useState } from "react";

interface Props {
  onExplore: () => void;
  onUpload: () => void;
  stats: {
    totalEvents: number;
    routes: number;
    trips: number;
    knownFunctional: number;
    otherLegit: number;
    unauthorized: number;
  } | null;
}

const ANALYSIS_STEPS = [
  {
    icon: "\uD83D\uDCC1",
    title: "Ingest & Validate",
    desc: "Auto-detect schema, validate coordinates, normalize timestamps across any alert format",
    value: "Zero manual mapping — works with any fleet alert export",
  },
  {
    icon: "\uD83D\uDCCD",
    title: "Spatial Clustering",
    desc: "DBSCAN groups nearby halts into location clusters using haversine distance",
    value: "Reveals repeat halt zones invisible in raw alert data",
  },
  {
    icon: "\u26FD",
    title: "POI Enrichment",
    desc: "Matches each halt to the nearest fuel station, toll booth, dhaba, gate, or landmark from 1.2M+ POIs",
    value: "Answers WHY a vehicle stopped — not just WHERE",
  },
  {
    icon: "\uD83D\uDEE1\uFE0F",
    title: "Risk Classification",
    desc: "Categorizes every stop as Known Functional, Other Legitimate, or Unauthorized",
    value: "Unauthorized = no POI within 2km — highest theft/pilferage risk",
  },
  {
    icon: "\uD83C\uDF19",
    title: "Night Halt Detection",
    desc: "Flags clusters with high night halt percentage (8PM\u20136AM) and peak hour analysis",
    value: "Night stops in unknown locations are the #1 operational risk signal",
  },
  {
    icon: "\uD83D\uDCCA",
    title: "Route Intelligence",
    desc: "Aggregates stoppages by route code — identify problematic corridors and repeat offenders",
    value: "Prioritize routes that generate the most unauthorized alerts",
  },
];

export default function LandingPage({ onExplore, onUpload, stats }: Props) {
  const [visible, setVisible] = useState(false);
  const [truckPhase, setTruckPhase] = useState<"driving" | "stopped">("driving");
  const [truckLeft, setTruckLeft] = useState(-5);
  const [activeStep, setActiveStep] = useState(-1);

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);

    // Truck drives to the pin and stops
    const driveInterval = setInterval(() => {
      setTruckLeft((prev) => {
        if (prev >= 42) {
          clearInterval(driveInterval);
          setTruckPhase("stopped");
          return 42;
        }
        return prev + 1;
      });
    }, 30);

    return () => clearInterval(driveInterval);
  }, []);

  // After truck stops, reveal analysis steps one by one
  useEffect(() => {
    if (truckPhase !== "stopped") return;
    let step = 0;
    const reveal = setInterval(() => {
      setActiveStep(step);
      step++;
      if (step >= ANALYSIS_STEPS.length) clearInterval(reveal);
    }, 200);
    return () => clearInterval(reveal);
  }, [truckPhase]);

  const hasData = stats && stats.totalEvents > 0;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.5s ease-out",
      }}
    >
      {/* Hero with truck animation */}
      <div style={{ padding: "48px 24px 32px", textAlign: "center" }}>
        {/* Road scene */}
        <div
          style={{
            position: "relative",
            height: 100,
            maxWidth: 560,
            margin: "0 auto 28px",
            overflow: "hidden",
          }}
        >
          {/* Road */}
          <div
            style={{
              position: "absolute",
              bottom: 14,
              left: 0,
              right: 0,
              height: 4,
              background: "var(--border-light)",
              borderRadius: 2,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 18,
              left: 0,
              right: 0,
              height: 2,
              backgroundImage:
                "repeating-linear-gradient(90deg, var(--text-muted) 0, var(--text-muted) 10px, transparent 10px, transparent 24px)",
              opacity: truckPhase === "driving" ? 0.35 : 0.15,
              animation:
                truckPhase === "driving"
                  ? "roadScroll 0.8s linear infinite"
                  : "none",
            }}
          />

          {/* Destination pin */}
          <div
            style={{
              position: "absolute",
              left: "52%",
              bottom: 22,
              fontSize: 28,
              color: "var(--brand)",
              filter: "drop-shadow(0 0 10px rgba(255, 190, 7, 0.5))",
              animation:
                truckPhase === "stopped"
                  ? "pinBounce 0.5s ease-out"
                  : "none",
              opacity: truckLeft > 20 ? 1 : 0.3,
              transition: "opacity 0.3s",
            }}
          >
            {"\uD83D\uDCCD"}
          </div>

          {/* Truck (facing right) */}
          <div
            style={{
              position: "absolute",
              left: `${truckLeft}%`,
              bottom: 16,
              fontSize: 36,
              transform: "scaleX(-1)", // flip to face right
              filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
              transition: truckPhase === "stopped" ? "none" : "left 0.03s linear",
            }}
          >
            {"\uD83D\uDE9A"}
          </div>

          {/* Stoppage pulse ring when truck stops */}
          {truckPhase === "stopped" && (
            <div
              style={{
                position: "absolute",
                left: `${truckLeft + 2}%`,
                bottom: 10,
                width: 50,
                height: 50,
                borderRadius: "50%",
                border: "2px solid var(--brand)",
                opacity: 0,
                animation: "pulseRing 2s ease-out infinite",
              }}
            />
          )}
        </div>

        <h1 style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.15, marginBottom: 12 }}>
          Stoppage <span style={{ color: "var(--brand)" }}>Intelligence</span>
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "var(--text-secondary)",
            lineHeight: 1.7,
            maxWidth: 480,
            margin: "0 auto 28px",
          }}
        >
          Turn raw stoppage alerts into actionable intelligence.
          Know where your fleet halts, why it halts, and which stops need attention.
        </p>

        {/* CTA */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {hasData && (
            <button onClick={onExplore} className="brand-btn-solid">
              View Analysis
            </button>
          )}
          <button onClick={onUpload} className="brand-btn-outline">
            Upload Stoppage Data
          </button>
        </div>
      </div>

      {/* Analysis pipeline — revealed after truck stops */}
      <div
        style={{
          padding: "16px 24px 40px",
          maxWidth: 780,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <h2
          style={{
            textAlign: "center",
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 6,
            color: "var(--text-primary)",
          }}
        >
          What happens when a vehicle stops
        </h2>
        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
            marginBottom: 28,
          }}
        >
          Every halt is analyzed through a 6-step intelligence pipeline
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ANALYSIS_STEPS.map((step, i) => {
            const revealed = i <= activeStep;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                  padding: "14px 16px",
                  background: revealed ? "var(--bg-secondary)" : "transparent",
                  border: `1px solid ${revealed ? "var(--border)" : "transparent"}`,
                  borderRadius: 10,
                  opacity: revealed ? 1 : 0.15,
                  transform: revealed ? "translateX(0)" : "translateX(-8px)",
                  transition: "all 0.4s ease-out",
                }}
              >
                {/* Step number */}
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: revealed ? "var(--brand-dim)" : "var(--bg-tertiary)",
                    border: `1px solid ${revealed ? "var(--brand)" : "var(--border)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {step.icon}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>
                    {step.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 4 }}>
                    {step.desc}
                  </div>
                  {revealed && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--brand)",
                        fontWeight: 500,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        opacity: revealed ? 1 : 0,
                        transition: "opacity 0.3s ease-out 0.2s",
                      }}
                    >
                      <span style={{ fontSize: 10 }}>{"\u2B50"}</span> {step.value}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom CTA if data exists */}
      {hasData && (
        <div
          style={{
            textAlign: "center",
            padding: "0 24px 40px",
          }}
        >
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "24px",
              maxWidth: 500,
              margin: "0 auto",
            }}
          >
            <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600, marginBottom: 6 }}>
              Analysis ready
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.5 }}>
              {stats!.totalEvents.toLocaleString()} stoppage events across {stats!.routes.toLocaleString()} routes have been analyzed and classified.
            </p>
            <button onClick={onExplore} className="brand-btn-solid">
              Open Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "16px 24px 28px", color: "var(--text-muted)", fontSize: 11 }}>
        Freight Tiger &middot; Control Centre Intelligence
      </div>

      <style>{`
        @keyframes roadScroll {
          from { background-position: 0 0; }
          to { background-position: -24px 0; }
        }
        @keyframes pinBounce {
          0% { transform: translateY(-16px) scale(1.2); }
          60% { transform: translateY(2px) scale(0.95); }
          100% { transform: translateY(0) scale(1); }
        }
        @keyframes pulseRing {
          0% { opacity: 0.6; transform: scale(0.5); }
          100% { opacity: 0; transform: scale(2.5); }
        }
        .brand-btn-solid {
          background: var(--brand);
          color: #0f1117;
          border: none;
          padding: 11px 28px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(255, 190, 7, 0.2);
          transition: all 0.2s;
        }
        .brand-btn-solid:hover {
          box-shadow: 0 6px 24px rgba(255, 190, 7, 0.35);
          transform: translateY(-1px);
        }
        .brand-btn-outline {
          background: transparent;
          color: var(--brand);
          border: 1px solid var(--brand);
          padding: 11px 28px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .brand-btn-outline:hover {
          background: var(--brand-dim);
        }
      `}</style>
    </div>
  );
}
