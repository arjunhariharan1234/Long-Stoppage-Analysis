import { useEffect, useRef, useState } from "react";

const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || "";

interface Props {
  lat: number;
  lng: number;
  zoom?: number;
  height?: number;
  markerColor?: string;
  extraPoints?: { lat: number; lng: number; size?: number }[];
}

/* Lazy-load the Google Maps JS API once. Resolves to window.google when ready. */
let mapsLoader: Promise<any> | null = null;
function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if ((window as any).google?.maps) return Promise.resolve((window as any).google);
  if (mapsLoader) return mapsLoader;
  if (!GOOGLE_KEY) return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY not set"));
  mapsLoader = new Promise((resolve, reject) => {
    const cbName = "__zeptoGmapsReady";
    (window as any)[cbName] = () => resolve((window as any).google);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&callback=${cbName}&libraries=marker&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return mapsLoader;
}

/* Minimal, low-saturation map style — quiet enough for a dashboard. */
const QUIET_STYLE: any[] = [
  { elementType: "geometry", stylers: [{ color: "#f5f7fa" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5f697b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#ced1d7" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e4e7ec" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#dfe3e9" }] },
];

export function MiniMap({ lat, lng, zoom = 13, height = 240, markerColor = "#1e64e6", extraPoints = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "no-key" | "error">("loading");

  // JS API path
  useEffect(() => {
    if (!GOOGLE_KEY) { setStatus("no-key"); return; }
    let cancelled = false;
    loadGoogleMaps()
      .then(google => {
        if (cancelled || !containerRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(containerRef.current, {
            center: { lat, lng },
            zoom,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "cooperative",
            styles: QUIET_STYLE,
            backgroundColor: "#f5f7fa",
          });
        } else {
          mapRef.current.setCenter({ lat, lng });
          mapRef.current.setZoom(zoom);
        }
        // Clear old markers
        markersRef.current.forEach(m => m.setMap(null));
        markersRef.current = [];

        // Evidence dots
        extraPoints.forEach(p => {
          const m = new google.maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map: mapRef.current,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: Math.max(4, Math.min(10, (p.size ?? 6) * 0.8)),
              fillColor: "#FFBE07",
              fillOpacity: 0.9,
              strokeColor: "#1a2330",
              strokeWeight: 1,
            },
          });
          markersRef.current.push(m);
        });

        // Primary marker (pulse)
        const primary = new google.maps.Marker({
          position: { lat, lng },
          map: mapRef.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: markerColor,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
          zIndex: 999,
        });
        markersRef.current.push(primary);

        setStatus("ready");
      })
      .catch(() => setStatus("error"));
    return () => { cancelled = true; };
  }, [lat, lng, zoom, markerColor, JSON.stringify(extraPoints)]);

  // Fallback: Google Maps embed iframe (no key required, no custom markers)
  if (status === "no-key" || status === "error") {
    const z = Math.max(2, Math.min(20, Math.round(zoom)));
    const src = `https://maps.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}&z=${z}&output=embed`;
    return (
      <iframe
        src={src}
        width="100%"
        height={height}
        style={{ border: "1px solid #e4e7ec", borderRadius: 8, display: "block" }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Google Maps"
      />
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #e4e7ec",
        background: "#f5f7fa",
      }}
    />
  );
}
