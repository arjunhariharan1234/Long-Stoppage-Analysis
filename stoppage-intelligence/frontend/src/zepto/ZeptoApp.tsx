import { useState } from "react";
import { Badge } from "ft-design-system";
import "./zepto.css";
import { Pulse } from "./pages/Pulse";
import { HotspotMap } from "./pages/HotspotMap";
import { Investigation } from "./pages/Investigation";
import { TheftZoneUpload } from "./pages/TheftZoneUpload";
import { Queue } from "./pages/Queue";
import { Reports } from "./pages/Reports";
import type { Verdict } from "./types";

type Page = "pulse" | "hotspots" | "investigate" | "queue" | "reports" | "risk-zones";

const NAV: { id: Page; label: string }[] = [
  { id: "pulse", label: "Pulse" },
  { id: "hotspots", label: "Hotspots" },
  { id: "investigate", label: "Investigate" },
  { id: "queue", label: "Queue" },
  { id: "reports", label: "Reports" },
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
    <div className="zepto-app min-h-screen bg-[#f5f7fa] text-[#1a2330]" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Top navigation */}
      <header className="sticky top-0 z-50 bg-white border-b border-[#e4e7ec]">
        <div className="mx-auto max-w-[1240px] px-8 h-14 flex items-center gap-8">
          {/* Brand */}
          <button
            onClick={() => setPage("pulse")}
            className="flex items-center gap-2.5 group"
          >
            <div className="w-7 h-7 rounded-md bg-[#FFBE07] flex items-center justify-center font-extrabold text-[#1a2330] text-[13px] tracking-tight">
              FT
            </div>
            <div className="flex flex-col items-start leading-tight">
              <div className="text-[13px] font-semibold text-[#1a2330] tracking-tight group-hover:text-[#434f64]">
                Long Stoppage Intelligence
              </div>
              <div className="text-[10.5px] text-[#838c9d] -mt-0.5 tracking-wide">
                Zepto × FreightTiger
              </div>
            </div>
          </button>

          {/* Primary nav */}
          <nav className="flex items-center gap-1 ml-2">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => {
                  setPage(n.id);
                  if (n.id !== "investigate") setInvestPreselect(null);
                  if (n.id !== "hotspots") setMapFocus(null);
                }}
                className={
                  "h-9 px-3 text-[13px] font-medium rounded-md transition-colors " +
                  (page === n.id
                    ? "text-[#1a2330] bg-[#f0f1f7]"
                    : "text-[#5f697b] hover:text-[#1a2330] hover:bg-[#f8f8f9]")
                }
              >
                {n.label}
              </button>
            ))}
          </nav>

          {/* Spacer + secondary actions */}
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="warning">
              <span className="text-[11px] font-medium">Pilot · Phase 1</span>
            </Badge>
            <div className="text-[12px] text-[#838c9d] hidden md:block">
              ft.product@freighttiger.com
            </div>
          </div>
        </div>
      </header>

      {/* Page surface */}
      <main>
        {page === "pulse" && (
          <Pulse
            onInvestigate={investigate}
            onOpenInMap={openInMap}
            onSeeAll={() => setPage("queue")}
          />
        )}
        {page === "hotspots" && <HotspotMap focus={mapFocus} />}
        {page === "investigate" && <Investigation preselect={investPreselect} />}
        {page === "queue" && <Queue onInvestigate={investigate} onOpenInMap={openInMap} />}
        {page === "reports" && <Reports />}
        {page === "risk-zones" && <TheftZoneUpload />}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e4e7ec] bg-white mt-12">
        <div className="mx-auto max-w-[1240px] px-8 py-5 flex items-center justify-between text-[12px] text-[#838c9d]">
          <div>
            Built jointly by <span className="text-[#434f64] font-medium">FreightTiger Product</span>{" "}
            and <span className="text-[#434f64] font-medium">Zepto Data Engineering</span>.
            Models, taxonomies and SLAs reviewed together.
          </div>
          <div className="flex items-center gap-4">
            <button
              className="hover:text-[#434f64] transition-colors"
              onClick={() => setPage("risk-zones")}
            >
              Custom risk zones
            </button>
            <span className="text-[#ced1d7]">·</span>
            <span className="tabular-nums">v1.0 · pilot</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

