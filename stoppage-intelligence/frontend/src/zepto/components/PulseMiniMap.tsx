import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { HotspotFeature } from "../types";

const DARK_BASEMAP: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
      tileSize: 256,
      attribution: "© CARTO © OpenStreetMap",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

const TIER_COLOR: Record<string, [number, number, number, number]> = {
  critical: [255, 80, 70, 240],
  high:     [255, 190, 7, 230],
  medium:   [30, 100, 230, 220],
  low:      [120, 130, 150, 130],
};

interface Props { features: HotspotFeature[] }

export function PulseMiniMap({ features }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_BASEMAP,
      center: [80, 21.5],
      zoom: 3.8,
      attributionControl: false,
      interactive: false,
    });
    map.on("load", () => {
      const overlay = new MapboxOverlay({ layers: [] });
      map.addControl(overlay as any);
      overlayRef.current = overlay;
      setReady(true);
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    if (!ready || !overlayRef.current) return;
    overlayRef.current.setProps({
      layers: [
        new ScatterplotLayer({
          id: "pulse-points",
          data: features,
          getPosition: (f: HotspotFeature) => f.geometry.coordinates,
          getRadius: (f: HotspotFeature) => Math.max(800, Math.sqrt(f.properties.halt_count) * 600),
          getFillColor: (f: HotspotFeature) => TIER_COLOR[f.properties.risk_tier] || TIER_COLOR.low,
          getLineColor: [255, 255, 255, 180],
          stroked: true,
          lineWidthMinPixels: 1,
          radiusMinPixels: 4,
          radiusMaxPixels: 24,
        }),
      ],
    });
  }, [features, ready]);

  return <div ref={containerRef} className="z-mini-hotspot-canvas" />;
}
