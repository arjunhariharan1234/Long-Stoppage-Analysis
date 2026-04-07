import { useState, useEffect } from "react";
import api from "./api/client";
import { fetchStatic } from "./api/static";
import LandingPage from "./pages/LandingPage";
import UploadStep from "./pages/UploadStep";
import ResultsView from "./pages/ResultsView";
import "./index.css";

export interface UploadRecord {
  id: number;
  filename: string;
  uploaded_at: string;
  row_count: number;
  valid_row_count: number | null;
  invalid_row_count: number | null;
  status: string;
}

interface LandingStats {
  totalEvents: number;
  routes: number;
  trips: number;
  knownFunctional: number;
  otherLegit: number;
  unauthorized: number;
}

// Sarthak's review desk loading screen
function LoadingScreen({ msg }: { msg: string }) {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 400);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 20, padding: 40 }}>
      {/* Clipboard and stamp animation */}
      <div style={{ position: "relative", width: 260, height: 70, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* Clipboard */}
        <div style={{
          fontSize: 42,
          animation: "clipboardFloat 2s ease-in-out infinite",
        }}>
          {"\uD83D\uDCCB"}
        </div>
        {/* Pen writing */}
        <div style={{
          position: "absolute", right: 70, bottom: 8, fontSize: 24,
          animation: "penWrite 1.5s ease-in-out infinite",
        }}>
          {"\u270D\uFE0F"}
        </div>
        {/* Stamp appearing */}
        <div style={{
          position: "absolute", left: 70, top: 4, fontSize: 20,
          color: "var(--brand)",
          animation: "stampPulse 2s ease-in-out infinite",
        }}>
          {"\uD83D\uDEE1\uFE0F"}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <p style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 500 }}>{msg}{dots}</p>
        <p style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 6 }}>
          Setting up my review desk
        </p>
      </div>

      {/* Progress shimmer */}
      <div style={{ width: 200, height: 4, borderRadius: 2, background: "var(--bg-tertiary)", overflow: "hidden" }}>
        <div style={{
          width: "40%", height: "100%", borderRadius: 2,
          background: "linear-gradient(90deg, var(--brand), #ffdb4d)",
          animation: "shimmer 1.5s ease-in-out infinite",
        }} />
      </div>

      <style>{`
        @keyframes clipboardFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes penWrite {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(4px, -2px) rotate(-5deg); }
          50% { transform: translate(-2px, 2px) rotate(3deg); }
          75% { transform: translate(3px, -1px) rotate(-3deg); }
        }
        @keyframes stampPulse {
          0%, 70% { opacity: 0.3; transform: scale(0.8); }
          80% { opacity: 1; transform: scale(1.2); }
          100% { opacity: 0.6; transform: scale(1); }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  const [activeUploadId, setActiveUploadId] = useState<number | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [view, setView] = useState<"landing" | "upload" | "results">("landing");
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Agent Sarthak is getting ready");
  const [landingStats, setLandingStats] = useState<LandingStats | null>(null);

  const loadData = async (): Promise<UploadRecord[]> => {
    // Try static JSON first (instant, no backend needed)
    try {
      setLoadingMsg("Reviewing your records");
      const [uploadsData, summaryData] = await Promise.all([
        fetchStatic("uploads.json"),
        fetchStatic("summary.json"),
      ]);
      const list: UploadRecord[] = uploadsData.uploads;
      setUploads(list);
      setBackendError(false);

      const completed = list.filter((u) => u.status === "complete");
      if (completed.length > 0) {
        setActiveUploadId(completed[0].id);
        const ec = summaryData.event_classification || {};
        setLandingStats({
          totalEvents: summaryData.valid_events || 0,
          routes: summaryData.distinct_routes || 0,
          trips: summaryData.distinct_trips || 0,
          knownFunctional: ec.known_functional || 0,
          otherLegit: ec.other_legit || 0,
          unauthorized: ec.unauthorized || 0,
        });
      }
      return list;
    } catch {
      // Static not available — fall back to backend API
      setLoadingMsg("Connecting to the analysis desk");
    }

    // Backend fallback
    for (let i = 1; i <= 3; i++) {
      try {
        setLoadingMsg(i === 1 ? "Agent Sarthak is getting ready" : "Still preparing... hold on");
        await api.get("/health", { timeout: 90000 });
        break;
      } catch {
        if (i === 3) { setBackendError(true); return []; }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    try {
      setLoadingMsg("Pulling up your case files");
      const r = await api.get("/uploads", { timeout: 30000 });
      const list: UploadRecord[] = r.data.uploads;
      setUploads(list);
      setBackendError(false);
      const completed = list.filter((u) => u.status === "complete");
      if (completed.length > 0) setActiveUploadId(completed[0].id);
      return list;
    } catch {
      setBackendError(false);
      return [];
    }
  };

  const refreshUploads = async (): Promise<UploadRecord[]> => {
    try {
      const r = await api.get("/uploads", { timeout: 15000 });
      const list: UploadRecord[] = r.data.uploads;
      setUploads(list);
      return list;
    } catch {
      return uploads;
    }
  };

  useEffect(() => {
    loadData().then((list) => {
      const completed = list.filter((u) => u.status === "complete");
      if (completed.length > 0) {
        setActiveUploadId(completed[0].id);
        setView("landing");
      }
      setLoading(false);
    });
  }, []);

  const handleProcessed = async (uploadId: number) => {
    await refreshUploads();
    setActiveUploadId(uploadId);
    setView("results");
  };

  const handleRetry = async () => {
    setLoading(true);
    setBackendError(false);
    const list = await loadData();
    const completed = list.filter((u) => u.status === "complete");
    if (completed.length > 0) {
      setActiveUploadId(completed[0].id);
      setView("landing");
    }
    setLoading(false);
  };

  return (
    <div className="app-container">
      <nav className="nav" style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}>
        <h1
          onClick={() => setView("landing")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: "50%", background: "#1a1d23",
            border: "2px solid var(--brand)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--brand)",
            flexShrink: 0,
          }}>S</div>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Agent Sarthak</span>
            <span style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 400 }}>Logistics Compliance Officer</span>
          </span>
        </h1>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
          {activeUploadId && view !== "results" && (
            <button
              className="btn"
              onClick={() => setView("results")}
              style={{ fontSize: 13, borderColor: "var(--brand)", color: "var(--brand)" }}
            >
              My Briefing
            </button>
          )}
          {view !== "upload" && (
            <button
              className="btn"
              onClick={() => setView("upload")}
              style={{
                fontSize: 13,
                background: "var(--brand)",
                color: "#0f1117",
                border: "none",
                fontWeight: 600,
              }}
            >
              Submit Report
            </button>
          )}
        </div>
      </nav>

      {/* Loading */}
      {loading && <LoadingScreen msg={loadingMsg} />}

      {/* Backend unreachable — still show landing */}
      {!loading && backendError && (
        <LandingPage
          stats={null}
          onExplore={() => {}}
          onUpload={() => {
            setBackendError(false);
            setView("upload");
          }}
        />
      )}

      {/* Landing */}
      {!loading && !backendError && view === "landing" && (
        <LandingPage
          stats={landingStats}
          onExplore={() => setView("results")}
          onUpload={() => setView("upload")}
        />
      )}

      {/* Upload */}
      {!loading && !backendError && view === "upload" && (
        <UploadStep
          onProcessed={handleProcessed}
          onSkip={activeUploadId ? () => setView("results") : undefined}
        />
      )}

      {/* Results */}
      {!loading && !backendError && view === "results" && activeUploadId && (
        <ResultsView uploadId={activeUploadId} />
      )}
    </div>
  );
}
