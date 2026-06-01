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
  dropped_under_15min: number;
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

export interface TripRow {
  trip_id: string;
  master_trip_id: string;
  origin: string;
  destination: string;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  vehicle_number: string;
  vehicle_type: string;
  transporter_branch: string;
  driver_name: string;
  driver_number: string;
  zone: string;
  inbound_or_outbound: string;
  trip_status: string;
  halt_count: number;
  max_stoppage_hrs: number;
  total_stoppage_hrs: number;
  max_escalation: number;
  first_alert_at: string;
  latest_alert_at: string;
  total_planned_distance: number | null;
  total_transit_distance: number | null;
  is_reefer: boolean;
  night_share: number;
  top_poi_name: string;
  top_poi_type: string;
  top_poi_category: string;
  top_poi_distance_km: number | null;
  unmapped_halts: number;
  halts?: TripHalt[];
}

export interface TripHalt {
  ts: string;
  lat: number | null;
  lng: number | null;
  duration_hrs: number;
  escalation: number;
  poi_name: string;
  poi_type: string;
  poi_category: string;
  distance_to_poi_km: number | null;
  cluster_id: string;
  cluster_halt_count: number;
  is_night: boolean;
  address: string;
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

// --- Brain (theft codex + classifier) ---------------------------------------

export interface BrainSignal {
  id: string;
  name: string;
  category: string;
  weight: number;
  evidence: Record<string, unknown>;
  /** Plain-English explanation for the operator. */
  human_text?: string;
  /** Why this signal exists in the codex (analyst rationale). */
  rationale?: string;
}

export interface BrainSimilarCase {
  case_id: string;
  /** Plain-English label, e.g. "Past theft in Delhi handled by Maa Durga Transport — ₹50,000 loss". */
  headline?: string;
  similarity: number;
  city?: string;
  transporter?: string;
  rca_summary?: string;
}

export interface BrainScore {
  // identity
  trip_id: string;
  vehicle: string;
  driver_number: string;
  driver_name?: string;
  transporter: string;
  origin?: string;
  destination?: string;
  // scoring
  brain_score: number;
  tier: "low" | "medium" | "high";
  matched_signals: BrainSignal[];
  similar_cases: BrainSimilarCase[];
  recommended_action?: string;
  // timeline (ISO strings)
  gate_out?: string | null;
  first_ping_outside_origin?: string | null;
  destination_entry?: string | null;
  trip_closure_time?: string | null;
  google_eta?: string | null;
  // operational stats
  transit_distance_km?: number;
  google_distance_km?: number;
  transit_time_hrs?: number;
  stoppage_hrs?: number;
  loading_time_hrs?: number;
  unloading_time_hrs?: number;
  eta_breach_hrs?: number;
  total_pings?: number;
  alerts_text?: string;
  tracking_health?: number;
  closure_mode?: string;
}

export interface BrainScoresFile {
  version: string;
  generated_at: string;
  scores: BrainScore[];
}

export interface BrainCodexSignalDef {
  id: string;
  name: string;
  category: string;
  rationale: string;
  source_cases: string[];
  weight: number;
  training_hit_rate: number;
  false_match_proxy: number;
}

export interface BrainCodexFile {
  version: string;
  generated_at: string;
  training_set: Record<string, unknown>;
  signals: BrainCodexSignalDef[];
}

export interface BrainCase {
  case_id: string;
  type: string;
  city: string;
  vehicle: string;
  transporter: string;
  loss_inr: number;
  rca_summary: string;
  signature_vector: Record<string, number>;
}

export interface BrainCaseIndexFile {
  version: string;
  generated_at: string;
  cases: BrainCase[];
}

export interface BrainEntityRollup {
  driver_number?: string;
  vehicle?: string;
  transporter?: string;
  trips: number;
  trips_with_brain_hit: number;
  risk_score: number;
  top_signal_ids: string[];
}

export interface BrainRollupsFile {
  version: string;
  generated_at: string;
  drivers: BrainEntityRollup[];
  vehicles: BrainEntityRollup[];
  transporters: BrainEntityRollup[];
}
