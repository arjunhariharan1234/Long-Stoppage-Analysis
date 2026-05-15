import { useState } from "react";
import "./zepto.css";
import { ZeptoLanding } from "./pages/ZeptoLanding";
import { HotspotMap } from "./pages/HotspotMap";
import { Investigation } from "./pages/Investigation";
import { TheftZoneUpload } from "./pages/TheftZoneUpload";
import type { Verdict } from "./types";

type Page = "landing" | "map" | "investigation" | "theft-zones";

export function ZeptoApp() {
  const [page, setPage] = useState<Page>("landing");
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [investPreselect, setInvestPreselect] = useState<any>(null);

  function openInMap(v: Verdict) {
    setMapFocus({ lat: v.location.lat, lng: v.location.lng, zoom: 11 });
    setPage("map");
  }

  function investigate(v: Verdict) {
    const pre: any = {};
    if (v.entities.driver_number) pre.driver = v.entities.driver_number;
    else if (v.entities.vehicle_number) pre.vehicle = v.entities.vehicle_number;
    else if (v.entities.transporter_branch) pre.transporter = v.entities.transporter_branch;
    setInvestPreselect(pre);
    setPage("investigation");
  }

  return (
    <div className="zepto-app">
      <nav className="zepto-nav">
        <div className="zepto-brand" onClick={() => setPage("landing")} style={{ cursor: "pointer" }}>
          <div className="zepto-brand-logo">Z</div>
          <div className="zepto-brand-text">
            <div className="top">Long Stoppage Intelligence</div>
            <div className="sub">Zepto · Stoppage risk &amp; assurance</div>
          </div>
        </div>
        <div className="zepto-nav-tabs">
          <button className={`zepto-nav-tab ${page === "landing" ? "active" : ""}`} onClick={() => setPage("landing")}>Findings</button>
          <button className={`zepto-nav-tab ${page === "map" ? "active" : ""}`} onClick={() => { setMapFocus(null); setPage("map"); }}>Hotspot map</button>
          <button className={`zepto-nav-tab ${page === "investigation" ? "active" : ""}`} onClick={() => { setInvestPreselect(null); setPage("investigation"); }}>Investigate</button>
          <button className={`zepto-nav-tab ${page === "theft-zones" ? "active" : ""}`} onClick={() => setPage("theft-zones")}>Risk zones</button>
        </div>
        <div className="zepto-nav-right">
          <div className="zepto-pulse-dot" />
          <span>Computed on Zepto fleet data</span>
        </div>
      </nav>

      {page === "landing" && <ZeptoLanding onInvestigate={investigate} onOpenInMap={openInMap} />}
      {page === "map" && <HotspotMap focus={mapFocus} />}
      {page === "investigation" && <Investigation preselect={investPreselect} />}
      {page === "theft-zones" && <TheftZoneUpload />}
    </div>
  );
}
