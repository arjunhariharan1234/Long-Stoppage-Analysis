import { useState, useEffect } from "react";
import api from "./api/client";
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

export default function App() {
  const [activeUploadId, setActiveUploadId] = useState<number | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [view, setView] = useState<"upload" | "results">("upload");
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState(false);

  const refreshUploads = async (retries = 3): Promise<UploadRecord[]> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const r = await api.get("/uploads", { timeout: 60000 });
        const list: UploadRecord[] = r.data.uploads;
        setUploads(list);
        setBackendError(false);
        return list;
      } catch {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 3000));
        } else {
          setBackendError(true);
          return [];
        }
      }
    }
    return [];
  };

  useEffect(() => {
    refreshUploads().then((list) => {
      const completed = list.filter((u) => u.status === "complete");
      if (completed.length > 0) {
        setActiveUploadId(completed[0].id);
        setView("results");
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
    const list = await refreshUploads();
    const completed = list.filter((u) => u.status === "complete");
    if (completed.length > 0) {
      setActiveUploadId(completed[0].id);
      setView("results");
    }
    setLoading(false);
  };

  return (
    <div className="app-container">
      <nav className="nav">
        <h1>Stoppage Intelligence Platform</h1>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
          {uploads.filter((u) => u.status === "complete").length > 0 && (
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
          )}
          <button
            className={`btn ${view === "upload" ? "primary" : ""}`}
            onClick={() => setView("upload")}
          >
            + New Upload
          </button>
        </div>
      </nav>

      {/* Loading state */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 16, padding: 40 }}>
          <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Connecting to backend...</p>
          <p style={{ color: "var(--text-secondary)", fontSize: 12 }}>First load may take up to 60 seconds while the server wakes up</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Backend unreachable */}
      {!loading && backendError && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: 40 }}>
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#9888;&#65039;</div>
            <h2 style={{ marginBottom: 12 }}>Could not reach backend</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              The server may be starting up. On free hosting, the first request can take 30–60 seconds.
              Click below to retry.
            </p>
            <button className="btn primary" onClick={handleRetry} style={{ fontSize: 14, padding: "10px 24px" }}>
              Try again
            </button>
            <div style={{ marginTop: 24, padding: "14px 18px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, textAlign: "left" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Running locally?</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6 }}>
                Make sure the backend is running:<br />
                <code style={{ color: "var(--blue)" }}>cd stoppage-intelligence/backend && python3 -m uvicorn app.main:app --port 8000</code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Normal views */}
      {!loading && !backendError && view === "upload" && (
        <UploadStep
          onProcessed={handleProcessed}
          onSkip={activeUploadId ? () => setView("results") : undefined}
        />
      )}

      {!loading && !backendError && view === "results" && activeUploadId && (
        <ResultsView uploadId={activeUploadId} />
      )}
    </div>
  );
}
