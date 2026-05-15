import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { api } from "../api";
import type { TheftZoneResult } from "../types";

const LIGHT_BASEMAP: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
      tileSize: 256, attribution: "© CARTO © OpenStreetMap",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

type Phase = "idle" | "processing" | "result";
const STAGES = [
  "Parsing zone definitions…",
  "Cross-referencing 421,282 in-transit halts…",
  "Computing per-zone driver, vehicle and transporter rollups…",
  "Surfacing zone-level findings…",
];

export function TheftZoneUpload() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState<TheftZoneResult | null>(null);
  const [uploadedName, setUploadedName] = useState<string>("");
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setUploadedName(f.name);
    setPhase("processing");
    setStageIdx(0);
    // staged loader (visual only)
    const stages = STAGES.length;
    let i = 0;
    const tick = setInterval(() => {
      i += 1;
      setStageIdx(i);
      if (i >= stages) {
        clearInterval(tick);
        // Fetch the pre-computed result
        api.theftZoneResult().then(r => {
          setResult(r);
          setPhase("result");
        });
      }
    }, 900);
  }

  function downloadSample(e: React.MouseEvent) {
    e.stopPropagation();
    window.open(`${import.meta.env.BASE_URL}zepto/red_zones_sample.csv`, "_blank");
  }

  useEffect(() => {
    if (phase !== "result" || !mapContainerRef.current || mapRef.current || !result) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: LIGHT_BASEMAP,
      center: [78.5, 22.5],
      zoom: 4.2,
      attributionControl: false,
    });
    map.on("load", () => {
      result.zones.forEach((z, i) => {
        const circleData = {
          type: "FeatureCollection" as const,
          features: [{
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [z.longitude, z.latitude] },
            properties: {},
          }],
        };
        map.addSource(`z-${i}`, { type: "geojson", data: circleData });
        const radiusPx = z.radius_m / 60;
        const color = z.severity === "high" ? "#d92d20" : z.severity === "medium" ? "#ef6820" : "#1e64e6";
        map.addLayer({
          id: `z-${i}-c`,
          source: `z-${i}`,
          type: "circle",
          paint: {
            "circle-radius": Math.max(18, Math.min(48, Math.sqrt(z.halt_count) * 4 + radiusPx / 50)),
            "circle-color": color,
            "circle-opacity": 0.22,
            "circle-stroke-color": color,
            "circle-stroke-width": 2,
          },
        });
        new maplibregl.Popup({ closeButton: false, offset: 12, className: "zepto-zone-popup" })
          .setLngLat([z.longitude, z.latitude])
          .setHTML(`<div style="font-family:Inter,sans-serif;font-size:12px;color:#1a2330;"><strong style="font-weight:600">${z.name}</strong><br/>${z.halt_count} in-transit halts</div>`)
          .addTo(map);
      });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [phase, result]);

  return (
    <div className="zepto-page">
      <div className="zepto-eyebrow">Customer risk zones</div>
      <h1 className="zepto-headline">Upload your <em>risk zones</em> — we intersect them with the halt dataset</h1>
      <p className="zepto-sub">
        Drop a CSV or XLSX of the zones your security team already tracks. We intersect them with the in-transit halt dataset and return per-zone breakdowns:
        top transporters, top drivers, top vehicles, halt density, night-share and the pattern-level findings inside each zone.
      </p>

      {phase === "idle" && (
        <div
          className="zepto-dropzone"
          style={{ marginTop: 28 }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        >
          <div className="icon">⊕</div>
          <h3>Drop your zone definitions here</h3>
          <p>CSV or XLSX with columns: <code style={{ background: "var(--bg-subtle)", padding: "1px 6px", borderRadius: 4, color: "var(--text-secondary)" }}>name, latitude, longitude, radius_m, severity</code></p>
          <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 10 }}>
            <button className="zepto-btn" onClick={downloadSample}>Download sample file</button>
            <button className="zepto-btn primary">Choose file</button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      )}

      {phase === "processing" && (
        <div style={{ marginTop: 40, textAlign: "center" }}>
          <div className="zepto-loading-spinner" style={{ margin: "0 auto" }} />
          <div style={{ marginTop: 18, fontSize: 14, fontWeight: 600 }}>Processing <code style={{ color: "var(--zepto-accent)" }}>{uploadedName}</code></div>
          <div style={{ marginTop: 22 }}>
            {STAGES.map((s, i) => (
              <div key={s} style={{ padding: "6px 0", fontSize: 13, color: i < stageIdx ? "var(--zepto-good)" : i === stageIdx ? "var(--zepto-text)" : "var(--zepto-text-muted)" }}>
                {i < stageIdx ? "✓ " : i === stageIdx ? "… " : "  "}{s}
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === "result" && result && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 20 }}>
            <div ref={mapContainerRef} style={{ height: 460, borderRadius: 12, overflow: "hidden", border: "1px solid var(--zepto-border)" }} />
            <div>
              <div className="zepto-kpi" style={{ marginBottom: 10 }}>
                <div className="label">Total halts inside your zones</div>
                <div className="value accent">{result.total_zone_halts.toLocaleString()}</div>
              </div>
              {result.zones.map(z => (
                <div key={z.name} className={`zepto-zone-card ${z.severity}`}>
                  <div className="zone-name">{z.name}</div>
                  <div className="zone-stats">
                    <span><strong style={{ color: "var(--zepto-accent)" }}>{z.halt_count}</strong> halts</span>
                    <span>{z.unique_drivers} drivers · {z.unique_vehicles} vehicles</span>
                    <span>{z.median_duration_hrs.toFixed(1)} hr median</span>
                    <span>{Math.round(z.night_share * 100)}% night</span>
                  </div>
                  {z.halt_count > 0 && (
                    <div className="zone-tops">
                      <div className="row"><span className="label">Top transporters:</span>
                        {z.top_transporters.map(t => t.name).join(" · ")}
                      </div>
                      <div className="row"><span className="label">Top drivers:</span>
                        {z.top_drivers.map(d => d.name).join(" · ")}
                      </div>
                      <div className="row"><span className="label">Top vehicles:</span>
                        {z.top_vehicles.map(v => v.name).join(" · ")}
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 8, fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${z.latitude.toFixed(6)},${z.longitude.toFixed(6)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--zepto-accent)", textDecoration: "none", fontWeight: 600 }}
                    >
                      View on Google Maps ↗
                    </a>
                    <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {z.latitude.toFixed(4)}, {z.longitude.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <button className="zepto-btn" onClick={() => { setPhase("idle"); setResult(null); }}>Upload another file</button>
          </div>
        </div>
      )}
    </div>
  );
}
