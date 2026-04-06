import { useState, useCallback, useRef, useEffect } from "react";
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

const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

const STEP_LABELS = ["Upload File", "Review Schema", "Processing", "Done"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Convert CSV/XLSX content to a compressed CSV for upload
async function compressFile(file: File): Promise<{ blob: Blob; name: string; originalSize: number; compressedSize: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        // Use CompressionStream API (supported in all modern browsers)
        const stream = new Blob([data]).stream();
        const compressed = stream.pipeThrough(new CompressionStream("gzip"));
        new Response(compressed).blob().then((blob) => {
          const name = file.name.replace(/\.(xlsx|csv)$/i, ".csv.gz");
          resolve({
            blob,
            name: file.name, // keep original name for backend
            originalSize: file.size,
            compressedSize: blob.size,
          });
        });
      } catch {
        reject(new Error("Compression failed"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

// --- Animated processing screen ---
const PIPELINE_STAGES = [
  { label: "Uploading file", icon: "\u2B06", duration: 8 },
  { label: "Parsing & validating schema", icon: "\uD83D\uDCCB", duration: 5 },
  { label: "Normalizing stoppage events", icon: "\uD83D\uDD27", duration: 10 },
  { label: "Clustering halts at 200m, 500m, 1km, 2km", icon: "\uD83D\uDCCD", duration: 25 },
  { label: "Matching nearest POIs from 1.2M locations", icon: "\uD83D\uDDFA\uFE0F", duration: 40 },
  { label: "Classifying halt types", icon: "\uD83C\uDFF7\uFE0F", duration: 15 },
];
const TOTAL_EST_SECONDS = PIPELINE_STAGES.reduce((s, p) => s + p.duration, 0);

function ProcessingAnimation({ uploadPct }: { uploadPct: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Determine active stage based on elapsed time
  let cumulative = 0;
  let activeStage = PIPELINE_STAGES.length - 1;
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    cumulative += PIPELINE_STAGES[i].duration;
    if (elapsed < cumulative) { activeStage = i; break; }
  }

  // If still in upload phase (pct < 100), force stage 0
  if (uploadPct < 100) activeStage = 0;

  const remaining = Math.max(0, TOTAL_EST_SECONDS - elapsed);
  const progressPct = Math.min(95, (elapsed / TOTAL_EST_SECONDS) * 100);

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 24px" }}>
      <div className="panel" style={{ padding: "32px 28px", position: "relative", overflow: "hidden" }}>

        {/* Animated truck scene */}
        <div style={{ position: "relative", height: 120, marginBottom: 24, overflow: "hidden" }}>
          {/* Road */}
          <div style={{
            position: "absolute", bottom: 18, left: 0, right: 0, height: 3,
            background: "var(--border)", borderRadius: 2,
          }} />
          {/* Road dashes */}
          <div style={{
            position: "absolute", bottom: 22, left: 0, right: 0, height: 2,
            backgroundImage: "repeating-linear-gradient(90deg, var(--text-secondary) 0, var(--text-secondary) 12px, transparent 12px, transparent 28px)",
            opacity: 0.3,
            animation: "roadScroll 1.5s linear infinite",
          }} />

          {/* Location pin (pulsing) */}
          <div style={{
            position: "absolute", right: "15%", bottom: 28, fontSize: 28,
            animation: "pinPulse 2s ease-in-out infinite",
            filter: "drop-shadow(0 0 8px rgba(248, 81, 73, 0.5))",
          }}>
            {"\uD83D\uDCCD"}
          </div>

          {/* Truck */}
          <div style={{
            position: "absolute",
            left: `${Math.min(55, progressPct * 0.6)}%`,
            bottom: 22,
            fontSize: 44,
            transition: "left 1s ease-out",
            filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.4))",
          }}>
            {"\uD83D\uDE9A"}
          </div>

          {/* Clock floating above truck */}
          <div style={{
            position: "absolute",
            left: `${Math.min(55, progressPct * 0.6) + 3}%`,
            bottom: 72,
            fontSize: 22,
            animation: "clockTick 1s steps(1) infinite",
            transition: "left 1s ease-out",
          }}>
            {elapsed % 2 === 0 ? "\u23F0" : "\u{1F570}\uFE0F"}
          </div>

          {/* Floating data particles */}
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{
              position: "absolute",
              left: `${20 + i * 15}%`,
              top: `${10 + (i % 3) * 15}px`,
              fontSize: 12,
              opacity: 0.15 + (i === (Math.floor(elapsed / 2) % 5) ? 0.5 : 0),
              transition: "opacity 0.5s",
              color: "var(--blue)",
            }}>
              {["\u2022", "\u25CF", "\u25B2", "\u25A0", "\u2B24"][i]}
            </div>
          ))}
        </div>

        {/* Title */}
        <h2 style={{ textAlign: "center", marginBottom: 6, fontSize: 20 }}>
          Analyzing your stoppages
        </h2>
        <p style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: 13, marginBottom: 20 }}>
          {remaining > 0
            ? `Estimated time remaining: ~${remaining > 60 ? `${Math.ceil(remaining / 60)} min` : `${remaining}s`}`
            : "Almost done, finalizing..."
          }
        </p>

        {/* Progress bar */}
        <div style={{
          height: 6, borderRadius: 3, background: "var(--bg-tertiary)",
          marginBottom: 24, overflow: "hidden",
        }}>
          <div style={{
            height: "100%", borderRadius: 3,
            width: `${progressPct}%`,
            background: "linear-gradient(90deg, var(--blue), var(--green))",
            transition: "width 1s linear",
            boxShadow: "0 0 12px rgba(88, 166, 255, 0.4)",
          }} />
        </div>

        {/* Pipeline stages */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PIPELINE_STAGES.map((stage, i) => {
            const done = i < activeStage;
            const active = i === activeStage;
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "6px 10px", borderRadius: 6,
                background: active ? "rgba(88, 166, 255, 0.08)" : "transparent",
                border: active ? "1px solid rgba(88, 166, 255, 0.2)" : "1px solid transparent",
                transition: "all 0.3s",
              }}>
                <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>
                  {done ? "\u2705" : active ? stage.icon : "\u2B1C"}
                </span>
                <span style={{
                  fontSize: 13,
                  color: done ? "var(--green)" : active ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: active ? 600 : 400,
                }}>
                  {stage.label}
                </span>
                {active && (
                  <span style={{
                    marginLeft: "auto", width: 14, height: 14,
                    border: "2px solid var(--blue)", borderTopColor: "transparent",
                    borderRadius: "50%", animation: "spin 0.8s linear infinite",
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Fun fact ticker */}
        <div style={{
          marginTop: 20, padding: "10px 14px",
          background: "var(--bg-tertiary)", borderRadius: 8,
          fontSize: 12, color: "var(--text-secondary)", textAlign: "center",
          lineHeight: 1.5,
        }}>
          {[
            "\uD83D\uDCA1 Scanning 1.2 million POIs across India — fuel stations, toll booths, dhabas, and more",
            "\uD83D\uDE9A The average long-haul truck makes 8-12 unplanned stops per trip",
            "\uD83D\uDCCA DBSCAN clustering groups halts by proximity — no predefined cluster count needed",
            "\u26FD A fuel station within 500m is a 'known functional' stop — no alert needed",
            "\uD83C\uDF19 Night halts (8PM–6AM) at unknown locations are flagged as highest risk",
            "\uD83D\uDDFA\uFE0F Each stoppage is matched to the nearest point of interest using spatial indexing",
          ][Math.floor(elapsed / 8) % 6]}
        </div>
      </div>

      <style>{`
        @keyframes roadScroll {
          from { background-position: 0 0; }
          to { background-position: -28px 0; }
        }
        @keyframes pinPulse {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-6px) scale(1.15); }
        }
        @keyframes clockTick {
          0% { transform: rotate(0deg); }
          50% { transform: rotate(10deg); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}


export default function UploadStep({ onProcessed, onSkip }: Props) {
  const [step, setStep] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileSizeIssue, setFileSizeIssue] = useState<{
    file: File;
    size: number;
  } | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [uploadPct, setUploadPct] = useState(0);

  const doUpload = useCallback(async (file: File | Blob, filename: string) => {
    setError(null);
    setUploading(true);
    setUploadPct(0);
    setStep(2); // Show processing animation immediately

    const form = new FormData();
    form.append("file", file, filename);

    try {
      const res = await api.post("/upload?auto_process=true", form, {
        timeout: 300000,
        onUploadProgress: (e) => {
          if (e.total) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadPct(pct);
          }
        },
      });
      setUploadResult(res.data);
      setFileSizeIssue(null);
      setStep(3);
      setTimeout(() => onProcessed(res.data.upload_id), 800);
    } catch (e: any) {
      setStep(0);
      const status = e?.response?.status;
      const msg = e?.response?.data?.detail || e?.message || "Upload failed";

      if (status === 413 || msg.includes("too large") || msg.includes("payload")) {
        setError(
          "The file is too large for the server to accept. Try compressing it using the button below, or use a smaller file."
        );
      } else if (msg.includes("Network Error") || msg.includes("timeout") || msg.includes("ECONNREFUSED")) {
        setError(
          "Could not reach the server. This usually means:\n\n" +
          "1. The backend is starting up (wait a moment, then retry)\n" +
          "2. You're on a slow connection — try again"
        );
      } else {
        setError(msg);
      }
    } finally {
      setUploading(false);
      setUploadProgress("");
      setUploadPct(0);
    }
  }, []);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const file = files[0];
      setError(null);
      setFileSizeIssue(null);

      // File size check
      if (file.size > MAX_FILE_SIZE) {
        setFileSizeIssue({ file, size: file.size });
        return;
      }

      doUpload(file, file.name);
    },
    [doUpload]
  );

  const handleCompress = async () => {
    if (!fileSizeIssue) return;
    setCompressing(true);
    setError(null);

    try {
      const result = await compressFile(fileSizeIssue.file);

      if (result.compressedSize > MAX_FILE_SIZE) {
        setError(
          `Even after compression, the file is ${formatSize(result.compressedSize)} (limit: ${MAX_FILE_SIZE_MB}MB). ` +
          `Try splitting your data into smaller time ranges or fewer columns.`
        );
        setCompressing(false);
        return;
      }

      setFileSizeIssue(null);
      setCompressing(false);

      // Upload the compressed file with original name
      doUpload(result.blob, fileSizeIssue.file.name);
    } catch {
      setError("Compression failed. Try converting your file to CSV before uploading.");
      setCompressing(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "text/csv": [".csv"],
    },
    maxFiles: 1,
    disabled: uploading || compressing,
  });

  const handleProcess = async () => {
    if (!uploadResult) return;
    setProcessing(true);
    setStep(2);
    setError(null);

    try {
      const res = await api.post(`/upload/${uploadResult.upload_id}/confirm`, null, {
        timeout: 300000,
      });
      setStep(3);
      setTimeout(() => onProcessed(res.data.upload_id), 800);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || "Processing failed";
      if (msg.includes("Network Error") || msg.includes("timeout")) {
        setError(
          "Processing is taking longer than expected. This can happen with large datasets on cloud hosting.\n\n" +
          "What you can do:\n" +
          "- Wait a moment and try again — the server may have been processing in the background\n" +
          "- For files with 50K+ rows, run the platform locally for best performance"
        );
      } else {
        setError(msg);
      }
      setStep(1);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="page-content">
      {/* Step indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          padding: "0 24px 24px",
          justifyContent: "center",
        }}
      >
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
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
                  background:
                    i <= step
                      ? i === step
                        ? "var(--blue)"
                        : "var(--green)"
                      : "var(--bg-tertiary)",
                  color: i <= step ? "#fff" : "var(--text-secondary)",
                  border: `2px solid ${
                    i <= step
                      ? i === step
                        ? "var(--blue)"
                        : "var(--green)"
                      : "var(--border)"
                  }`,
                }}
              >
                {i < step ? "\u2713" : i + 1}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color:
                    i <= step ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
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

      {/* Error banner */}
      {error && (
        <div
          className="panel"
          style={{ margin: "0 24px 20px", borderColor: "var(--red)" }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 18 }}>&#9888;&#65039;</span>
            <div>
              <p
                style={{
                  color: "var(--red)",
                  fontWeight: 600,
                  fontSize: 14,
                  marginBottom: 4,
                }}
              >
                Something went wrong
              </p>
              <p
                style={{
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {error}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* File size issue banner */}
      {fileSizeIssue && (
        <div
          className="panel"
          style={{
            margin: "0 24px 20px",
            borderColor: "var(--yellow)",
            maxWidth: 640,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ fontSize: 24 }}>&#128230;</span>
            <div style={{ flex: 1 }}>
              <p
                style={{
                  color: "var(--yellow)",
                  fontWeight: 600,
                  fontSize: 14,
                  marginBottom: 6,
                }}
              >
                File is too large to upload directly
              </p>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  marginBottom: 12,
                  lineHeight: 1.5,
                }}
              >
                Your file is{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {formatSize(fileSizeIssue.size)}
                </strong>{" "}
                but the server accepts up to{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {MAX_FILE_SIZE_MB}MB
                </strong>
                .
                <br />
                We can compress it right here in your browser before uploading —
                no data leaves your machine until you confirm.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <button
                  className="btn primary"
                  onClick={handleCompress}
                  disabled={compressing}
                  style={{ fontSize: 13 }}
                >
                  {compressing
                    ? "Compressing..."
                    : "Compress & Upload"}
                </button>
                <button
                  className="btn"
                  onClick={() => setFileSizeIssue(null)}
                  style={{ fontSize: 13 }}
                >
                  Choose a different file
                </button>
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  background: "var(--bg-tertiary)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                <strong style={{ color: "var(--text-primary)" }}>
                  Other options:
                </strong>
                <br />
                &#8226; Save your .xlsx as .csv (typically 2-3x smaller)
                <br />
                &#8226; Split the data into smaller date ranges
                <br />
                &#8226; Remove columns you don't need (only lat, lon, timestamp,
                trip ID, and route are required)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 0: Upload */}
      {step === 0 && !fileSizeIssue && (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px" }}>
          <div className="panel">
            <div
              {...getRootProps()}
              className={`dropzone ${isDragActive ? "active" : ""}`}
            >
              <input {...getInputProps()} />
              <div style={{ fontSize: 40, marginBottom: 12 }}>
                {uploading ? "\u23F3" : "\u{1F4C4}"}
              </div>
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                {uploading
                  ? uploadProgress || "Uploading..."
                  : "Drop your stoppage alert file here"}
              </p>
              <p style={{ marginTop: 8 }}>
                Supports .xlsx and .csv files (up to {MAX_FILE_SIZE_MB}MB — larger files
                will be auto-compressed)
              </p>
            </div>
          </div>

          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "14px 18px",
              marginTop: 16,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Expected schema
            </div>
            <div
              style={{
                color: "var(--text-secondary)",
                lineHeight: 1.7,
                fontSize: 12,
              }}
            >
              The file should contain stoppage alert data with columns like:
              <br />
              <code style={{ color: "var(--blue)" }}>Combined Created At</code>{" "}
              (timestamp),{" "}
              <code style={{ color: "var(--blue)" }}>Trip Id</code>,{" "}
              <code style={{ color: "var(--blue)" }}>Route Code</code>,{" "}
              <code style={{ color: "var(--blue)" }}>CURRENT_LAT</code> /{" "}
              <code style={{ color: "var(--blue)" }}>CURRENT_LONG</code>
              <br />
              Column names are auto-detected. Lat/Lon are required for spatial
              analysis.
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
              <div
                className="value"
                style={{ fontSize: 14, color: "var(--blue)" }}
              >
                {uploadResult.filename}
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">Total Rows</div>
              <div className="value blue">
                {uploadResult.row_count.toLocaleString()}
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">Columns Detected</div>
              <div className="value green">
                {Object.keys(uploadResult.proposed_mapping).length} /{" "}
                {uploadResult.columns.length}
              </div>
            </div>
          </div>

          {uploadResult.warnings.length > 0 && (
            <div
              className="panel"
              style={{ borderColor: "var(--yellow)", marginBottom: 20 }}
            >
              <h2 style={{ color: "var(--yellow)" }}>Warnings</h2>
              {uploadResult.warnings.map((w, i) => (
                <p key={i} style={{ color: "var(--yellow)", fontSize: 13 }}>
                  {w}
                </p>
              ))}
            </div>
          )}

          <div className="panel" style={{ marginBottom: 20 }}>
            <h2>Column Mapping</h2>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              Auto-detected mapping from your file columns to internal fields
            </p>
            <table>
              <thead>
                <tr>
                  <th>Your Column</th>
                  <th>Mapped To</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {uploadResult.columns.map((col) => {
                  const mapped = uploadResult.proposed_mapping[col];
                  return (
                    <tr key={col}>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                        {col}
                      </td>
                      <td>
                        {mapped ? (
                          <span className="badge known_functional">
                            {mapped}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-secondary)" }}>
                            —
                          </span>
                        )}
                      </td>
                      <td>
                        {mapped ? (
                          <span
                            style={{ color: "var(--green)", fontSize: 12 }}
                          >
                            Auto-detected
                          </span>
                        ) : (
                          <span
                            style={{
                              color: "var(--text-secondary)",
                              fontSize: 12,
                            }}
                          >
                            Skipped
                          </span>
                        )}
                      </td>
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
                      <th key={c} style={{ whiteSpace: "nowrap" }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uploadResult.preview.map((row, i) => (
                    <tr key={i}>
                      {uploadResult.columns.map((c) => (
                        <td
                          key={c}
                          style={{
                            whiteSpace: "nowrap",
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {String(row[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div
            style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}
          >
            <button
              className="btn"
              onClick={() => {
                setStep(0);
                setUploadResult(null);
              }}
            >
              Back
            </button>
            <button
              className="btn primary"
              onClick={handleProcess}
              disabled={processing}
            >
              Process File
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Processing — animated truck scene */}
      {step === 2 && <ProcessingAnimation uploadPct={uploadPct} />}

      {/* Step 3: Done */}
      {step === 3 && (
        <div
          style={{
            maxWidth: 500,
            margin: "40px auto",
            textAlign: "center",
            padding: "0 24px",
          }}
        >
          <div className="panel">
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              {"\u2705"}
            </div>
            <h2>Analysis Complete</h2>
            <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
              Loading your results...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
