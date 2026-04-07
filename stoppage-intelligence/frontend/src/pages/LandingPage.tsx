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
    icon: "\uD83D\uDCC2",
    title: "I receive your file",
    desc: "I'll auto-detect your schema, validate every coordinate, and flag any issues before I begin.",
    value: "No manual mapping needed \u2014 just hand me the file",
  },
  {
    icon: "\uD83D\uDCCD",
    title: "I map every halt",
    desc: "I group nearby stoppages into location clusters using spatial analysis \u2014 revealing patterns you can't see in raw data.",
    value: "Repeat halt zones become instantly visible",
  },
  {
    icon: "\uD83D\uDD0D",
    title: "I identify each location",
    desc: "I match every halt against 1.2 million points of interest \u2014 fuel stations, toll booths, dhabas, industrial gates.",
    value: "I tell you WHY each vehicle stopped, not just WHERE",
  },
  {
    icon: "\uD83D\uDEE1\uFE0F",
    title: "I classify the risk",
    desc: "Each stop gets a verdict: Known Functional, Other Legitimate, or Unauthorized \u2014 based on proximity to known POIs.",
    value: "Unauthorized = no POI within 2km. That's your highest risk.",
  },
  {
    icon: "\uD83C\uDF19",
    title: "I flag night halts",
    desc: "Clusters with high night halt percentage get special attention \u2014 stops between 8PM and 6AM in unknown locations.",
    value: "Night stops at unidentified locations are the #1 theft signal",
  },
  {
    icon: "\uD83D\uDCCA",
    title: "I brief you on each route",
    desc: "I aggregate stoppages by route code \u2014 showing you which corridors are problematic and which drivers halt most.",
    value: "Focus your operations team on routes that matter",
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
          {/* Sarthak's stamp badge appears when truck stops */}
          {truckPhase === "stopped" && (
            <div
              style={{
                position: "absolute",
                left: `${truckLeft + 6}%`,
                bottom: 50,
                fontSize: 18,
                animation: "stampAppear 0.6s ease-out forwards",
                opacity: 0,
              }}
            >
              {"\uD83D\uDEE1\uFE0F"}
            </div>
          )}
        </div>

        <h1 style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.15, marginBottom: 4 }}>
          I'm <span style={{ color: "var(--brand)" }}>Sarthak</span>
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", marginBottom: 12, fontWeight: 500 }}>
          Your Logistics Compliance Officer
        </p>
        <p
          style={{
            fontSize: 15,
            color: "var(--text-secondary)",
            lineHeight: 1.7,
            maxWidth: 480,
            margin: "0 auto 28px",
          }}
        >
          Hand me your stoppage alerts — I'll tell you exactly where your fleet is halting, whether each stop is legitimate, and which ones need your immediate attention.
        </p>

        {/* CTA */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {hasData && (
            <button onClick={onExplore} className="brand-btn-solid">
              See My Report
            </button>
          )}
          <button onClick={onUpload} className="brand-btn-outline">
            Hand Me Your Data
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
          Here's how I review your stoppages
        </h2>
        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
            marginBottom: 28,
          }}
        >
          Every halt goes through my 6-step review process
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
              My report is ready
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.5 }}>
              I've reviewed {stats!.totalEvents.toLocaleString()} stoppage events across {stats!.routes.toLocaleString()} routes. Here's what I found.
            </p>
            <button onClick={onExplore} className="brand-btn-solid">
              Read My Briefing
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "16px 24px 28px", color: "var(--text-muted)", fontSize: 11 }}>
        Sarthak &middot; Freight Tiger Compliance Intelligence
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
        @keyframes stampAppear {
          0% { opacity: 0; transform: scale(2) rotate(-20deg); }
          60% { opacity: 1; transform: scale(0.9) rotate(5deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
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
