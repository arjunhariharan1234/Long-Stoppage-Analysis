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

// Engaging loading screen with truck animation
function LoadingScreen({ msg }: { msg: string }) {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 400);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 20, padding: 40 }}>
      {/* Animated truck driving across */}
      <div style={{ position: "relative", width: 260, height: 70, overflow: "hidden" }}>
        {/* Road */}
        <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, height: 2, background: "var(--border)" }} />
        <div style={{
          position: "absolute", bottom: 11, left: 0, right: 0, height: 1,
          backgroundImage: "repeating-linear-gradient(90deg, var(--text-secondary) 0, var(--text-secondary) 8px, transparent 8px, transparent 20px)",
          opacity: 0.3,
          animation: "roadScroll 1s linear infinite",
        }} />
        {/* Truck */}
        <div style={{
          position: "absolute", bottom: 10, fontSize: 36,
          animation: "truckDrive 3s ease-in-out infinite",
        }}>
          {"\uD83D\uDE9A"}
        </div>
        {/* Location pins */}
        <div style={{ position: "absolute", right: 30, bottom: 16, fontSize: 20, animation: "pinPulse 1.5s ease-in-out infinite" }}>
          {"\uD83D\uDCCD"}
        </div>
        <div style={{ position: "absolute", right: 60, bottom: 16, fontSize: 14, opacity: 0.5, animation: "pinPulse 1.5s ease-in-out infinite 0.3s" }}>
          {"\uD83D\uDCCD"}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <p style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 500 }}>{msg}{dots}</p>
        <p style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 6 }}>
          Preparing your stoppage analysis
        </p>
      </div>

      {/* Progress shimmer */}
      <div style={{ width: 200, height: 4, borderRadius: 2, background: "var(--bg-tertiary)", overflow: "hidden" }}>
        <div style={{
          width: "40%", height: "100%", borderRadius: 2,
          background: "linear-gradient(90deg, var(--blue), var(--green))",
          animation: "shimmer 1.5s ease-in-out infinite",
        }} />
      </div>

      <style>{`
        @keyframes roadScroll {
          from { background-position: 0 0; }
          to { background-position: -20px 0; }
        }
        @keyframes truckDrive {
          0% { left: -10%; }
          50% { left: 45%; }
          100% { left: -10%; }
        }
        @keyframes pinPulse {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-4px) scale(1.1); }
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
  const [loadingMsg, setLoadingMsg] = useState("Waking up the server");
  const [landingStats, setLandingStats] = useState<LandingStats | null>(null);

  const loadData = async (): Promise<UploadRecord[]> => {
    // Try static JSON first (instant, no backend needed)
    try {
      setLoadingMsg("Loading analysis");
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
      setLoadingMsg("Connecting to backend");
    }

    // Backend fallback
    for (let i = 1; i <= 3; i++) {
      try {
        setLoadingMsg(i === 1 ? "Waking up the server" : `Starting backend (attempt ${i}/3)`);
        await api.get("/health", { timeout: 90000 });
        break;
      } catch {
        if (i === 3) { setBackendError(true); return []; }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    try {
      setLoadingMsg("Loading data from server");
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
      <nav className="nav">
        <h1
          onClick={() => setView(activeUploadId ? "landing" : "upload")}
          style={{ cursor: "pointer" }}
        >
          Stoppage Intelligence Platform
        </h1>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
          {uploads.filter((u) => u.status === "complete").length > 0 && (
            <>
              <select
                value={activeUploadId ?? ""}
                onChange={(e) => {
                  setActiveUploadId(Number(e.target.value));
                  setView("results");
                }}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  padding: "6px 10px",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                {uploads
                  .filter((u) => u.status === "complete")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.filename}
                    </option>
                  ))}
              </select>
              <button
                className={`btn ${view === "results" ? "primary" : ""}`}
                onClick={() => setView("results")}
              >
                Dashboard
              </button>
            </>
          )}
          <button
            className={`btn ${view === "upload" ? "primary" : ""}`}
            onClick={() => setView("upload")}
          >
            + New Upload
          </button>
        </div>
      </nav>

      {/* Loading */}
      {loading && <LoadingScreen msg={loadingMsg} />}

      {/* Backend unreachable */}
      {!loading && backendError && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: 40 }}>
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>{"\u26A0\uFE0F"}</div>
            <h2 style={{ marginBottom: 12 }}>Could not reach backend</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              The server may be starting up. On free hosting, the first request can take 30-60 seconds.
            </p>
            <button className="btn primary" onClick={handleRetry} style={{ fontSize: 14, padding: "10px 24px" }}>
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Landing */}
      {!loading && !backendError && view === "landing" && (
        <LandingPage
          stats={landingStats}
          onExplore={() => setView("results")}
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
