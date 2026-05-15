import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

const LIGHT_BASEMAP: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
      tileSize: 256,
      attribution: "© CARTO © OpenStreetMap",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

interface Props {
  lat: number;
  lng: number;
  zoom?: number;
  height?: number;
  markerColor?: string;
  extraPoints?: { lat: number; lng: number; size?: number }[];
}

export function MiniMap({ lat, lng, zoom = 13, height = 160, markerColor = "#1e64e6", extraPoints = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: LIGHT_BASEMAP,
      center: [lng, lat],
      zoom,
      attributionControl: false,
      interactive: false,
    });
    mapRef.current = map;

    map.on("load", () => {
      // primary marker
      const el = document.createElement("div");
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.borderRadius = "50%";
      el.style.background = markerColor;
      el.style.boxShadow = `0 0 0 4px ${markerColor}44, 0 0 14px ${markerColor}`;
      el.style.animation = "zepto-pulse 1.8s ease-in-out infinite";
      new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);

      // evidence dots
      extraPoints.forEach(p => {
        const d = document.createElement("div");
        const sz = p.size ?? 6;
        d.style.width = `${sz}px`;
        d.style.height = `${sz}px`;
        d.style.borderRadius = "50%";
        d.style.background = "rgba(255, 190, 7, 0.85)";
        d.style.border = "1px solid #1a2330";
        new maplibregl.Marker({ element: d }).setLngLat([p.lng, p.lat]).addTo(map);
      });
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [lat, lng, zoom, markerColor, JSON.stringify(extraPoints)]);

  return <div ref={containerRef} style={{ width: "100%", height, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }} />;
}
