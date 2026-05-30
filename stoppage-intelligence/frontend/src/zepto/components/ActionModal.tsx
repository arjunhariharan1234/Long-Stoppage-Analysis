import { useEffect, useMemo, useState } from "react";
import { Badge } from "ft-design-system";
import type {
  DriverRollup, VehicleRollup, TransporterRollup,
} from "../types";
import {
  ActionKind, Severity, EvidenceRef, REASON_CODES,
  createAction, activeForTarget,
} from "../lib/actionsStore";

interface Props {
  kind: ActionKind;
  // Optional preselected target
  target?: {
    type: "driver" | "vehicle" | "transporter" | "zone";
    key: string;
    label: string;
    sub?: string;
    baselineHaltsPerWeek?: number;
    baselineExposurePerWeekInr?: number;
    seedEvidence?: EvidenceRef[];
  };
  // Search sources (when no preselected target)
  drivers?: DriverRollup[];
  vehicles?: VehicleRollup[];
  transporters?: TransporterRollup[];
  onClose: () => void;
  onCreated?: () => void;
}

const SEVERITY: { value: Severity; name: string; explain: string }[] = [
  { value: "advisory", name: "Advisory", explain: "Watch + flag, no operational block." },
  { value: "restricted", name: "Restricted", explain: "Auto-escalate any matching halt." },
  { value: "blocked", name: "Blocked", explain: "Block trip / route assignment." },
];

const KIND_TITLE: Record<ActionKind, string> = {
  blacklist_driver: "Blacklist driver",
  blacklist_transporter: "Blacklist transporter",
  blacklist_vehicle: "Blacklist vehicle",
  redzone: "Mark redzone",
};

const KIND_SUB: Record<ActionKind, string> = {
  blacklist_driver:
    "Flag this driver across the platform. Future halts trigger high-priority alerts. Reversible.",
  blacklist_transporter:
    "Flag this transporter across the platform. All their drivers + vehicles get scrutiny boost.",
  blacklist_vehicle:
    "Flag this vehicle. Any trip using it triggers high-priority alerts.",
  redzone:
    "Mark a geographic zone as restricted. Halts inside the zone get auto-escalated regardless of POI.",
};

export function ActionModal({
  kind, target, drivers = [], vehicles = [], transporters = [], onClose, onCreated,
}: Props) {
  const [selectedTarget, setSelectedTarget] = useState(target);
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [severity, setSeverity] = useState<Severity>(
    kind === "redzone" ? "restricted" : "restricted"
  );
  const [reasonCode, setReasonCode] = useState(REASON_CODES[kind][0].code);
  const [reasonNote, setReasonNote] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [zoneLat, setZoneLat] = useState("");
  const [zoneLng, setZoneLng] = useState("");
  const [zoneRadius, setZoneRadius] = useState("2000");

  useEffect(() => {
    // ESC to close
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Search results for target picker
  const results = useMemo(() => {
    if (kind === "redzone" || selectedTarget) return [];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    if (kind === "blacklist_driver") {
      return drivers
        .filter(d => d.driver_name.toLowerCase().includes(q) || d.driver_number.includes(q))
        .slice(0, 10)
        .map(d => ({
          type: "driver" as const,
          key: d.driver_number,
          label: d.driver_name,
          sub: `${d.driver_number} · ${d.halt_count} halts · risk ${d.risk_score}`,
          baselineHaltsPerWeek: Math.max(1, d.halt_count / 12),
          baselineExposurePerWeekInr: 0,
        }));
    }
    if (kind === "blacklist_vehicle") {
      return vehicles
        .filter(v => v.vehicle_number.toLowerCase().includes(q))
        .slice(0, 10)
        .map(v => ({
          type: "vehicle" as const,
          key: v.vehicle_number,
          label: v.vehicle_number,
          sub: `${v.vehicle_type} · ${v.halt_count} halts · risk ${v.risk_score}`,
          baselineHaltsPerWeek: Math.max(1, v.halt_count / 12),
          baselineExposurePerWeekInr: 0,
        }));
    }
    return transporters
      .filter(t => t.transporter_branch.toLowerCase().includes(q))
      .slice(0, 10)
      .map(t => ({
        type: "transporter" as const,
        key: t.transporter_branch,
        label: t.transporter_branch,
        sub: `${t.halt_count.toLocaleString("en-IN")} halts · ${t.unique_drivers} drivers · risk ${t.risk_score}`,
        baselineHaltsPerWeek: Math.max(1, t.halt_count / 12),
        baselineExposurePerWeekInr: 0,
      }));
  }, [kind, search, drivers, vehicles, transporters, selectedTarget]);

  const existing = selectedTarget ? activeForTarget(selectedTarget.type, selectedTarget.key) : undefined;

  const canSubmit =
    kind === "redzone"
      ? !!zoneName && !!zoneLat && !!zoneLng && !!zoneRadius && !isNaN(parseFloat(zoneLat)) && !isNaN(parseFloat(zoneLng))
      : !!selectedTarget && !existing;

  function submit() {
    if (!canSubmit) return;

    if (kind === "redzone") {
      const lat = parseFloat(zoneLat);
      const lng = parseFloat(zoneLng);
      const radius = parseInt(zoneRadius, 10) || 2000;
      const evidence: EvidenceRef[] =
        reasonNote ? [{ kind: "note", ref: "", label: reasonNote }] : [];
      createAction({
        kind: "redzone",
        target: { type: "zone", key: `${lat.toFixed(4)},${lng.toFixed(4)},${radius}`, label: zoneName, sub: `${lat.toFixed(4)}, ${lng.toFixed(4)} · ${radius}m radius` },
        severity,
        reason_code: reasonCode,
        reason_note: reasonNote || undefined,
        evidence,
        effective_from: new Date().toISOString(),
        effective_until: validUntil || undefined,
        zone: { lat, lng, radius_m: radius, name: zoneName },
        baseline_halts_per_week: 6,
        baseline_exposure_per_week_inr: 50000,
      });
    } else {
      if (!selectedTarget) return;
      const evidence: EvidenceRef[] = [
        ...(selectedTarget.seedEvidence || []),
        ...(reasonNote ? [{ kind: "note" as const, ref: "", label: reasonNote }] : []),
      ];
      createAction({
        kind,
        target: { type: selectedTarget.type, key: selectedTarget.key, label: selectedTarget.label, sub: selectedTarget.sub },
        severity,
        reason_code: reasonCode,
        reason_note: reasonNote || undefined,
        evidence,
        effective_from: new Date().toISOString(),
        effective_until: validUntil || undefined,
        baseline_halts_per_week: selectedTarget.baselineHaltsPerWeek ?? 4,
        baseline_exposure_per_week_inr: selectedTarget.baselineExposurePerWeekInr ?? 30000,
      });
    }
    onCreated?.();
    onClose();
  }

  return (
    <div className="z-modal-backdrop" onClick={onClose}>
      <div className="z-modal" onClick={e => e.stopPropagation()}>
        <div className="z-modal-head">
          <div className="z-modal-eyebrow">Action · {kind.replace(/_/g, " ")}</div>
          <h2 className="z-modal-title">{KIND_TITLE[kind]}</h2>
          <div className="z-modal-sub">{KIND_SUB[kind]}</div>
        </div>

        <div className="z-modal-body">
          {/* Target picker / preselected target */}
          {kind !== "redzone" && (
            <div className="z-form-row">
              <label className="z-form-label">Target</label>
              {selectedTarget ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafbfc", border: "1px solid #e4e7ec", borderRadius: 6, padding: "10px 12px" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#1a2330" }}>{selectedTarget.label}</div>
                    {selectedTarget.sub && <div style={{ fontSize: 12, color: "#838c9d", marginTop: 2 }}>{selectedTarget.sub}</div>}
                  </div>
                  {!target && (
                    <button className="z-btn-secondary" onClick={() => { setSelectedTarget(undefined); setSearch(""); }}>Change</button>
                  )}
                </div>
              ) : (
                <div className="z-target-search">
                  <input
                    className="z-form-input"
                    placeholder={kind === "blacklist_driver" ? "Search driver name or number…" : kind === "blacklist_vehicle" ? "Search vehicle number…" : "Search transporter…"}
                    value={search}
                    onChange={e => { setSearch(e.target.value); setShowResults(true); }}
                    onFocus={() => setShowResults(true)}
                    autoFocus
                  />
                  {showResults && results.length > 0 && (
                    <div className="z-target-results">
                      {results.map((r) => (
                        <button
                          key={r.key}
                          className="z-target-result"
                          onClick={() => { setSelectedTarget(r); setShowResults(false); setSearch(""); }}
                        >
                          <span>{r.label}</span>
                          <span className="z-target-result-sub">{r.sub}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {existing && (
                <div style={{ fontSize: 12, color: "#d92d20", marginTop: 2 }}>
                  Already has an active action ({existing.severity} · {new Date(existing.taken_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}). Lift it first to re-issue.
                </div>
              )}
            </div>
          )}

          {/* Redzone fields */}
          {kind === "redzone" && (
            <>
              <div className="z-form-row">
                <label className="z-form-label">Zone name</label>
                <input className="z-form-input" value={zoneName} onChange={e => setZoneName(e.target.value)} placeholder="e.g. Hazira corridor — KM 4 to KM 12" autoFocus />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div className="z-form-row">
                  <label className="z-form-label">Latitude</label>
                  <input className="z-form-input" value={zoneLat} onChange={e => setZoneLat(e.target.value)} placeholder="22.5468" />
                </div>
                <div className="z-form-row">
                  <label className="z-form-label">Longitude</label>
                  <input className="z-form-input" value={zoneLng} onChange={e => setZoneLng(e.target.value)} placeholder="77.4357" />
                </div>
                <div className="z-form-row">
                  <label className="z-form-label">Radius (m)</label>
                  <input className="z-form-input" value={zoneRadius} onChange={e => setZoneRadius(e.target.value)} placeholder="2000" />
                </div>
              </div>
              <div className="z-form-helper">Tip — copy lat/lng from any cluster tooltip on Visualise.</div>
            </>
          )}

          {/* Reason */}
          <div className="z-form-row">
            <label className="z-form-label">Reason</label>
            <select className="z-form-select" value={reasonCode} onChange={e => setReasonCode(e.target.value)}>
              {REASON_CODES[kind].map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </div>

          {/* Severity */}
          <div className="z-form-row">
            <label className="z-form-label">Severity</label>
            <div className="z-severity-row">
              {SEVERITY.map(s => (
                <button
                  key={s.value}
                  className={"z-severity-card" + (severity === s.value ? " is-active" : "")}
                  onClick={() => setSeverity(s.value)}
                >
                  <div className="z-severity-name">{s.name}</div>
                  <div className="z-severity-explain">{s.explain}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="z-form-row">
            <label className="z-form-label">Notes (optional)</label>
            <textarea className="z-form-textarea" value={reasonNote} onChange={e => setReasonNote(e.target.value)} placeholder="Context that future reviewers will need — incident reference, transporter conversation, evidence link…" />
          </div>

          {/* Valid-until (optional) */}
          <div className="z-form-row">
            <label className="z-form-label">Valid until (optional)</label>
            <input type="date" className="z-form-input" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
            <div className="z-form-helper">Leave blank for indefinite. Most blacklists run 30–90 days then get reviewed.</div>
          </div>

          {/* Evidence auto-attached */}
          {selectedTarget?.seedEvidence && selectedTarget.seedEvidence.length > 0 && (
            <div className="z-form-row">
              <label className="z-form-label">Evidence auto-attached</label>
              <ul className="z-action-evidence-list">
                {selectedTarget.seedEvidence.map((e, i) => (
                  <li key={i}>
                    <span className="z-action-evidence-kind">{e.kind}</span>
                    <span>{e.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="z-modal-foot">
          <button className="z-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className={"z-btn-primary " + (severity === "blocked" ? "is-destructive" : "")}
            onClick={submit}
            disabled={!canSubmit}
          >
            {kind === "redzone" ? "Mark zone" : KIND_TITLE[kind]}
          </button>
        </div>
      </div>
    </div>
  );
}
