# Zepto Long Stoppage Intelligence — World-Class Redesign

**Date:** 2026-05-19
**Author:** Arjun Hariharan (FT product)
**Status:** Draft for review
**Customer feedback that triggered this:**
- Idea is loved; their data-science team is independently working on the same problem.
- Flow is not intuitive. Hard to navigate, hard to drill down.
- There is no storyline — the product reads like a report, not a tool.
- UI feels unprofessional; does not follow modern SaaS conventions.
**Commercial weight:** This product line is positioned at a ~$1M ARR price point. The redesign must look and feel like something a buyer at that price expects.

---

## 1. Diagnosis — what is actually broken today

The product *content* is strong: the verdicts file, the risk score breakdown, the rollups by driver/vehicle/transporter/route/trip, the hex map, the POI-enriched evidence. None of that is the problem.

What is broken is the **shell, the story, and the workflow**. Concretely, against the current code:

| Area | Symptom in code | Why the customer reads it as “not professional” |
|---|---|---|
| **Storyline** | `ZeptoLanding.tsx` dumps a KPI strip + a bullet list of themes + 25 ranked verdict cards. There is no narrative, no “what changed since last week”, no recommended order in which to read. | Reads like a PDF, not a product. Buyer can’t answer “what do I do first?” without thinking. |
| **Navigation** | `ZeptoApp.tsx` is a flat 4-tab bar (Findings · Investigate · Hotspot map · Risk zones). Switching tabs throws away state (`setSelectedKey(null)`, `setMapFocus(null)`). | The user feels lost going Finding → Map → Investigate → back. No breadcrumb, no recent-context, no shared filter state. |
| **Drill-down** | Verdict card expands inline; “Investigate” button context-switches to a different page with its own *separate* tab system (`Drivers / Vehicles / Transporters / Routes / Trips`). | Each click is a re-orient, not a deepening. A first-time user has to learn three lens models. |
| **Visual system** | `zepto.css` has reasonable tokens (slate scale, semantic colors, Inter). But pages are riddled with `style={{ fontSize: 11.5, marginTop: 22, padding: "9px 0" }}` — `Investigation.tsx` alone has ~30 inline-style blocks with hand-typed sizes (11, 11.5, 12, 12.5, 13, 18, 20, 22, 24). | Inconsistent spacing and typography is the #1 “unprofessional” tell. Linear/Stripe/Vercel/Notion ship with a strict scale; this ships with whatever fit at the time. |
| **Action loop** | `recommended_action` is rendered as a text paragraph. No button → ticket, no “assign”, no “snooze”, no “mark reviewed”, no audit trail. | Buyer asks: “okay, the dashboard tells me to investigate. Then what?” The answer today is *nothing* — they leave the product. |
| **Map ↔ findings glue** | Finding → map works one-way (`onOpenInMap` sets a focus point), but the map doesn’t know which finding you came from, doesn’t highlight only that finding’s evidence, doesn’t let you walk back. | Map becomes a separate exhibit instead of a continuation of the story. |
| **Naming** | “Findings / Investigate / Hotspot map / Risk zones” — four different metaphors. “Risk zones” is actually an *upload* page for ad-hoc theft zones. | Friction in vocabulary becomes friction in trust. |
| **No persona view** | Same homepage for a security head, ops manager, fleet exec, and CFO. | At $1M, buyers expect role-shaped views: queue for ops, exposure for CFO, hotspots for security. |
| **No comparison / trend** | Every metric is a snapshot. No week-over-week, no peer benchmark, no “this transporter vs your fleet average”. | Without comparison, “73% night share” is a number, not a verdict. |

---

## 2. North Star — what the product becomes

> **A control-tower-grade workbench that turns 3M raw halt alerts into a daily, role-shaped action queue with evidence packets, assignment, and proof of impact — and that gets better the more fleets are on it.**

Three product promises the redesign must deliver every time the customer opens it:

1. **In 10 seconds**, the user knows what changed and what they should do today. (*Pulse*)
2. **In 60 seconds**, the user can drill from any finding to the exact trip / halt / driver / route that explains it, on one continuous canvas. (*Drill*)
3. **In one click**, the user can hand off, snooze, escalate, or close a finding with an auditable trail. (*Act*)

This is the moat. The customer’s DS team can build a model — they cannot build the workflow, the SLA, the multi-customer benchmark, or the integration with FT control room in any reasonable time frame.

---

## 3. The narrative arc — five acts

This is the storyline the leadership said was missing. Every screen is one act. The user can drop in mid-act, but the *default* flow always reads left-to-right.

```
  PULSE  →  HOTSPOTS  →  INVESTIGATE  →  ACT  →  PROVE
   what       where         why          do      did it work
```

### Act 1 — **Pulse** (replaces today’s “Findings” landing)
**Goal:** in 10 seconds, “here is what changed and what I should look at today.”

- Headline: *“12 new priority findings since you last logged in. ₹4.2 L of fresh cargo exposure.”*
- Three cards above the fold:
  - **What changed** (delta block): new findings, resolved findings, escalations, week-over-week movement.
  - **Top of queue** (3 cards, not 25): the highest-priority findings *assigned to you*, sorted by SLA risk.
  - **Fleet posture** (peer benchmark): your unauthorised-halt share vs cold-chain peers; trend over 8 weeks.
- Secondary: themes (kept from today), broken by lens (route / corridor / transporter).
- All cards have a single primary action (Open evidence) and a single secondary (Snooze 24h / Assign).

### Act 2 — **Hotspots** (today’s Hotspot map, narrowed)
**Goal:** answer *where* halts cluster, and let the user lasso a region to investigate.

- Keep the deck.gl hex + scatter views; they are good.
- Add **lasso selection**: draw a region → it becomes a saved investigation scope.
- Add a **timeline scrubber**: show how the hotspot pattern evolved week-by-week.
- Add **layer presets**: “shadow halts only”, “night reefer”, “last 7 days”, “top-25 priority findings overlaid”. Today’s checkboxes are the right ingredients but the wrong UI surface.
- Sidebar drops to a *single* density-aware filter panel using shared filter state with Pulse and Investigate (so a filter you set in Pulse persists to the map and back).

### Act 3 — **Investigate** (today’s Investigation workbench, restructured)
**Goal:** in 60 seconds, walk from a finding to the trip that caused it, with no re-orientation.

- **One continuous panel layout** (not lens-tabs that reset state):
  - Left rail: persistent **stack of entities** the user has touched (driver → vehicle → trip → cluster), each step a chip with the choice they made. Click a chip to walk back.
  - Middle: the focused entity (driver, vehicle, transporter, route, trip, cluster) with the same Stat-tile + recurring-locations + events-table structure as today, but with shared components instead of inline styles.
  - Right: the **evidence packet** for this entity — auto-generated narrative + screenshot of the map + top combinations + sample events table. Exportable as PDF/CSV with one click.
- The lens tabs survive but as a *segmented control inside* the middle panel, not as a top-level navigation. State is preserved when switching lens.

### Act 4 — **Act** (new)
**Goal:** make “what to do next” a first-class workflow, not a paragraph.

- Every finding has a status: `new · triaging · assigned · awaiting-evidence · closed-resolved · closed-no-action`.
- One-click actions on every finding:
  - **Assign** to a teammate (with mention + Slack/email notification if integrated).
  - **Snooze** until a date (auto-resurfaces on Pulse).
  - **Escalate** to security or transporter SLA review.
  - **Close** with a reason (drives the loop-back analytics in Act 5).
- A **Queue view** (separate route, but reachable from Pulse) showing all findings filterable by status, SLA age, owner.
- Audit log on every finding: who did what, when.

### Act 5 — **Prove** (new)
**Goal:** the buyer renews because the product can show *what changed because they used it*.

- A monthly **Impact report** card on Pulse: findings closed, exposure addressed, mean time to triage, peer comparison.
- Per-transporter and per-route **scorecards** with trend lines and a “before / after FT intervention” narrative.
- Optional emailed monthly digest for execs (this is the CFO/CXO touchpoint and the renewal lever).

---

## 4. Information architecture & navigation

**New nav (top bar, in this order):**

```
[Logo · Long Stoppage Intelligence]   Pulse   Hotspots   Investigate   Queue   Reports        ⌘K   ⚙
```

- `Pulse` (default), `Hotspots`, `Investigate` map to acts 1–3.
- `Queue` is the Act-4 work surface (findings + status + assignment).
- `Reports` is the Act-5 proof surface.
- Today’s `Risk zones` upload becomes a **secondary action under `Hotspots`** — “Define custom risk zone” — because that’s what it actually is. Stop putting it in primary nav.
- **Global ⌘K command palette**: jump to driver / vehicle / trip / cluster / route by typing. This is table-stakes for the price point and is what makes the product feel fast.
- **Persistent shared filter state** in a context provider (date range, reefer / non-reefer, day / night, escalation level). Setting a filter on Pulse carries to Hotspots and Investigate.
- **Breadcrumbs** on Investigate, derived from the drill stack.

---

## 5. Design system overhaul — kill the inline styles

The CSS tokens in `zepto.css` are mostly correct (slate scale, Inter, semantic colors). The problem is they are not *enforced*. Acceptance criterion: zero `style={{ fontSize: ... }}` in pages.

### 5.1 Tokens (finalise, then lock)

| Token group | Decision |
|---|---|
| **Type scale** | `text-xs 11px · text-sm 12px · text-base 13px · text-md 14px · text-lg 16px · text-xl 20px · text-2xl 24px · text-3xl 32px`. Nothing else. |
| **Line-height** | tight 1.2 / normal 1.45 / loose 1.6. Nothing else. |
| **Spacing** | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 / 80. Nothing else. |
| **Radius** | sm 4 · md 6 · lg 8 · xl 12 · pill 9999. |
| **Elevation** | none · sm · md · lg · overlay. Five shadows max. |
| **Color** | Brand: yellow `#FFBE07` (sparingly — accent only), brand-blue `#1E64E6` (primary action). Neutrals: slate scale (already defined). Semantic: critical/warning/success/info pairs already defined. **Do not introduce a new colour** without amending this doc. |

### 5.2 Component library

Adopt **shadcn/ui (Radix + Tailwind)** as the component substrate. Reasons:

- Owned components, no vendor lock; can re-style to FT tokens by editing `tailwind.config` once.
- Solves accessibility (Radix primitives) which we currently fail on (no focus rings, no keyboard navigation on the verdict card grid).
- Removes ~40% of the hand-rolled CSS in `zepto.css`.

Required first-pass components (all using FT tokens):

`Button · IconButton · Badge · Tag · Tabs · SegmentedControl · Card · KPI · StatTile · Dialog · Sheet (right-drawer) · DropdownMenu · CommandPalette · Tooltip · Toast · DataTable (with virtualisation) · Filter / FilterBar · Breadcrumb · EmptyState · Skeleton`

Migrate `VerdictCard`, the `Stat` tile inside Investigation, the lens tabs, and the data tables to these primitives.

### 5.3 Density & layout

Two density modes (CSS class on `<body>`): `cozy` (default — current spacing) and `compact` (-15% vertical) for power users. Toggle in user settings. Linear and Notion both ship this.

### 5.4 Motion

- Page transitions: 120ms opacity fade only (no slide; slides feel toy-like at this price).
- Drawer / sheet open: 200ms ease-out.
- Map fly-to: 800–1100ms (already correct).
- Hover transitions: 80ms.
- No bounce, no spring, no parallax. Restraint reads as expensive.

### 5.5 Empty / loading / error states

Currently most pages show a spinner + “Loading risk findings…” and that’s it. Add per-component skeletons (rectangles matching the eventual layout) and meaningful empty states (“No findings in this filter — try widening the date range”).

---

## 6. The action loop — Act 4 in detail

This is the single biggest piece of new functionality. Without it, the product is still a dashboard.

### 6.1 Data model addition

A new `finding_state` document (one per verdict_id):

```jsonc
{
  "verdict_id": "v_001",
  "status": "assigned",          // new | triaging | assigned | awaiting-evidence | closed-resolved | closed-no-action
  "assignee_user_id": "u_42",
  "due_at": "2026-05-22T18:00:00+05:30",
  "snoozed_until": null,
  "comments": [
    { "user_id": "u_42", "ts": "...", "body": "Pulled CCTV — driver was off-route." }
  ],
  "actions_taken": [
    { "type": "assigned", "by": "u_3", "to": "u_42", "ts": "..." },
    { "type": "snoozed", "by": "u_42", "until": "...", "ts": "..." },
    { "type": "closed", "resolution": "transporter_warned", "by": "u_42", "ts": "..." }
  ],
  "linked_external_ticket": null  // Zoho / Jira / Freshdesk id once integration lands
}
```

Storage: phase 1 uses the existing FastAPI backend with a simple SQLite or Postgres table; phase 2 moves to whatever shared store FT control room uses.

### 6.2 SLA model

Each priority tier gets a default SLA: critical 4h, high 24h, medium 72h. Findings approaching SLA breach bubble to the top of the queue and show on Pulse. SLA breach itself is an analytics field for Act 5.

### 6.3 Integrations (phase 2+)

- **Slack / email**: assignment + breach notifications.
- **Zoho TMS / Freshdesk**: open a ticket from a finding, store the ticket id back on the finding.
- **CSV / PDF export of the evidence packet** with FT-branded cover page (phase 1; this alone justifies the price).

---

## 7. Differentiation vs. the customer’s data-science team

The customer told us their DS team is building something similar. This is the strategic question of the project. Five moves the DS team cannot easily replicate:

1. **Pre-built India POI graph (1.6 GB OSM-derived) refreshed quarterly.** A DS team would burn 6 months of work just to keep this maintained. Productise it as “FT POI Graph — Logistics-graded”.
2. **Multi-tenant peer benchmarking.** “Your unauthorised-halt share is 8% — cold-chain peer median is 3.2%.” Their DS team has *only their own data*. We can ship this on day one (anonymised) across JSW, Zepto, and the rest of the FT fleet base.
3. **Integration with the FT control room and TMS.** Findings → tickets → resolution → analytics. They would have to integrate against systems they don’t own. We already speak Zoho.
4. **Workflow, SLA, audit trail (Act 4 above).** This is product engineering work the DS team will not prioritise. Make it the front door.
5. **Continuous model improvement across customers.** Every closed finding (with a reason code) becomes training signal. Their DS team learns from one fleet; ours learns from many. Frame this in renewal conversations.

**Defensive move:** offer the customer an **embedded mode** — they keep their DS team, but their models *feed into* our workflow and benchmarking layer. This makes us the substrate rather than the competitor, and protects the relationship.

---

## 8. Phasing — what to build, in what order

Total scope is large. Phased so that **each phase is independently shippable to the customer** and visibly improves the “does not feel like a $1M product” feeling.

### Phase 1 — “Stop feeling homemade” (2–3 weeks)
Pure UI / system work. No new data, no new backend.
- Adopt shadcn/ui + Tailwind. Migrate `Button`, `Badge`, `Tabs`, `Card`, `DataTable`, `Dialog`, `Tooltip`.
- Strip all inline `style={{ }}` from `Investigation.tsx`, `ZeptoLanding.tsx`, `HotspotMap.tsx`, `VerdictCard.tsx`; replace with token classes.
- Lock type scale and spacing scale; enforce via ESLint rule banning inline `fontSize`/`padding`/`margin`.
- New nav order: Pulse · Hotspots · Investigate · Queue (stub) · Reports (stub).
- Add ⌘K command palette (entity search across drivers/vehicles/trips/clusters).
- Add skeleton loaders and empty states.
- Density toggle (cozy/compact).
- **Deliverable demo:** customer sees the same data, dramatically more professional.

### Phase 2 — “Tell the story” (2–3 weeks)
Rebuild the narrative arc.
- Pulse landing (delta block + top-of-queue + peer benchmark + themes).
- Shared filter context across Pulse / Hotspots / Investigate.
- Drill stack + breadcrumb on Investigate.
- Hotspots timeline scrubber + layer presets + lasso selection.
- Map ↔ findings glue: open finding from map; map highlights only that finding’s evidence.
- Rename and reorganise: Risk zones → secondary action under Hotspots.
- **Deliverable demo:** customer can complete the full “what changed → where → why” walk in under 60 s.

### Phase 3 — “Close the loop” (3–4 weeks)
Workflow.
- `finding_state` document and backend.
- Queue view (status, owner, SLA age).
- Assign / snooze / escalate / close on every finding, with audit log.
- Comment thread on every finding.
- Per-finding evidence packet export (PDF + CSV).
- Slack / email notifications on assignment + SLA breach (config-driven, can disable for demo).
- **Deliverable demo:** the customer’s ops manager can run a real triage session in the tool.

### Phase 4 — “Prove it works” (2–3 weeks)
The renewal layer.
- Reports surface: monthly impact, transporter scorecards, route scorecards, time-to-triage trend.
- Peer benchmarking (anonymised) wired into Pulse + Reports.
- Optional emailed monthly digest.
- **Deliverable demo:** show the buyer a “3 months of FT” narrative they can take to their own management.

### Phase 5 — “Moat moves” (concurrent with 3–4)
The pieces the DS team can’t replicate.
- POI graph productised + version-stamped (already mostly there).
- TMS / Zoho ticket round-trip.
- Embedded-mode story (their model in, our workflow out) packaged as a sales motion, not a feature.

Phases 1 and 2 are the ones that flip the conversation with the customer’s leadership. Phases 3 and 4 protect the renewal.

---

## 9. Success criteria

How we know the redesign worked.

| Layer | Metric | Target |
|---|---|---|
| Perception | Buyer-side feedback after Phase 1 demo | “This now looks like enterprise software.” |
| Flow | Time to walk *Pulse → Investigate → Evidence packet* on a fresh finding | ≤ 60 s with no help text. |
| Drill | Number of clicks from a verdict card to the underlying trip events | ≤ 2. Today: 3 + a context switch. |
| Workflow | % of findings that have a status other than `new` after week 1 of go-live | ≥ 60%. |
| Engagement | DAU / WAU in customer’s ops org | ≥ 0.4. (Linear-grade stickiness.) |
| Impact | Avg time-to-triage (created → status changed) | ≤ 24h for critical, ≤ 72h for high. |
| Renewal | Number of closed-resolved findings per month, growth month-over-month | Positive slope by month 3. |

---

## 10. Open questions (do not block Phase 1)

1. Where does `finding_state` live? Phase 1 can sidestep, but Phase 3 needs a decision: stand-alone Postgres on Render, or join the FT control-room store?
2. Is multi-tenant peer benchmarking gated by a privacy review? If yes, start it now — it’s a 4-week legal review at most large customers.
3. Do we ship Slack notifications as native or behind a generic webhook? Native is faster to demo; webhook is more portable.
4. Will the customer’s DS-team output be ingested as “findings” into our system in the embedded mode? If yes, define the schema in Phase 3.

---

## 11. Out of scope (explicitly)

- Mobile app (a responsive web is enough for Phase 1–4; native is a Phase 6 conversation).
- Real-time ingestion of live alerts (Phase 1–4 is batch / daily refresh).
- Anything beyond long-stoppage intelligence (no driver-behaviour score, no fuel theft, no detention billing — those are separate products; Phase 5 can pitch the *platform*, not bundle them in).
- Replacing the existing landing/JSW Steel module — leave it. The redesign is the Zepto module path only; the JSW landing stays as legacy until the new IA is proven.
