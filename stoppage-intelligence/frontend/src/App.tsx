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

  const refreshUploads = async () => {
    const r = await api.get("/uploads");
    const list: UploadRecord[] = r.data.uploads;
    setUploads(list);
    return list;
  };

  useEffect(() => {
    refreshUploads().then((list) => {
      const completed = list.filter((u) => u.status === "complete");
      if (completed.length > 0) {
        setActiveUploadId(completed[0].id);
        setView("results");
      }
    });
  }, []);

  const handleProcessed = async (uploadId: number) => {
    await refreshUploads();
    setActiveUploadId(uploadId);
    setView("results");
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

      {view === "upload" && (
        <UploadStep
          onProcessed={handleProcessed}
          onSkip={
            activeUploadId
              ? () => setView("results")
              : undefined
          }
        />
      )}

      {view === "results" && activeUploadId && (
        <ResultsView uploadId={activeUploadId} />
      )}
    </div>
  );
}
