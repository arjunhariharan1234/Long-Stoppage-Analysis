import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import api from "../api/client";

interface UploadResult {
  upload_id: number;
  filename: string;
  row_count: number;
  columns: string[];
  proposed_mapping: Record<string, string>;
  warnings: string[];
  preview: Record<string, unknown>[];
}

interface Props {
  onProcessed: (uploadId: number) => void;
  onSkip?: () => void;
}

const STEP_LABELS = [
  "Upload File",
  "Review Schema",
  "Processing",
  "Done",
];

export default function UploadStep({ onProcessed, onSkip }: Props) {
  const [step, setStep] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setUploading(true);

    const form = new FormData();
    form.append("file", files[0]);

    try {
      const res = await api.post("/upload", form);
      setUploadResult(res.data);
      setStep(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "text/csv": [".csv"],
    },
    maxFiles: 1,
  });

  const handleProcess = async () => {
    if (!uploadResult) return;
    setProcessing(true);
    setStep(2);
    setProgress("Validating and normalizing events...");
    setError(null);

    try {
      const res = await api.post(`/upload/${uploadResult.upload_id}/confirm`);
      setProgress("Complete!");
      setStep(3);

      // Brief pause to show success, then transition
      setTimeout(() => onProcessed(res.data.upload_id), 800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Processing failed");
      setStep(1);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="page-content">
      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 24px 24px", justifyContent: "center" }}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  background: i <= step ? (i === step ? "var(--blue)" : "var(--green)") : "var(--bg-tertiary)",
                  color: i <= step ? "#fff" : "var(--text-secondary)",
                  border: `2px solid ${i <= step ? (i === step ? "var(--blue)" : "var(--green)") : "var(--border)"}`,
                }}
              >
                {i < step ? "\u2713" : i + 1}
              </div>
              <span style={{ fontSize: 11, color: i <= step ? "var(--text-primary)" : "var(--text-secondary)" }}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                style={{
                  width: 60,
                  height: 2,
                  background: i < step ? "var(--green)" : "var(--border)",
                  margin: "0 8px",
                  marginBottom: 18,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="panel" style={{ margin: "0 24px 20px", borderColor: "var(--red)" }}>
          <p style={{ color: "var(--red)" }}>{error}</p>
        </div>
      )}

      {/* Step 0: Upload */}
      {step === 0 && (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px" }}>
          <div className="panel">
            <div {...getRootProps()} className={`dropzone ${isDragActive ? "active" : ""}`}>
              <input {...getInputProps()} />
              <div style={{ fontSize: 40, marginBottom: 12 }}>{uploading ? "\u23F3" : "\u{1F4C4}"}</div>
              <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text-primary)" }}>
                {uploading ? "Uploading..." : "Drop your stoppage alert file here"}
              </p>
              <p style={{ marginTop: 8 }}>Supports .xlsx and .csv files</p>
            </div>
          </div>
          {onSkip && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button className="btn" onClick={onSkip}>
                Skip — view existing analysis
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Review schema */}
      {step === 1 && uploadResult && (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px" }}>
          <div className="kpi-strip" style={{ padding: "0 0 20px" }}>
            <div className="kpi-card">
              <div className="label">File</div>
              <div className="value" style={{ fontSize: 14, color: "var(--blue)" }}>{uploadResult.filename}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Total Rows</div>
              <div className="value blue">{uploadResult.row_count.toLocaleString()}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Columns Detected</div>
              <div className="value green">{Object.keys(uploadResult.proposed_mapping).length} / {uploadResult.columns.length}</div>
            </div>
          </div>

          {uploadResult.warnings.length > 0 && (
            <div className="panel" style={{ borderColor: "var(--yellow)", marginBottom: 20 }}>
              <h2 style={{ color: "var(--yellow)" }}>Warnings</h2>
              {uploadResult.warnings.map((w, i) => (
                <p key={i} style={{ color: "var(--yellow)", fontSize: 13 }}>{w}</p>
              ))}
            </div>
          )}

          <div className="panel" style={{ marginBottom: 20 }}>
            <h2>Column Mapping</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
              Auto-detected mapping from your file columns to internal fields
            </p>
            <table>
              <thead>
                <tr><th>Your Column</th><th>Mapped To</th><th>Status</th></tr>
              </thead>
              <tbody>
                {uploadResult.columns.map((col) => {
                  const mapped = uploadResult.proposed_mapping[col];
                  return (
                    <tr key={col}>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{col}</td>
                      <td>{mapped ? <span className="badge known_functional">{mapped}</span> : <span style={{ color: "var(--text-secondary)" }}>—</span>}</td>
                      <td>{mapped ? <span style={{ color: "var(--green)", fontSize: 12 }}>Auto-detected</span> : <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Skipped</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="panel" style={{ marginBottom: 20 }}>
            <h2>Data Preview</h2>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    {uploadResult.columns.map((c) => (
                      <th key={c} style={{ whiteSpace: "nowrap" }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uploadResult.preview.map((row, i) => (
                    <tr key={i}>
                      {uploadResult.columns.map((c) => (
                        <td key={c} style={{ whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {String(row[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => { setStep(0); setUploadResult(null); }}>
              Back
            </button>
            <button className="btn primary" onClick={handleProcess} disabled={processing}>
              Process File
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Processing */}
      {step === 2 && (
        <div style={{ maxWidth: 500, margin: "40px auto", textAlign: "center", padding: "0 24px" }}>
          <div className="panel">
            <div style={{ fontSize: 48, marginBottom: 16 }}>{"\u2699\uFE0F"}</div>
            <h2 style={{ marginBottom: 12 }}>Processing your data...</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left", padding: "16px 0" }}>
              {[
                "Validating schema",
                "Normalizing events",
                "Clustering stoppages at 200m, 500m, 1km, 2km",
                "Matching nearest POIs from 1.2M locations",
                "Classifying halt types",
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 13 }}>
                  <span className="status-dot processing" /> {s}
                </div>
              ))}
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>{progress}</p>
          </div>
        </div>
      )}

      {/* Step 3: Done (brief flash) */}
      {step === 3 && (
        <div style={{ maxWidth: 500, margin: "40px auto", textAlign: "center", padding: "0 24px" }}>
          <div className="panel">
            <div style={{ fontSize: 48, marginBottom: 16 }}>{"\u2705"}</div>
            <h2>Analysis Complete</h2>
            <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>Loading your results...</p>
          </div>
        </div>
      )}
    </div>
  );
}
