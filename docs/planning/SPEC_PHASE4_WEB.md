# PHASE 4 SPEC — Payments, Cost-Schedule Integration, Reports & AI (Web Adaptation)

**Document**: `docs/planning/SPEC_PHASE4_WEB.md`
**Product**: TechOffice
**Phase**: 4 · **Status**: Draft v1.0 (Web Adaptation)
**Governing document**: `CONSTITUTION_V1.1_WEB.md`
**Source**: Turns 30 (SPEC 4A) + 38 (SPEC 4B) of the imported GLM conversation, adapted for web.

> Phase 4 is the **strategic differentiator** — "BoQ ↔ schedule ↔ cash flow in one web app, at SME pricing."
>
> This is where TechOffice stops being "just a BoQ tool + just a CPM tool" and becomes an integrated cost-schedule-cash platform.

---

## Part 4A — Payments Domain (Interim Payment Engine)

### 1. Scope (UNCHANGED)

**In**: IPC math as a pure domain function — line values (cumulative method), gross work done, retention (with optional cap), advance payment recovery (proportional), deductions & additions, net payable, status workflow, warnings.

**Out (4B)**: retention release at completion, non-proportional advance recovery, variation-valued adjustments.

### 2. The Cumulative Method (UNCHANGED — prevents drift)

Every line value is computed from cumulative quantity: `value_cum = round(qty_cum × rate, 2)`, and the period value is the difference of cumulative values. Never sum period-rounded values across IPCs.

### 3. Business Rules (UNCHANGED)

| ID | RULE |
|----|------|
| BR-IP1 | decimal.js, string I/O, ROUND_HALF_UP, 2dp for all money. |
| BR-IP2 | Line: value_cum = round(qty_cum × rate, 2); value_this_period = value_cum − value_cum_previously_certified. Rate from BoQ item. |
| BR-IP3 | Gross cumulative = Σ line value_cum. Gross this period = gross cum − gross cum previously certified. |
| BR-IP4 | Retention: retention_cum = min(round(ret% × gross_cum, 2), cap); cap optional. This period = retention_cum − retention_previously_held. |
| BR-IP5 | Advance recovery (proportional): recovery_this_period = round(advance × gross_this_period / contract_value, 2); cumulative ≤ advance (cap). |
| BR-IP6 | Deductions/additions are manual line items, positive amounts, per application. Retention + advance recovery are computed — never manual. |
| BR-IP7 | net_cum = gross_cum − retention_cum − recovery_cum − Σdeductions_cum + Σadditions_cum; net_this_period = net_cum − net_certified_prev. Negative net is legal — emit warning, never clamp. |
| BR-IP8 | Line qty_cum > BoQ qty → warning (overrun), not error. |
| BR-IP9 | Applications processed in IPC-number order. "Previously certified" = last application with status certified. |
| BR-IP10 | Certified applications are immutable. Corrections via later applications. |
| BR-IP11 | Validation before compute: lines reference existing BoQ items; period dates valid; IPC numbers sequential; retention % ∈ (0,100]; advance ≤ contract value. |
| BR-IP12 | Pure, deterministic, no I/O. Recompute-all on every run. |

### 4. Golden Tests (UNCHANGED — the law)

| ID | CASE | EXPECTED |
|----|------|----------|
| GT-PAY-1 | Contract 1,000,000 · advance 200,000 · retention 5% · rate 100 · IPC-1: qty 500, IPC-2: qty 1,000 (cum 1,500) | IPC-1: value_cum 50,000, gross 50,000, retention 2,500, recovery 10,000, net 37,500 · IPC-2: value_cum 150,000, gross this 100,000, retention cum 7,500, recovery cum 30,000, net this 75,000, net cum 112,500 |
| GT-PAY-2 | Rounding, cumulative method. Items A rate 964.31, B rate 85.40 · retention 10%, no advance. IPC-1: A 12.5, B 40. IPC-2: A +3.5 (cum 16), B +10 (cum 50) | IPC-1: A value_cum 12,053.88, B 3,416.00, gross cum 15,469.88, retention cum 1,546.99, net 13,922.89 · IPC-2: A 15,428.96, B 4,270.00, gross cum 19,698.96, this 4,229.08, retention cum 1,969.90, net this 3,806.17, net cum 17,729.06 |
| GT-PAY-3 | Retention cap. Contract 100,000 · retention 5% · cap 3,000. | IPC-1 gross 50,000 → retention 2,500 · IPC-2 gross 70,000 → raw 3,500 → capped 3,000 (this 500) · IPC-3 gross 90,000 → 3,000 (this 0) |
| GT-PAY-4 | Advance recovery completes. Contract 200,000 · advance 40,000. | Final gross cum 200,000 → recovery 40,000 exactly. Overshoot 210,000 → recovery still 40,000 (capped), warning. |

---

## Part 4B — Cost-Schedule Integration, Progress, Reports & AI

### 1. Scope (UNCHANGED + web adaptation)

**In**: payments UI + IPC document PDF · variations · cost loading (BoQ→activities) · progress recording & earned value · S-curves & project dashboard · daily reports · monthly progress report · AI infrastructure + first AI features.

**Out**: actual-cost tracking / CPI · retention release & completion mechanics · baseline management UI · XER import.

### 2. Cost-Schedule Integration (the differentiator — UNCHANGED)

| ID | RULE |
|----|------|
| BR-CS1 | Allocations per BoQ item must sum to exactly 100% (decimal-exact). An item may be unlinked (warning only). |
| BR-CS2 | Activity planned cost distributes linearly across its working days (CPM ES..EF). Milestones (dur 0) carry no spread. |
| BR-CS3 | Daily planned values full-precision internally; period buckets + cumulative round HALF_UP to 2dp at output. |
| BR-CS4 | Coverage = linked BoQ value ÷ total BoQ value. Shown in UI; curves computed from linked value only; every chart states its coverage %. |
| BR-CS5 | Progress: at a data date, activity % complete × planned cost = earned value. EV sums per period identically to PV. |
| BR-CS6 | Project progress %: planned = PV(data date)/BAC; actual = EV/BAC (BAC = total linked value). SPI = EV ÷ PV at data date, 2dp. |
| BR-CS7 | Curves always name their schedule run (data date + run id) — a curve without provenance is a bug. |

### ▶▶ WEB ADAPTATION — new business rules:

| ID | RULE |
|----|------|
| BR-WEB-CS1 | S-curve charts use Recharts (React charting library, MIT). Client-side rendering — no server image generation. |
| BR-WEB-CS2 | IPC document PDF: printable HTML (same as Phase 1/3 export — Puppeteer deferred to Phase 5). |
| BR-WEB-CS3 | Daily report PDF + monthly report PDF: printable HTML (Phase 1 pattern). |
| BR-WEB-CS4 | AI infrastructure uses z-ai-web-dev-sdk (already installed from Phase 1 WO-W-6). The IAiProvider interface is already built. |

### 3. Golden Tests (UNCHANGED — the law)

| ID | CASE | EXPECTED |
|----|------|----------|
| GT-CS-1 | Allocation: BoQ item 38,572.40, linked 60% to X, 40% to Y → X = 23,143.44, Y = 15,428.96, Σ = 38,572.40. 60/50 split → error. | Allocations sum to exactly 100% |
| GT-CS-2 | Planned value: A ES Jan 5, dur 5, cost 10,000 → 2,000/day. B FS after A, dur 5, cost 5,000 → 1,000/day. PV cum at Jan 7 = 6,000, Jan 9 = 10,000, Jan 14 = 13,000, Jan 16 = 15,000 | Period buckets P1 = 10,000, P2 = 5,000 |
| GT-EV-1 | Same network, BAC = 15,000. Data date = end of Jan 9. A 100% complete, B 20%. EV = 11,000, PV(DD) = 10,000, SPI = 1.10. Planned progress = 66.67%, Actual = 73.33% | Earned value + SPI correct |
| GT-AI-1 | Fixture project; structured query {sum of item amounts, group by section} → exact expected numbers | NL query executor (deterministic, not the LLM) |

### 4. Data Model (Web Adaptation)

New Prisma models (additive — reserved in Phase 1 schema):

- `PaymentApplication` — id, projectId, ipcNo, periodStart, periodEnd, status (DRAFT|SUBMITTED|CERTIFIED), contractValue, retentionPercent, retentionCapAmount?, advanceAmount, advanceEnabled, grossCum, retentionCum, recoveryCum, deductionsTotal, additionsTotal, netCum, netThisPeriod, version, createdAt, updatedAt, deletedAt?
- `PaymentLine` — id, applicationId, boqItemId, qtyThisPeriod, qtyCum, valueThisPeriod, valueCum, rate, sortOrder
- `PaymentDeduction` — id, applicationId, type (PENALTY|BACKCHARGE|OTHER), descriptionEn, amount, sortOrder
- `PaymentAddition` — id, applicationId, type (MATERIALS_ON_SITE|OTHER), descriptionEn, amount, sortOrder
- `Variation` — id, projectId, boqDocumentId (FK to BoQDocument), ref, titleEn, titleAr?, status (DRAFT|SUBMITTED|APPROVED|REJECTED), approvedValue, version, createdAt, updatedAt, deletedAt?
- `BoQItemScheduleLink` — already exists (reserved in Phase 1) — boqItemId, activityId, allocationPct
- `ProgressUpdate` — id, projectId, dataDate (String ISO), scheduleRunId, notes, version, createdAt
- `ActivityProgress` — id, progressUpdateId, activityId, percentComplete (0-100), actualStart?, actualFinish?
- `DailyReport` — id, projectId, date (String ISO), weather, temperature, notesEn, notesAr?, version, createdAt
- `DailyReportManpower` — id, dailyReportId, tradeEn, tradeAr?, count, sortOrder
- `DailyReportEquipment` — id, dailyReportId, descriptionEn, unit, count, hours, sortOrder
- `DailyReportWorkDone` — id, dailyReportId, locationEn, locationAr?, descriptionEn, descriptionAr?, activityId?, sortOrder
- `DailyReportAttachment` — id, dailyReportId, fileUploadId, captionEn, captionAr?

### 5. Screens (Web Adaptation — SPA views)

| Screen | View name | Description |
|--------|-----------|-------------|
| S22 Payments list | `"payments"` | IPC list with status badges, gross/retention/net |
| S23 IPC editor | `"ipc-editor"` | Header + lines per BoQ item + deductions/additions + live summary |
| S25 Variations | `"variations"` | Variation list (reuses BoQ editor for items) |
| S26 Cost loading | `"cost-loading"` | Two-way link editor (BoQ↔activities), allocation validation, coverage report |
| S27 Progress update | `"progress-update"` | Data date picker → activity % complete table → run CPM → store |
| S28 Project dashboard | `"project-dashboard"` | S-curve chart (Recharts), cards: contract value, SPI, progress %, overdue docs |
| S29 Daily report | `"daily-report"` | Date, weather, manpower rows, equipment rows, work-done rows, photos |
| S30 Monthly report | `"monthly-report"` | Composite report builder (cover + summary + S-curve + payment status + variations) |

### 6. AI Layer

- `IAiProvider` interface already built (Phase 1 WO-W-6)
- `ZaiAiProvider` already implemented (uses z-ai-web-dev-sdk)
- **NL queries** (read-only): LLM emits structured query (zod-validated) → deterministic executor runs it → result table. LLM never writes SQL or data.
- **Import assist**: when Excel mapping fails, LLM proposes column mapping → rendered in S8 wizard for engineer approval. Proposal-only.
- Both features degrade silently: no key configured → buttons hidden, zero errors.

---

## Implementation Work Orders

### Group T — Domain Core (Payments + Cost-Schedule) — sequential
| WO | Name | Files | Test |
|----|------|-------|------|
| **W4-1** | Payments domain (cumulative method, retention, advance, net) | `src/shared/schemas/payments/*.ts`; `src/domain/payments/ipc-engine.ts` | GT-PAY-1..GT-PAY-4 all green |
| **W4-2** | Cost-loading domain (allocations, planned cost, coverage) | `src/domain/payments/cost-loading.ts` | GT-CS-1 green |
| **W4-3** | Planned value domain (daily distribution, period buckets, S-curve data) | `src/domain/payments/planned-value.ts` | GT-CS-2 green |
| **W4-4** | Earned value domain (EV, SPI, progress %) | `src/domain/payments/earned-value.ts` | GT-EV-1 green |

### Group U — Prisma Schema + Repositories — sequential after T
| WO | Name | Files | Test |
|----|------|-------|------|
| **W4-5** | Prisma schema: PaymentApplication, PaymentLine, PaymentDeduction, PaymentAddition, Variation, ProgressUpdate, ActivityProgress, DailyReport + children | `prisma/schema.prisma` (additive) | `db:generate` + `db:push` |
| **W4-6** | Repository interfaces + Prisma impls | `src/domain/repositories/payments-repositories.ts`; `src/infrastructure/persistence/prisma/payments/*.ts` | Integration tests |
| **W4-7** | AI executor domain (structured query → result) | `src/domain/ai/query-executor.ts` | GT-AI-1 green |

### Group V — API Routes — sequential after U
| WO | Name | Files |
|----|------|-------|
| **W4-8** | Payments API (CRUD + compute + IPC document) | `src/app/api/projects/[projectId]/payments/route.ts`; `payments/[id]/route.ts`; `payments/[id]/compute/route.ts` |
| **W4-9** | Variations API (CRUD + approve) | `src/app/api/projects/[projectId]/variations/route.ts`; `variations/[id]/route.ts` |
| **W4-10** | Cost loading API (links + allocations + coverage) | `src/app/api/projects/[projectId]/cost-loading/route.ts` |
| **W4-11** | Progress API (create update + run CPM + store) | `src/app/api/projects/[projectId]/progress/route.ts`; `progress/[id]/route.ts` |
| **W4-12** | Project dashboard API (S-curve data, SPI, cards) | `src/app/api/projects/[projectId]/project-dashboard/route.ts` |
| **W4-13** | Daily reports API (CRUD + attachments) | `src/app/api/projects/[projectId]/daily-reports/route.ts`; `daily-reports/[id]/route.ts` |
| **W4-14** | Monthly report API (composite data) | `src/app/api/projects/[projectId]/monthly-report/route.ts` |
| **W4-15** | AI NL query API (POST query → structured result) | `src/app/api/projects/[projectId]/ai-query/route.ts` |

### Group W — UI Views — parallel after V
| WO | Name | Files |
|----|------|-------|
| **W4-16** | Payments list (S22) | `src/components/views/payments-view.tsx` |
| **W4-17** | IPC editor (S23) | `src/components/views/ipc-editor-view.tsx` |
| **W4-18** | Variations (S25) | `src/components/views/variations-view.tsx` |
| **W4-19** | Cost loading (S26) | `src/components/views/cost-loading-view.tsx` |
| **W4-20** | Progress update (S27) | `src/components/views/progress-update-view.tsx` |
| **W4-21** | Project dashboard with S-curve (S28) | `src/components/views/project-dashboard-view.tsx` |
| **W4-22** | Daily report (S29) | `src/components/views/daily-report-view.tsx` |
| **W4-23** | Monthly report (S30) | `src/components/views/monthly-report-view.tsx` |

---

## Exit Criteria

1. GT-PAY-1..GT-PAY-4 all green (payments law)
2. GT-CS-1..GT-CS-2 all green (cost-schedule law)
3. GT-EV-1 green (earned value law)
4. GT-AI-1 green (AI executor law)
5. All 8 screens (S22-S30) accessible and functional
6. S-curve chart renders with planned vs earned curves
7. IPC document produces printable form
8. AI NL query returns correct results
9. Domain layer purity maintained
