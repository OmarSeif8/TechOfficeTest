# PHASE 2 SPEC — Scheduling Domain (CPM Engine) — Web Adaptation

**Document**: `docs/planning/SPEC_PHASE2_WEB.md`
**Product**: TechOffice (working title)
**Phase**: 2 · **Status**: Draft v1.0 (Web Adaptation)
**Governing document**: `CONSTITUTION_V1.1_WEB.md`. Conflicts → Constitution wins.
**Source**: Turn 28 of the imported GLM 5.2 conversation, adapted for Next.js 16 web app.

> **How to read this document**: The CPM engine is **pure math** — platform-agnostic by definition. The original spec's BR-P1..P16 rules and GT-P1..P6 golden tests are **UNCHANGED**. Only the persistence layer (Prisma instead of SQLite direct) and the UI (web Gantt instead of desktop Gantt) are adapted.

---

## 1. Scope

**In scope (Phase 2)**:
- Calendars (single, with exceptions) — per-project, user-editable
- WBS (Work Breakdown Structure) — organizational only (not a schedule)
- Activities (task/milestone)
- Relationships (FS/SS/FF/SF ± lag)
- CPM computation (ES/EF/LS/LF/total float/critical path)
- Cycle detection
- Engine I/O contract
- Golden tests (GT-P1..P6)
- **Web Gantt UI** (S11-S15) — server-side schedule runs, client-side Gantt rendering

**Out of scope (Phase 2B+, additive later)**:
- Multiple calendars per project
- Date constraints
- Resource/cost loading
- Baselines & updates
- Free float
- WBS date rollups
- XER/MSP import

---

## 2. Web Adaptation Notes

### What stays identical to the original desktop spec:
- **All business rules (BR-P1..P16)** — calculation law is platform-agnostic
- **All golden tests (GT-P1..P6)** — hand-computed values are the law
- **Engine I/O contract** — pure function: `(network, calendar, projectStart) → result`
- **Calendar semantics** — working-day index model, exception override
- **Relationship semantics** — FS/SS/FF/SF with lag
- **Cycle detection** — topological sort, structured error on failure

### What changes for web:
| Original (Desktop) | Adapted (Web) |
|--------------------|---------------|
| Engine runs in-process (better-sqlite3) | Engine runs in Next.js API route (server-side) |
| Schedule results cached in `.toproj` file | Schedule results cached in `ScheduleRun` + `ScheduleActivity` Prisma tables |
| Gantt renders in Electron window | Gantt renders as React component (client-side, SVG-based) |
| WBS tree in desktop sidebar | WBS tree in web sidebar (same Zustand view-switching pattern) |
| User clicks "Calculate" → instant (in-process) | User clicks "Calculate" → POST /api/scheduling/run → returns results |

### ▶▶ WEB ADAPTATION — new business rules:
| ID | RULE |
|----|------|
| BR-WEB-P1 | Schedule runs are server-side transactions: POST /api/projects/[id]/scheduling/run creates a ScheduleRun row + bulk-inserts ScheduleActivity rows in one Prisma $transaction. |
| BR-WEB-P2 | The pure domain engine (`src/domain/scheduling/cpm.ts`) never touches the request/response cycle or the database. It takes a typed input, returns a typed output. The API route translates HTTP ↔ domain types. |
| BR-WEB-P3 | Schedule runs are immutable: once committed, a ScheduleRun cannot be modified. To re-run, create a new ScheduleRun (the old one is kept for audit). The "current" schedule is the latest ScheduleRun by createdAt. |
| BR-WEB-P4 | The Gantt UI fetches the latest ScheduleRun via GET /api/projects/[id]/scheduling/current. Client-side rendering only — no server-side Gantt image generation. |
| BR-WEB-P5 | Calendar editing (S14) is a web form: weekday mask checkboxes + exception date picker. POST /api/projects/[id]/calendar updates the ProjectCalendar row. |
| BR-WEB-P6 | WBS editing (S12) is a tree view with drag-reorder (dnd-kit, same pattern as BoQ sections). POST/PUT/DELETE /api/projects/[id]/wbs. |

---

## 3. Business Rules (calculation law) — UNCHANGED

| ID | RULE |
|----|------|
| BR-P1 | Dates are plain calendar dates (ISO yyyy-MM-dd), day-granularity. No times, no timezones, no DST. JS Date objects never enter the domain — strings in, strings out. |
| BR-P2 | The engine is a pure function: (network, calendar, projectStart) → result. No Date.now(), no randomness, no I/O. Same input → byte-identical output. |
| BR-P3 | Durations are working-day counts, integers ≥ 0. Milestone = duration 0 (ES = EF). |
| BR-P4 | Lag is an integer, any sign, in working days of the project calendar. |
| BR-P5 | isWorking(d): if an exception exists for d → its isWorking; else the weekday mask. Exceptions override, in both directions. |
| BR-P6 | The mask must have ≥ 1 working weekday; otherwise the calendar is invalid (rejected at save). |
| BR-P7 | Working-day index: the project's working days form an ordered sequence; every working date maps to an integer index. All engine arithmetic happens in indices; dates convert at the boundary only. |
| BR-P8 | Project start may be any date; open-start activities (no predecessors) start at the first working day ≥ project start. |
| BR-P9 | Default seeded calendar (Egyptian/Gulf practice per Constitution Decision A): Sun–Thu working, Fri–Sat off. User-editable. Golden tests construct their own calendars and never depend on the seed. |
| BR-P10 | Forward pass: ES(a) = max over all relationship bounds; if no predecessors → snapped project start. EF(a) = ES(a) + dur(a) − 1 (duration 0 → EF = ES). |
| BR-P11 | Backward pass: Project finish = max EF. For no successors: LF = project finish. Otherwise LF(a) = min over relationship bounds. Then LS(a) = LF(a) − (dur(a)−1). |
| BR-P12 | Total float (working days) = LS − ES (≡ LF − EF). Critical ⇔ totalFloat ≤ 0. |
| BR-P13 | Multiple relationships between the same pair are legal; all bounds apply. |
| BR-P14 | Cycles are rejected, never traversed: topological sort; on failure return a structured error listing the cycle's activity codes. The engine must terminate on any input. |
| BR-P15 | A relationship may push an activity's ES before project start (negative lag). Legal — engine computes and emits a warning. Never silently clamp. |
| BR-P16 | Validation before compute: relationship references existing activities; no self-relationship; rel_type in enum; duration ≥ 0 integer; lag integer. Violations → structured validation errors, no partial results. |

---

## 4. Golden Test Cases (authoritative — UNCHANGED)

All tests use a Mon–Fri calendar, no exceptions, project start Mon 2026-01-05, unless stated otherwise.

| ID | CASE | EXPECTED |
|-----|------|----------|
| GT-P1 | Basic FS chain, weekend crossing. A(d3) → B(d2) → C(d4), all FS lag 0. | A: ES Jan 5, EF Jan 7 · B: ES Jan 8, EF Jan 9 · C: ES Jan 12, EF Jan 15 · all critical · project finish Jan 15 |
| GT-P2 | Parallel paths, float. A(d2); B: FS after A, d10; C: FS after A, d3; D: FS after C, d4; E: FS after B and FS after D, d1. | A: ES Jan 5, EF Jan 6, TF 0, critical · B: ES Jan 7, EF Jan 20, TF 0, critical · C: ES Jan 7, EF Jan 9, TF 3 · D: ES Jan 12, EF Jan 15, TF 3 (LS Jan 15) · E: ES Jan 21, EF Jan 21, TF 0, critical · project finish Jan 21 · critical path A→B→E |
| GT-P3 | SS and FF relationships. A(d10); B: SS from A lag 2, d5; C: FF from A lag 0, d3; D: FS from B and FS from C, d2. | A: ES Jan 5, EF Jan 16, TF 0, critical · B: ES Jan 7, EF Jan 13, TF 3 (LS Jan 12) · C: ES Jan 14, EF Jan 16, TF 0, critical · D: ES Jan 19, EF Jan 20, TF 0, critical · project finish Jan 20 · critical path A→(FF)→C→D |
| GT-P4 | Negative lag. A(d5); B: FS from A lag −2, d3. | A: ES Jan 5, EF Jan 9 · B: ES Jan 8, EF Jan 10 · both critical · project finish Jan 10 |
| GT-P5 | Milestones + holiday exception. Calendar: Mon–Fri except Wed Jan 7 = holiday. M1 start milestone (d0) at project start; A: FS from M1, d3; M2 finish milestone: FS from A (d0). | M1: ES = EF = Jan 5 · A: ES Jan 6, EF Jan 9 (working days Jan 6, 8, 9 — the 7th is skipped) · M2: ES = EF = Jan 12 · all critical · project finish Jan 12 |
| GT-P6 | Cycle rejection (behavioral). A FS→ B, B SS→ A. | Engine returns {kind: 'cycle'} naming A and B, terminates immediately, produces no dates. |

> **Ritual**: before implementation, one human re-derives GT-P1..P5 on paper independently — pilot engineer sign-off.

---

## 5. Data Model (Web Adaptation)

New Prisma models (additive — reserved in Phase 1 schema):

### `ProjectCalendar`
- `id` String @id @default(cuid())
- `projectId` String (FK to Project)
- `mondayWorking` Boolean @default(true)
- `tuesdayWorking` Boolean @default(true)
- `wednesdayWorking` Boolean @default(true)
- `thursdayWorking` Boolean @default(true)
- `fridayWorking` Boolean @default(false) — per BR-P9 (Egyptian/Gulf default)
- `saturdayWorking` Boolean @default(false)
- `sundayWorking` Boolean @default(true)
- `version` Int @default(1)
- `createdAt` DateTime @default(now())
- `updatedAt` DateTime @updatedAt

### `CalendarException`
- `id` String @id @default(cuid())
- `calendarId` String (FK to ProjectCalendar)
- `date` String (ISO yyyy-MM-dd — per BR-P1, strings not Date)
- `isWorking` Boolean
- `nameEn` String? (e.g. "New Year's Day")
- `nameAr` String?
- `@@unique([calendarId, date])`

### `WbsNode`
- `id` String @id @default(cuid())
- `projectId` String
- `parentId` String? (self-reference for tree)
- `code` String (e.g. "1.2.3")
- `nameEn` String
- `nameAr` String?
- `sortOrder` Int
- `deletedAt` DateTime?

### `Activity`
- `id` String @id @default(cuid())
- `projectId` String
- `wbsNodeId` String? (FK to WbsNode — organizational)
- `code` String
- `nameEn` String
- `nameAr` String?
- `duration` Int (working days, ≥ 0 per BR-P3)
- `isMilestone` Boolean @default(false) — duration 0
- `sortOrder` Int
- `version` Int @default(1)
- `deletedAt` DateTime?

### `ActivityRelationship`
- `id` String @id @default(cuid())
- `projectId` String
- `predecessorId` String (FK to Activity)
- `successorId` String (FK to Activity)
- `type` RelationshipType (FS | SS | FF | SF)
- `lag` Int @default(0)
- `@@unique([predecessorId, successorId, type])`

### `ScheduleRun`
- `id` String @id @default(cuid())
- `projectId` String
- `projectStart` String (ISO yyyy-MM-dd)
- `status` ScheduleRunStatus (SUCCESS | CYCLE_DETECTED | VALIDATION_ERROR)
- `projectFinishDate` String? (null if error)
- `criticalPathJson` String? (JSON array of activity IDs)
- `warningsJson` String? (JSON array of {code, activityId?})
- `errorJson` String? (JSON of cycle/validation errors)
- `runById` String (FK to User)
- `createdAt` DateTime @default(now())

### `ScheduleActivity`
- `id` String @id @default(cuid())
- `scheduleRunId` String (FK to ScheduleRun)
- `activityId` String (FK to Activity)
- `es` String (ISO date — early start)
- `ef` String (ISO date — early finish)
- `ls` String (ISO date — late start)
- `lf` String (ISO date — late finish)
- `totalFloatDays` Int
- `isCritical` Boolean
- `@@unique([scheduleRunId, activityId])`

---

## 6. Screen Specifications (Web Adaptation)

### S11: Scheduling Dashboard
- View name: `"scheduling"` (new nav item in sidebar)
- Shows: current schedule run summary (project start, finish, critical path length), warnings, "Run schedule" button
- Data: `GET /api/projects/[id]/scheduling/current`

### S12: WBS Tree
- View name: `"wbs"` (or integrated into S11)
- Tree view with drag-reorder (dnd-kit — same pattern as BoQ sections)
- CRUD: `POST/PUT/DELETE /api/projects/[id]/wbs`

### S13: Activities List
- View name: `"activities"`
- Table: Code | Name (EN/AR) | Duration | WBS Node | Predecessors | Actions
- CRUD: `POST/PUT/DELETE /api/projects/[id]/activities`

### S14: Calendar Editor
- View name: `"calendar"`
- Weekday mask checkboxes (7 days)
- Exceptions table: date picker + isWorking toggle + name (EN/AR)
- Save: `PUT /api/projects/[id]/calendar`

### S15: Gantt Chart
- View name: `"gantt"`
- SVG-based Gantt rendering (client-side, no server image generation)
- Time axis: working days from project start to finish
- Bars: colored by criticality (critical = primary accent, non-critical = muted)
- Dependencies: arrows between bars (FS/SS/FF/SF)
- Data: `GET /api/projects/[id]/scheduling/current` (returns activities with ES/EF/LS/LF)

---

## 7. Implementation Work Orders (Phase 2)

### Group J — Domain Core (CPM Engine) — sequential
| WO | Name | Files | Test |
|----|------|-------|------|
| **W2-1** | Calendar domain (isWorking, index↔date) | `src/shared/schemas/scheduling/calendar.ts`; `src/domain/scheduling/calendar.ts` | Calendar unit tests (isWorking precedence, index round-trips) |
| **W2-2** | CPM engine (forward + backward pass) | `src/shared/schemas/scheduling/network.ts`; `src/domain/scheduling/cpm.ts` | GT-P1..P5 all green |
| **W2-3** | Cycle detection + validation | `src/domain/scheduling/cycle-detection.ts` | GT-P6 + validation edge cases |

### Group K — Prisma Schema + Repositories — sequential after J
| WO | Name | Files | Test |
|----|------|-------|------|
| **W2-4** | Prisma schema: ProjectCalendar, CalendarException, WbsNode, Activity, ActivityRelationship, ScheduleRun, ScheduleActivity | `prisma/schema.prisma` (additive) | `bun run db:generate` + `db:push` |
| **W2-5** | Repository interfaces + Prisma impls | `src/domain/repositories/scheduling/*.ts`; `src/infrastructure/persistence/prisma/scheduling/*.ts` | Integration tests |

### Group L — API Routes — sequential after K
| WO | Name | Files | Test |
|----|------|-------|------|
| **W2-6** | Calendar API (GET/PUT) | `src/app/api/projects/[id]/calendar/route.ts` | CRUD test |
| **W2-7** | WBS API (CRUD + reorder) | `src/app/api/projects/[id]/wbs/route.ts`; `[wbsId]/route.ts` | CRUD test |
| **W2-8** | Activities API (CRUD) | `src/app/api/projects/[id]/activities/route.ts`; `[activityId]/route.ts` | CRUD test |
| **W2-9** | Relationships API (CRUD) | `src/app/api/activities/[id]/relationships/route.ts`; `[relId]/route.ts` | CRUD test |
| **W2-10** | Schedule run API (POST run, GET current) | `src/app/api/projects/[id]/scheduling/run/route.ts`; `current/route.ts` | GT-P1..P5 through API |

### Group M — UI Views — parallel after L
| WO | Name | Files |
|----|------|-------|
| **W2-11** | Scheduling dashboard view (S11) | `src/components/views/scheduling-view.tsx` |
| **W2-12** | WBS tree view (S12) | `src/components/views/wbs-view.tsx` |
| **W2-13** | Activities list view (S13) | `src/components/views/activities-view.tsx` |
| **W2-14** | Calendar editor view (S14) | `src/components/views/calendar-view.tsx` |
| **W2-15** | Gantt chart view (S15) | `src/components/views/gantt-view.tsx` |

---

## 8. Exit Criteria

1. GT-P1..P6 all green (golden tests law)
2. All 5 screens (S11-S15) accessible and functional
3. Schedule run creates immutable ScheduleRun + ScheduleActivity rows
4. Gantt renders with critical path highlighted
5. Calendar editor with weekday mask + exceptions works
6. WBS tree with drag-reorder works
7. Cycle detection returns structured error (not a crash)
8. Engine is pure (no Date.now(), no I/O — deterministic)
