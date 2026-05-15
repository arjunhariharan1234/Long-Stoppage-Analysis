// Types for the Zepto Long Stoppage Intelligence data files.

export interface VerdictScoreBreakdown {
  frequency: number;
  poi_absence: number;
  duration: number;
  night_share: number;
  reefer: number;
  cargo_value: number;
  transparency: number;
  escalation: number;
}

export interface VerdictLocation {
  cluster_id: string;
  lat: number;
  lng: number;
  nearest_poi_name: string;
  nearest_poi_type: string;
  nearest_poi_category: string;
  distance_to_poi_km: number;
  label: string;
}

export interface VerdictStats {
  count: number;
  median_duration_hrs: number;
  night_share: number;
  reefer_share: number;
  unique_drivers?: number;
  unique_vehicles?: number;
  unique_transporters?: number;
}

export interface VerdictEntities {
  driver_name?: string;
  driver_number?: string;
  vehicle_number?: string;
  vehicle_type?: string;
  transporter_branch?: string;
  unique_drivers?: number;
  unique_vehicles?: number;
  unique_transporters?: number;
}

export interface VerdictEvidence {
  trip_id: string;
  ts: string;
  duration_hrs: number;
  lat: number;
  lng: number;
  net_weight: number | null;
  escalation: number;
  distance_to_poi_km: number | null;
  nearest_poi_name: string;
}

export type VerdictType =
  | "driver_vehicle_location"
  | "vehicle_location"
  | "transporter_location"
  | "shadow_hotspot";

export interface Verdict {
  verdict_id: string;
  type: VerdictType;
  type_label: string;
  risk_score: number;
  score_breakdown: VerdictScoreBreakdown;
  headline: string;
  entities: VerdictEntities;
  location: VerdictLocation;
  stats: VerdictStats;
  evidence: VerdictEvidence[];
  narrative: string;
  estimated_exposure_inr: number;
  recommended_action: string;
}

export interface Summary {
  total_raw: number;
  in_transit_events: number;
  dropped_near_origin: number;
  dropped_near_destination: number;
  dropped_under_30min: number;
  unique_trips: number;
  unique_drivers: number;
  unique_vehicles: number;
  unique_transporters: number;
  unique_clusters: number;
  priority_finding_count: number;
  reefer_event_share: number;
  night_event_share: number;
  themes: string[];
  generated_at: string;
  data_window: { from: string; to: string };
}

export interface HotspotFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    cluster_id: string;
    halt_count: number;
    unique_drivers: number;
    unique_vehicles: number;
    unique_transporters: number;
    median_duration_hrs: number;
    night_share: number;
    reefer_share: number;
    median_poi_distance_km: number;
    nearest_poi_name: string;
    nearest_poi_type: string;
    poi_explained: boolean;
    location_label: string;
    top_driver: string;
    top_vehicle: string;
    top_transporter: string;
    risk_tier: "critical" | "high" | "medium" | "low";
  };
}

export interface HotspotFC {
  type: "FeatureCollection";
  features: HotspotFeature[];
}

export interface DriverRollup {
  driver_number: string;
  driver_name: string;
  halt_count: number;
  unique_vehicles: number;
  unique_transporters: number;
  unique_clusters: number;
  night_share: number;
  reefer_share: number;
  median_duration_hrs: number;
  top_transporter: string;
  risk_score: number;
}

export interface VehicleRollup {
  vehicle_number: string;
  vehicle_type: string;
  halt_count: number;
  unique_drivers: number;
  unique_transporters: number;
  unique_clusters: number;
  night_share: number;
  reefer_share: number;
  median_duration_hrs: number;
  is_reefer: boolean;
  dedicated: string;
  top_transporter: string;
  risk_score: number;
}

export interface TransporterRollup {
  transporter_branch: string;
  halt_count: number;
  unique_drivers: number;
  unique_vehicles: number;
  unique_clusters: number;
  night_share: number;
  reefer_share: number;
  median_duration_hrs: number;
  risk_score: number;
}

export interface RouteRollup {
  route_key: string;
  halt_count: number;
  unique_drivers: number;
  unique_vehicles: number;
  unique_clusters: number;
  night_share: number;
  reefer_share: number;
  median_duration_hrs: number;
  risk_score: number;
}

export interface EventRow {
  trip_id: string;
  alert_id: string;
  alert_created_at: string;
  alert_lat: number;
  alert_lng: number;
  long_stoppage_duration_hrs: number;
  driver_name: string;
  driver_number: string;
  vehicle_number: string;
  vehicle_type: string;
  transporter_branch: string;
  cluster_id: string;
  nearest_poi_name: string;
  nearest_poi_type: string;
  distance_to_poi_km: number | string;
  escalation_level: number | string;
  net_weight: number | string;
  dedicated_vehicle_tag: string;
  gps_integration_flag: string;
  is_night: number;
  is_reefer: number;
  route_key: string;
  zone: string;
  origin: string;
  destination: string;
}

export interface TheftZoneResult {
  zones: {
    name: string;
    latitude: number;
    longitude: number;
    radius_m: number;
    severity: string;
    halt_count: number;
    unique_drivers: number;
    unique_vehicles: number;
    unique_transporters?: number;
    top_transporters: { name: string; count: number }[];
    top_drivers: { name: string; count: number }[];
    top_vehicles: { name: string; count: number }[];
    median_duration_hrs: number;
    night_share: number;
    reefer_share?: number;
  }[];
  total_zone_halts: number;
}
