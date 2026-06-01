import { useState, useEffect } from "react";
import "./zepto.css";
import { Pulse } from "./pages/Pulse";
import { HotspotMap } from "./pages/HotspotMap";
import { Investigation } from "./pages/Investigation";
import { TheftZoneUpload } from "./pages/TheftZoneUpload";
import { Ask } from "./pages/Ask";
import { Actions } from "./pages/Actions";
import { SuspectedTripDetail } from "./pages/SuspectedTripDetail";
import type { Verdict } from "./types";

type Page = "pulse" | "investigate" | "ask" | "hotspots" | "actions" | "risk-zones" | "suspected-trip";

const NAV: { id: Page; label: string }[] = [
  { id: "pulse", label: "Review" },
  { id: "investigate", label: "Investigate" },
  { id: "ask", label: "Ask" },
  { id: "actions", label: "Act" },
  { id: "hotspots", label: "Visualise" },
];

/** Read URL hash into (page, tripId). Supports:
 *   #suspected/54404420   → suspected-trip detail page for trip 54404420
 *   #review               → Pulse / Review
 *   #investigate          → Investigate
 *   #investigate?driver=… → Investigate with preselect
 *   (empty)               → Pulse (default)
 */
function parseHash(hash: string): { page: Page; tripId?: string; preselect?: any } {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return { page: "pulse" };
  const [path, qs] = raw.split("?");
  const parts = path.split("/");
  const head = parts[0];
  const params = new URLSearchParams(qs || "");
  if (head === "suspected" && parts[1]) {
    return { page: "suspected-trip", tripId: parts[1] };
  }
  if (head === "review" || head === "pulse") return { page: "pulse" };
  if (head === "investigate") {
    const pre: any = {};
    for (const k of ["driver", "vehicle", "transporter", "route", "trip"]) {
      const v = params.get(k);
      if (v) pre[k] = v;
    }
    if (params.get("trip")) pre.openDetail = true;
    return { page: "investigate", preselect: Object.keys(pre).length ? pre : null };
  }
  if (head === "hotspots") return { page: "hotspots" };
  if (head === "ask") return { page: "ask" };
  if (head === "actions") return { page: "actions" };
  if (head === "risk-zones") return { page: "risk-zones" };
  return { page: "pulse" };
}

function pageToHash(page: Page, tripId?: string | null, preselect?: any): string {
  if (page === "suspected-trip" && tripId) return `#suspected/${tripId}`;
  if (page === "pulse") return "#review";
  if (page === "investigate") {
    const qs = new URLSearchParams();
    if (preselect?.driver) qs.set("driver", preselect.driver);
    else if (preselect?.vehicle) qs.set("vehicle", preselect.vehicle);
    else if (preselect?.transporter) qs.set("transporter", preselect.transporter);
    else if (preselect?.trip) qs.set("trip", preselect.trip);
    const s = qs.toString();
    return s ? `#investigate?${s}` : "#investigate";
  }
  return `#${page}`;
}

export function ZeptoApp() {
  const initial = typeof window !== "undefined" ? parseHash(window.location.hash) : { page: "pulse" as Page };
  const [page, setPage] = useState<Page>(initial.page);
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [investPreselect, setInvestPreselect] = useState<any>(initial.preselect ?? null);
  const [suspectedTripId, setSuspectedTripId] = useState<string | null>(initial.tripId ?? null);

  // Keep the URL hash in sync with the current view so links are shareable.
  useEffect(() => {
    const want = pageToHash(page, suspectedTripId, investPreselect);
    if (typeof window !== "undefined" && window.location.hash !== want) {
      window.history.replaceState(null, "", want);
    }
  }, [page, suspectedTripId, investPreselect]);

  // Respond to hash changes (back/forward, manually-pasted URL).
  useEffect(() => {
    const onHash = () => {
      const next = parseHash(window.location.hash);
      setPage(next.page);
      if (next.tripId !== undefined) setSuspectedTripId(next.tripId);
      if (next.preselect !== undefined) setInvestPreselect(next.preselect);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  function openSuspectedTrip(tripId: string) {
    setSuspectedTripId(tripId);
    setPage("suspected-trip");
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
            onSuspectedTripClick={openSuspectedTrip}
          />
        )}
        {page === "hotspots" && <HotspotMap focus={mapFocus} />}
        {page === "investigate" && <Investigation preselect={investPreselect} />}
        {page === "ask" && <Ask />}
        {page === "actions" && <Actions />}
        {page === "risk-zones" && <TheftZoneUpload />}
        {page === "suspected-trip" && suspectedTripId && (
          <SuspectedTripDetail
            tripId={suspectedTripId}
            onBack={() => setPage("pulse")}
            onOpenSuspectedTrip={openSuspectedTrip}
          />
        )}
      </main>
    </div>
  );
}
