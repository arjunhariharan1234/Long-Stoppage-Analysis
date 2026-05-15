import type {
  Summary, Verdict, HotspotFC, DriverRollup, VehicleRollup,
  TransporterRollup, RouteRollup, EventRow, TheftZoneResult,
} from "./types";

const BASE = `${import.meta.env.BASE_URL}zepto`;

async function load<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${BASE}/${path}: ${res.status}`);
  return res.json();
}

export const api = {
  summary: () => load<Summary>("summary.json"),
  verdicts: () => load<{ verdicts: Verdict[] }>("verdicts.json").then(r => r.verdicts),
  hotspots: () => load<HotspotFC>("hotspots.geojson"),
  drivers: () => load<{ drivers: DriverRollup[] }>("entities/drivers.json").then(r => r.drivers),
  vehicles: () => load<{ vehicles: VehicleRollup[] }>("entities/vehicles.json").then(r => r.vehicles),
  transporters: () => load<{ transporters: TransporterRollup[] }>("entities/transporters.json").then(r => r.transporters),
  routes: () => load<{ routes: RouteRollup[] }>("entities/routes.json").then(r => r.routes),
  events: () => load<{ events: EventRow[] }>("events-in-transit.json").then(r => r.events),
  theftZoneResult: () => load<TheftZoneResult>("theft_zone_demo_result.json"),
};
