import { useEffect, useState } from "react";
import { Badge, Button, Card, Skeleton, Statistic } from "ft-design-system";
import { api } from "../api";
import type { Summary, Verdict } from "../types";

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

function formatINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

interface Props {
  onInvestigate: (verdict: Verdict) => void;
  onOpenInMap: (verdict: Verdict) => void;
  onSeeAll: () => void;
}

export function Pulse({ onInvestigate, onOpenInMap, onSeeAll }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.summary(), api.verdicts()])
      .then(([s, v]) => { setSummary(s); setVerdicts(v); setLoading(false); })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  const top3 = verdicts.slice(0, 3);
  const exposureSum = verdicts.reduce((acc, v) => acc + (v.estimated_exposure_inr || 0), 0);

  if (loading || !summary) {
    return (
      <div className="mx-auto max-w-[1240px] px-8 py-10">
        <Skeleton className="h-9 w-64 mb-4" />
        <Skeleton className="h-5 w-96 mb-8" />
        <div className="grid grid-cols-4 gap-4 mb-10">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-6 w-48 mb-4" />
        {[0,1,2].map(i => <Skeleton key={i} className="h-32 w-full mb-3" />)}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-8 py-10 text-[var(--color-primary,#434f64)]">

      {/* Title block */}
      <div className="mb-8">
        <div className="text-[11px] tracking-[0.12em] font-semibold uppercase text-[#838c9d] mb-2">
          In-Transit Risk Intelligence · Zepto cold-chain network
        </div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-[#1a2330]">
          {summary.priority_finding_count} priority findings require review
        </h1>
        <div className="mt-2 text-[14px] text-[#5f697b] leading-relaxed max-w-2xl">
          Data window {summary.data_window?.from} → {summary.data_window?.to}.
          Cargo exposure across the top-25 findings:{" "}
          <span className="font-semibold text-[#1a2330]">{formatINR(exposureSum)}</span>.
        </div>
      </div>

      {/* KPI strip — FT Statistic components */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <KPI label="In-transit halts" value={fmt(summary.in_transit_events)} />
        <KPI label="Priority findings" value={String(summary.priority_finding_count)} accent />
        <KPI label="Reefer share" value={`${Math.round(summary.reefer_event_share * 100)}%`} />
        <KPI label="Night-time share" value={`${Math.round(summary.night_event_share * 100)}%`} />
      </div>

      {/* Top of queue — 3 cards */}
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[16px] font-semibold text-[#1a2330]">Top of queue</h2>
        <Button variant="text" size="sm" onClick={onSeeAll}>See all {verdicts.length} findings →</Button>
      </div>
      <div className="space-y-3 mb-10">
        {top3.map((v, i) => (
          <FindingRow
            key={v.verdict_id}
            verdict={v}
            rank={i + 1}
            onInvestigate={() => onInvestigate(v)}
            onOpenInMap={() => onOpenInMap(v)}
          />
        ))}
      </div>

      {/* Pattern observations */}
      {summary.themes && summary.themes.length > 0 && (
        <Card bordered className="!bg-white mb-10">
          <div className="px-5 py-4">
            <div className="text-[12px] font-semibold tracking-[0.06em] uppercase text-[#5f697b] mb-3">
              Pattern observations
            </div>
            <ul className="space-y-2 text-[14px] leading-relaxed text-[#434f64]">
              {summary.themes.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[#FFBE07] font-semibold">·</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* Methodology + partnership framing */}
      <Card bordered className="!bg-[#f8f9fb]">
        <div className="px-5 py-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[12px] font-semibold tracking-[0.06em] uppercase text-[#5f697b]">
              Methodology · Built with Zepto Data Engineering
            </div>
            <Badge variant="info">Partnership</Badge>
          </div>
          <p className="text-[13px] leading-relaxed text-[#5f697b]">
            In-transit filter: ≥2 km from origin and destination, halt ≥30 min, vehicle loaded.
            Eight-factor risk score (0–100) combining frequency, POI distance, duration,
            night-share, cold-chain status, cargo value, transparency and escalation history.
            All findings ship with trip-level evidence and are auditable against{" "}
            <code className="bg-white border border-[#e4e7ec] rounded px-1.5 py-0.5 text-[12px] text-[#434f64]">
              zepto_long_stoppage
            </code>{" "}
            (Databricks Genie workspace, jointly maintained with Zepto DE).
          </p>
        </div>
      </Card>
    </div>
  );
}

function KPI({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card bordered className="!bg-white">
      <div className="px-4 py-3">
        <div className="text-[11px] font-medium tracking-wide uppercase text-[#838c9d] mb-1">
          {label}
        </div>
        <div className={`text-[22px] font-semibold tabular-nums leading-tight ${accent ? "text-[#1a2330]" : "text-[#1a2330]"}`}>
          {value}
          {accent && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-[#FFBE07] align-middle" />}
        </div>
      </div>
    </Card>
  );
}

function FindingRow({
  verdict, rank, onInvestigate, onOpenInMap,
}: { verdict: Verdict; rank: number; onInvestigate: () => void; onOpenInMap: () => void }) {
  const v = verdict;
  const tierVariant: "danger" | "warning" | "info" =
    v.risk_score >= 85 ? "danger" : v.risk_score >= 75 ? "warning" : "info";
  const tierLabel = v.risk_score >= 85 ? "Critical" : v.risk_score >= 75 ? "High" : "Medium";

  return (
    <Card bordered hoverable className="!bg-white">
      <div className="px-5 py-4 flex items-start gap-5">
        <div className="text-[12px] font-semibold text-[#838c9d] tabular-nums w-6 pt-0.5">
          {rank.toString().padStart(2, "0")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Badge variant={tierVariant}>{tierLabel}</Badge>
            <span className="text-[11px] uppercase tracking-wider text-[#838c9d]">{v.type_label}</span>
          </div>
          <div className="text-[15px] font-semibold text-[#1a2330] leading-snug mb-2">
            {v.headline}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[#5f697b]">
            <span><span className="text-[#1a2330] font-medium">{v.stats.count}</span> halts</span>
            <span><span className="text-[#1a2330] font-medium">{v.stats.median_duration_hrs.toFixed(1)} hr</span> median</span>
            <span><span className="text-[#1a2330] font-medium">{Math.round(v.stats.night_share * 100)}%</span> overnight</span>
            <span className="text-[#838c9d]">
              POI: {v.location.nearest_poi_name || "Unmapped"} · {v.location.distance_to_poi_km.toFixed(2)} km
            </span>
          </div>
        </div>
        <div className="flex items-start gap-4 shrink-0">
          <div className="text-right">
            <div className="text-[26px] font-semibold tabular-nums text-[#1a2330] leading-none">
              {v.risk_score}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[#838c9d] mt-1">Risk · 100</div>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={onInvestigate}>Investigate</Button>
            <Button variant="secondary" size="sm" onClick={onOpenInMap}>Open in map</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
