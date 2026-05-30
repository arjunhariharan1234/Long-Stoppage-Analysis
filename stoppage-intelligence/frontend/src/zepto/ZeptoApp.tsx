import { useState } from "react";
import "./zepto.css";
import { Pulse } from "./pages/Pulse";
import { HotspotMap } from "./pages/HotspotMap";
import { Investigation } from "./pages/Investigation";
import { TheftZoneUpload } from "./pages/TheftZoneUpload";
import { Ask } from "./pages/Ask";
import { Actions } from "./pages/Actions";
import type { Verdict } from "./types";

type Page = "pulse" | "investigate" | "ask" | "hotspots" | "actions" | "risk-zones";

const NAV: { id: Page; label: string }[] = [
  { id: "pulse", label: "Review" },
  { id: "investigate", label: "Investigate" },
  { id: "ask", label: "Ask" },
  { id: "actions", label: "Act" },
  { id: "hotspots", label: "Visualise" },
];

export function ZeptoApp() {
  const [page, setPage] = useState<Page>("pulse");
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [investPreselect, setInvestPreselect] = useState<any>(null);

  function openInMap(v: Verdict) {
    setMapFocus({ lat: v.location.lat, lng: v.location.lng, zoom: 11 });
    setPage("hotspots");
  }

  function investigate(v: Verdict) {
    const pre: any = {};
    if (v.entities.driver_number) pre.driver = v.entities.driver_number;
    else if (v.entities.vehicle_number) pre.vehicle = v.entities.vehicle_number;
    else if (v.entities.transporter_branch) pre.transporter = v.entities.transporter_branch;
    setInvestPreselect(pre);
    setPage("investigate");
  }

  return (
    <div className="zepto-app" style={{ minHeight: "100vh", background: "#f5f7fa" }}>
      {/* Top navigation */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: "#fff", borderBottom: "1px solid #e4e7ec" }}>
        <div className="z-container z-nav-bar">
          {/* Brand */}
          <button onClick={() => setPage("pulse")} className="z-nav-brand">
            <div className="z-nav-brand-mark">FT</div>
            <div className="z-nav-brand-text">
              <div className="z-nav-brand-title">Theft Intelligence</div>
            </div>
          </button>

          {/* Primary nav */}
          <nav className="z-nav-tabs">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => {
                  setPage(n.id);
                  if (n.id !== "investigate") setInvestPreselect(null);
                  if (n.id !== "hotspots") setMapFocus(null);
                }}
                className={"z-nav-tab" + (page === n.id ? " is-active" : "")}
              >
                {n.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Page surface */}
      <main>
        {page === "pulse" && (
          <Pulse
            onInvestigate={investigate}
            onOpenInMap={openInMap}
            onSeeAll={() => setPage("investigate")}
            onJumpToHotspots={() => setPage("hotspots")}
          />
        )}
        {page === "hotspots" && <HotspotMap focus={mapFocus} />}
        {page === "investigate" && <Investigation preselect={investPreselect} />}
        {page === "ask" && <Ask />}
        {page === "actions" && <Actions />}
        {page === "risk-zones" && <TheftZoneUpload />}
      </main>
    </div>
  );
}
