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

const CAPABILITIES = [
  {
    icon: "\uD83D\uDCCD",
    title: "Halt Clustering",
    desc: "Groups nearby stoppages using DBSCAN spatial clustering to reveal repeat halt zones",
  },
  {
    icon: "\u26FD",
    title: "POI Intelligence",
    desc: "Matches each halt to 1.2M+ Points of Interest — fuel stations, toll booths, dhabas, gates",
  },
  {
    icon: "\uD83D\uDEE1\uFE0F",
    title: "Risk Classification",
    desc: "Flags unauthorized stops with no nearby POI — the highest-risk pattern for theft or breakdown",
  },
  {
    icon: "\uD83D\uDCCA",
    title: "Route Analytics",
    desc: "Identifies top stoppage routes, peak hours, night halt patterns, and cluster hotspots",
  },
];

export default function LandingPage({ onExplore, onUpload, stats }: Props) {
  const [visible, setVisible] = useState(false);
  const [truckPos, setTruckPos] = useState(0);

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    const t = setInterval(() => setTruckPos((p) => (p >= 100 ? 0 : p + 0.5)), 50);
    return () => clearInterval(t);
  }, []);

  const hasData = stats && stats.totalEvents > 0;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.6s ease-out",
      }}
    >
      {/* Hero section */}
      <div
        style={{
          position: "relative",
          padding: "60px 24px 50px",
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        {/* Animated road scene */}
        <div
          style={{
            position: "relative",
            height: 90,
            maxWidth: 600,
            margin: "0 auto 32px",
            overflow: "hidden",
          }}
        >
          {/* Road surface */}
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 0,
              right: 0,
              height: 4,
              background: "var(--border-light)",
              borderRadius: 2,
            }}
          />
          {/* Road dashes */}
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 0,
              right: 0,
              height: 2,
              backgroundImage:
                "repeating-linear-gradient(90deg, var(--text-muted) 0, var(--text-muted) 12px, transparent 12px, transparent 28px)",
              opacity: 0.3,
              animation: "roadScroll 1.2s linear infinite",
            }}
          />
          {/* Location pins along route */}
          {[15, 35, 55, 75, 90].map((pos, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${pos}%`,
                bottom: 24,
                fontSize: i === 2 ? 26 : 18,
                opacity: i === 2 ? 1 : 0.4,
                animation: `pinFloat 2.5s ease-in-out infinite ${i * 0.3}s`,
                color: i === 2 ? "var(--brand)" : "var(--text-muted)",
                filter:
                  i === 2
                    ? "drop-shadow(0 0 8px rgba(255, 190, 7, 0.4))"
                    : "none",
              }}
            >
              {"\uD83D\uDCCD"}
            </div>
          ))}
          {/* Truck */}
          <div
            style={{
              position: "absolute",
              left: `${truckPos}%`,
              bottom: 14,
              fontSize: 32,
              transition: "left 0.05s linear",
              filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
            }}
          >
            {"\uD83D\uDE9A"}
          </div>
        </div>

        <h1
          style={{
            fontSize: 40,
            fontWeight: 700,
            lineHeight: 1.15,
            marginBottom: 14,
            color: "var(--text-primary)",
          }}
        >
          Stoppage{" "}
          <span style={{ color: "var(--brand)" }}>Intelligence</span>
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "var(--text-secondary)",
            lineHeight: 1.7,
            maxWidth: 520,
            margin: "0 auto 32px",
          }}
        >
          Identify where your fleet stops, why it stops, and whether each halt
          is a legitimate logistics operation or an unauthorized risk.
        </p>

        {/* CTA buttons */}
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {hasData && (
            <button
              onClick={onExplore}
              style={{
                background: "var(--brand)",
                color: "#0f1117",
                border: "none",
                padding: "12px 32px",
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(255, 190, 7, 0.25)",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow =
                  "0 6px 24px rgba(255, 190, 7, 0.35)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow =
                  "0 4px 16px rgba(255, 190, 7, 0.25)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              View Analysis
            </button>
          )}
          <button
            onClick={onUpload}
            style={{
              background: "transparent",
              color: "var(--brand)",
              border: "1px solid var(--brand)",
              padding: "12px 32px",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--brand-dim)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            Upload Stoppage Data
          </button>
        </div>
      </div>

      {/* Capabilities grid */}
      <div
        style={{
          padding: "0 24px 48px",
          maxWidth: 900,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 16,
          }}
        >
          {CAPABILITIES.map((cap, i) => (
            <div
              key={i}
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "20px 18px",
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(12px)",
                transition: `all 0.5s ease-out ${0.15 * i}s`,
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>{cap.icon}</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: 6,
                }}
              >
                {cap.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                {cap.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div
        style={{
          padding: "32px 24px 48px",
          maxWidth: 700,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <h2
          style={{
            textAlign: "center",
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 24,
            color: "var(--text-primary)",
          }}
        >
          How it works
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            {
              step: "1",
              label: "Upload",
              detail: "Drop your stoppage alert CSV or XLSX",
            },
            {
              step: "2",
              label: "Cluster",
              detail: "DBSCAN groups halts by proximity",
            },
            {
              step: "3",
              label: "Enrich",
              detail: "Match each halt to 1.2M+ POIs",
            },
            {
              step: "4",
              label: "Classify",
              detail: "Authorized vs. unauthorized stops",
            },
            {
              step: "5",
              label: "Analyze",
              detail: "Map, insights, route breakdown",
            },
          ].map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "12px 0",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--brand-dim)",
                  border: "1px solid var(--brand)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--brand)",
                  flexShrink: 0,
                }}
              >
                {s.step}
              </div>
              {i < 4 && (
                <div
                  style={{
                    position: "absolute",
                    marginLeft: 15,
                    marginTop: 48,
                    width: 2,
                    height: 12,
                    background: "var(--border)",
                  }}
                />
              )}
              <div>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: "var(--text-primary)",
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  {s.detail}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          padding: "20px 24px 32px",
          color: "var(--text-muted)",
          fontSize: 12,
        }}
      >
        Freight Tiger &middot; Control Centre Intelligence
      </div>

      <style>{`
        @keyframes roadScroll {
          from { background-position: 0 0; }
          to { background-position: -28px 0; }
        }
        @keyframes pinFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
