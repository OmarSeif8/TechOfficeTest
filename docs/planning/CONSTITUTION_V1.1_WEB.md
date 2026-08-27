# PROJECT CONTEXT DOCUMENT — v1.1 (Web Adaptation)

**Working title**: TechOffice (final name TBD)
**Status**: Phase 0 — Planning. Zero application code written by design.
**This version**: v1.1 — adapts the v1.0 desktop Constitution for the Next.js 16 web MVP build (Path C).
**Source**: Turn 16 of the imported GLM 5.2 conversation (`docs/imported/full-conversation.md`).

> **How to read this document**: Plain text reproduces the v1.0 Constitution. **AMENDMENT #5 (Web Adaptation)** blocks (marked with `▶▶`) are the v1.1 changes. The Constitution's spirit — golden tests as law, pure domain core, AI proposes/engineer approves, data never hostage, bilingual EN/AR — is preserved unchanged. Where the v1.0 desktop mechanism (e.g., `.toproj` files) is replaced by a web mechanism (e.g., DB rows), the rule is restated, not deleted.

---

## 1. What This Product Is

A **web application** for civil and architectural engineers' technical office work: quantities & cost (BoQ, takeoff, unit rates, payments), CPM planning (P6-lite), document control, and reporting — replacing scattered Excel files.

> ▶▶ **AMENDMENT #5.1 (Web Adaptation)**: v1.0 specified "cross-platform Windows+Linux offline-first desktop application". v1.1 ships as a **Next.js 16 web application** (Path C: build web MVP here, later take to a desktop agent for Electron packaging). The product's purpose, target users, and feature set are unchanged. The strategic differentiator below is unchanged.

**Strategic differentiator**: native integration between BoQ cost data and the schedule (BoQ items → activities → planned cash flow). P6 does cost loading badly; Excel has no schedule. We connect them at a price SME firms can afford.

---

## 2. Target Users

Technical office engineers (civil/architectural), SME contractors and consultancies, Egypt/Gulf primary market.

> ▶▶ **AMENDMENT #5.2 (Web Adaptation)**: v1.0 said "One engineer per machine — no multi-user features in v1". v1.1 keeps the **one-engineer-per-account** model (no real-time collaboration in v1) but each engineer accesses the web app from any browser with their auth credentials. Multi-user features (shared projects, team roles) remain Phase 5+.

Users frequently have restricted/no internet — the app must **degrade gracefully**: core BoQ editing against the server cache; AI and large file operations are enhancements, never dependencies. True offline is restored in the future Electron desktop port.

> ▶▶ **AMENDMENT #5.3 (Web Adaptation)**: v1.0 said "fully functional offline, always". Web MVP cannot deliver true offline (see `ADAPTATION_GUIDE.md` §5.1). The rule is reframed: the **domain core never requires network**; only persistence and AI do. A future Electron port restores the original "fully offline always" rule by swapping repository implementations.

English + Arabic (full RTL) from day one — Arabic is not an afterthought.

---

## 3. Locked Decisions (do not revisit without explicit owner decision)

| AREA | DECISION |
|------|----------|
| Stack | ▶▶ **AMENDMENT #5.4**: Next.js 16 (App Router) + TypeScript (strict) + React 19 + Prisma + SQLite. (v1.0 was "Electron + TypeScript + React + SQLite (better-sqlite3)".) |
| Gantt | Custom-built, zero-cost libraries (TanStack Table/Virtual + SVG). Engine-first: CPM engine in pure TS first, Gantt UI in stages — **unchanged from v1.0** |
| Licensing | ▶▶ **AMENDMENT #5.5**: Web subscription (monthly/annual), auth-gated via NextAuth. License state = per-user `Subscription` row in DB. No GPL concern in web. (v1.0 was "Ed25519-signed license file, machine binding, offline validation, 30-day grace period".) |
| Cloud | ▶▶ **AMENDMENT #5.6**: App is server-hosted (single Postgres/SQLite DB + blob storage for attachments). User data lives in the user's account on our server. Future: BYO storage option for enterprise. (v1.0 was "None of ours. BYO storage (client's Drive/Dropbox/Nextcloud).") |
| AI in product | ▶▶ **AMENDMENT #5.7**: Pluggable `IAiProvider` interface in `src/services/ai/`. Default impl: `ZaiAiProvider` (uses `z-ai-web-dev-sdk`, server-side). Future impls: `OllamaProvider` (Electron port), `OpenAIProvider`, `AnthropicProvider` (BYO API keys in `UserSettings` table). Core never depends on AI — **unchanged from v1.0** |
| Drawings | DXF viewed natively in-app (WebGL/Three.js). DWG via user-uploaded ODA File Converter output → DXF. Paid DWG SDK deferred until revenue justifies — **unchanged from v1.0** |
| PDF export | HTML templates → server-side Puppeteer/Chromium print-to-PDF (only Arabic-safe path). Client-side `window.print()` on dedicated print routes for quick preview — **unchanged mechanism, different runtime** |
| Excel export | ExcelJS (server-side), `rightToLeft: true` for Arabic — **unchanged from v1.0** |
| Numbers | decimal.js for all money and quantities — floats never touch money — **unchanged from v1.0** |
| Distribution | ▶▶ **AMENDMENT #5.8**: Web deployment (Vercel-style or self-hosted Node). No installers. Auto-update = every page load is latest. (v1.0 was "electron-builder: NSIS + AppImage/.deb; Azure Trusted Signing; electron-updater".) |
| Auth | ▶▶ **AMENDMENT #5.9** (new): NextAuth (Auth.js) for email/password + optional OAuth (Google). Session = DB-backed or JWT. Required for web; not applicable to v1.0 desktop. |

---

## 4. Architecture — The Law of Layers

```
UI LAYER          Next.js Client Components + Server Components
                  (App Router: src/app/) — shadcn/ui + TanStack Query
                  src/components/
APPLICATION       persistence · export · licensing · AI providers · settings
SERVICES          src/services/  (interfaces + impls)
DOMAIN CORE       pure TypeScript — boq · estimating · cpm/scheduling · units · payments
                  src/domain/    ← NO imports of UI, Next, React, Node, network, fs
SHARED            zod schemas (source of truth) · i18n · types · units registry
                  src/shared/    ← imports nobody
INFRASTRUCTURE    Prisma repository implementations (concrete adapters)
                  src/infrastructure/   ← imports domain repository interfaces + Prisma
```

> ▶▶ **AMENDMENT #5.10 (Web Adaptation)**: v1.0 had 4 layers (UI / Services / Domain / Shared). v1.1 adds a 5th layer: **Infrastructure** (`src/infrastructure/`), which holds concrete repository implementations (e.g., `PrismaProjectRepository`). This separation is what makes the codebase portable: the Domain layer depends on repository **interfaces** (defined in `src/domain/repositories/`), not on Prisma. A future Electron port adds `SqliteProjectRepository` in the same Infrastructure folder without touching Domain.

> ▶▶ **AMENDMENT #5.11 (Web Adaptation)**: Next.js App Router introduces the Server Component / Client Component boundary. Rules:
> - **Server Components** (`src/app/*/page.tsx` without `'use client'`): may import Services + Infrastructure directly; may render Client Components; cannot use hooks like `useState`.
> - **Client Components** (`'use client'` files): may only import `@shared/*`, `@domain/*` (types and pure functions), and call Services via typed `fetch()` wrappers (never direct Prisma). State via Zustand + TanStack Query.
> - **API Routes** (`src/app/api/*/route.ts`): the web equivalent of Electron IPC handlers; instantiate Services with Infrastructure adapters per request.

### Rules (violations are bugs):

1. **Dependency direction is one-way**: `ui → app → services → infrastructure → domain → shared`. Nothing imports "upward." `shared` imports nobody.
2. **Domain core is pure**: no UI, no I/O, no Next.js, no React, no Node, no network, no filesystem. All calculation logic lives here. Verified by `eslint.config.mjs` `no-restricted-imports` rule and an isomorphic compile test in CI.
3. **Every entity has a zod schema in `shared/`**: database rows, API request/response bodies, and future AI tools all derive from it.
4. **A calculation without a golden test is unfinished work.** Every calculator and every CPM scenario gets a test with a hand-calculated known answer before the code is accepted. (Unchanged from v1.0.)
5. **UI renders; it never computes.** The Gantt component renders engine output — never schedules. The BoQ grid renders totals computed in the domain — never recomputes. (Unchanged from v1.0.)
6. ▶▶ **AMENDMENT #5.12 (Web Adaptation)** (new): **Repository interfaces live in `src/domain/repositories/`** (e.g., `IProjectRepository`, `IBoQRepository`). Implementations live in `src/infrastructure/`. Server Components and API Routes inject the implementation; Client Components never touch repositories directly.
7. ▶▶ **AMENDMENT #5.13 (Web Adaptation)** (new): **Service interfaces live in `src/services/` next to their impls** (e.g., `src/services/ai/types.ts` defines `IAiProvider`; `src/services/ai/zai-provider.ts` implements it). The default binding is wired in `src/services/index.ts` and can be swapped per environment.

---

## 5. Data Architecture

> ▶▶ **AMENDMENT #5.14 (Web Adaptation)**: v1.0 had two databases — an App DB (`app.db` in user-data directory) and a Project DB (`.toproj` file per project). v1.1 has **one Prisma-managed database** (SQLite for dev, can scale to Postgres for prod) with `userId` / `projectId` discriminators on every table. App-level reference data (Units, ItemLibrary) sits alongside project-scoped data (BoQDocuments, Items), separated by table not by file. The logical separation is preserved; the physical separation is not. See `ERD_V1.1_WEB.md` for the full schema.

### Save model

> ▶▶ **AMENDMENT #5.15 (Web Adaptation)**: v1.0 specified atomic writes (write temp → rename) for `.toproj` files, debounced autosave (2–5 s), conflict detection via SHA-256, snapshots in app data. v1.1 preserves the **guarantees** but changes the mechanism:
> - **Atomic saves**: Prisma `$transaction` (DB-level atomicity) replaces temp-file-rename. All multi-row writes (e.g., importing a BoQ document with 100 items) happen inside one transaction — all-or-nothing.
> - **Debounced autosave**: client-side debounce (2 s) of mutations, sent as PATCH requests. Server validates and applies; client rolls back on error via TanStack Query.
> - **Conflict detection**: optimistic concurrency control via `version` integer column on `Project` (and other aggregates). PATCH must include `where: { id, version: expectedVersion }`; if 0 rows updated, return 409 Conflict — client shows "another tab edited this; reload or fork".
> - **Snapshots**: `ProjectSnapshot` table stores serialized project state (JSON) + attachments (referenced by `FileUpload` rows). "Restore previous version" = create new snapshot, then overwrite project rows from chosen snapshot in a transaction.

### Sync-safety rules (mandatory, always on)

- Atomic saves: DB transactions (Prisma `$transaction`). No partial writes on crash.
- Debounced autosave (2 s): client-side; server applies via PATCH.
- External-change detection: optimistic concurrency (version token) — never silently overwrite.
- Automatic snapshots: `ProjectSnapshot` rows on interval + before imports + before destructive operations. Metadata in `ProjectSnapshot` table.

### Row-level conventions (unchanged from v1.0)

Every row carries `id` (UUID/CUID) + `updated_at` from day one — future cloud sync requires no schema rewrite.

---

## 6. Module Roadmap

| PHASE | CONTENT | EXIT CRITERIA |
|-------|---------|---------------|
| 0 (now) | This doc, Phase 1 spec, full ERD, repo scaffold | Docs approved; scaffold committed |
| 1 | BoQ MVP: projects, BoQ builder, unit-rate analysis, takeoff calculators, item library, deterministic Excel import, Excel/PDF export (EN+AR) | Pilot firms validate outputs against their Excel results on a real project |
| 2 | Planning: CPM engine (pure TS, fully tested) → activity table + read-only Gantt → drag/link editing → filters/grouping | Hand-checked schedule reproduces correctly; critical path correct |
| 3 | DXF viewer (WebGL), DWG conversion (user-supplied ODA output), drawing register, submittals, RFI, correspondence logs | Real drawings open and measure correctly |
| 4 | Payments, daily/progress reports, dashboards, cost–schedule integration, S-curves; first AI features (BoQ import assist, NL queries) | Payment math passes golden tests + pilot review |
| 5 | Licensing (web subscription), payments (merchant-of-record + regional bank transfer), launch, **Electron desktop port** | First paid activation succeeds end-to-end; desktop build runs against same `src/domain/` |

> ▶▶ **AMENDMENT #5.16 (Web Adaptation)**: Phase 5 explicitly includes the Electron desktop port — taking the web codebase and wrapping it with Electron + better-sqlite3 + OllamaProvider. This is Path C: web first, desktop later.

---

## 7. Non-Negotiables

1. **Calculation correctness IS the product.** One wrong bar-bending schedule shared between firms ends it. Golden tests before acceptance, always. (Unchanged.)
2. ▶▶ **AMENDMENT #5.17 (Web Adaptation)**: v1.0 said "Offline means offline. No feature may require internet." v1.1 reframes for web: **The pure domain never requires network.** Only persistence (DB) and enhancement (AI, file upload) require it. Web MVP cannot deliver true offline; service worker caches reads; the future Electron port restores the original rule by swapping repository impls.
3. **AI proposes, engineer approves.** LLM output never writes to project data without visible human review. (Unchanged.)
4. **Domain core purity** — enforced by folder discipline (§4) + eslint layer rules + isomorphic compile test in CI. (Strengthened from v1.0.)
5. **Small steps**: one screen or feature at a time, verified and committed before the next. Git from day one, small commits. (Unchanged.)
6. ▶▶ **AMENDMENT #5.18 (Web Adaptation)**: v1.0 mentioned CodeGraph as dev-only. v1.1 drops CodeGraph (it is a desktop CLI tool that doesn't fit the web dev workflow). Replaced by: eslint layer-purity rules + zod↔Prisma round-trip tests + this Constitution. Dev tooling never ships with the product.
7. **Arabic parity is part of "done"**: every screen ships with RTL layout + translated strings. (Unchanged.)
8. **Data safety over features**: autosave, atomic writes, version history — never optional. (Unchanged in spirit; mechanism is DB transactions + version tokens — see §5.)
9. ▶▶ **AMENDMENT #5.19 (Web Adaptation)** (new): **Repository and provider interfaces are stable contracts.** Adding a new implementation (e.g., `OllamaProvider`) must not require changes to `src/domain/` or `src/services/` interfaces. This is what makes the codebase portable across platforms.

---

## 8. Conventions for AI Sessions

- TypeScript strict mode; named exports; one responsibility per file; kebab-case filenames. (Unchanged.)
- All user-visible strings via i18n keys (`en.json` / `ar.json`) — no literals in components. (Unchanged.)
- Money & quantities: decimal.js. Dates: ISO strings, day-granularity for schedule dates. (Unchanged.)
- Testing: vitest; golden tests mandatory for domain code. (Unchanged.)
- ▶▶ **AMENDMENT #5.20 (Web Adaptation)** (new): Next.js App Router conventions:
  - Server Components by default; `'use client'` only when hooks/interactivity needed.
  - API routes in `src/app/api/<resource>/route.ts` — one file per resource, HTTP method handlers.
  - Server actions for form mutations where appropriate.
  - TanStack Query for client-side server-state cache; Zustand for pure client UI state.
- Every AI session begins with this document plus the relevant module spec. (Unchanged.)

---

## 9. Development Tooling

> ▶▶ **AMENDMENT #5.21 (Web Adaptation)**: v1.0 specified CodeGraph (dev-only semantic code index). v1.1 drops CodeGraph (desktop CLI tool, not in web dev workflow). Replaced by:
> - `eslint.config.mjs` with `no-restricted-imports` rules mechanically enforcing §4 (layer purity).
> - A zod↔Prisma round-trip test per table (fixture → zod parse → Prisma create → Prisma findUnique → zod parse).
> - An isomorphic compile test: `src/domain/**/*.ts` must compile under three configs (Next.js server, Next.js client, Vitest) with no errors.

Git + GitHub, small frequent commits. `docs/` is first-class: this file, specs, decisions log. (Unchanged.)

---

## 10. Glossary

> ▶▶ **AMENDMENT #5.22 (Web Adaptation)**: Add to v1.0 glossary:
> - **API Route** — Next.js App Router server endpoint (`src/app/api/<resource>/route.ts`); web equivalent of Electron IPC handler.
> - **Server Component / Client Component** — Next.js App Router boundary; Server Components render on the server (no hooks), Client Components hydrate in the browser.
> - **Repository** — abstraction over persistence (e.g., `IProjectRepository`); concrete impls (`PrismaProjectRepository`, future `SqliteProjectRepository`) live in `src/infrastructure/`.
> - **Provider** — abstraction over an external service (e.g., `IAiProvider`); concrete impls (`ZaiAiProvider`, future `OllamaProvider`) live in `src/services/`.
> - **Optimistic Concurrency** — conflict detection via version token; PATCH fails if `version` changed since last read.
> - **Service Worker** — browser feature; used to cache read-only views for graceful degradation on flaky internet.

Original glossary (BoQ, WBS, Takeoff, Unit rate, BBS, IPC, Retention, Variation, RFI, Submittal, Transmittal, CPM, FS/SS/FF/SF, Lag, Total float, Data date, Baseline, S-curve) — unchanged.

---

## 11. Open Questions (TBD — owner decides)

- Final product name + pricing tiers/amounts
- Merchant of record (Paddle vs. Lemon Squeezy) vs. manual regional invoicing
- Pilot firm list + pilot agreement terms
- Item catalog sources & standards (Egyptian code? ACI? BS?) for EN/AR libraries — **Decision A** locks Egyptian practice; revisable on pilot feedback
- ▶▶ **AMENDMENT #5.23 (Web Adaptation)** (new):
  - Database choice for production: stay on SQLite (single-tenant dev) or migrate to Postgres (multi-tenant prod)? — Decision deferred to Phase 5 launch prep; Prisma makes the swap cheap.
  - Self-host vs. Vercel hosting for pilot? — Vercel for pilot speed; self-host possible for enterprise customers later.
  - When to start the Electron port? — Target: end of Phase 4, before commercial launch.

---

## 12. What v1.1 Does NOT Change (the spirit, preserved)

To remove any doubt, these are **untouched** from v1.0:

| Principle | Status |
|-----------|--------|
| Golden tests are law | ✅ Untouched |
| Pure domain core (zero platform imports) | ✅ Untouched (and strengthened by eslint + isomorphic test) |
| AI proposes, engineer approves | ✅ Untouched |
| Data is never hostage (portable export, no lock-in) | ✅ Untouched (mechanism changed: DB transactions + export-archive instead of file rename) |
| Bilingual EN/AR with RTL from day one | ✅ Untouched |
| decimal.js for money/quantities | ✅ Untouched |
| zod schemas as single source of truth | ✅ Untouched |
| vitest for golden tests | ✅ Untouched |
| Small commits, one feature at a time | ✅ Untouched |
| Pilot engineer re-derives GT values on paper before code accepted | ✅ Untouched |
| Repository pattern for persistence (always was implicit in "Services" layer; v1.1 makes it explicit) | ✅ Strengthened |
| Standards decision A: Egyptian practice for seeds/defaults | ✅ Untouched |
| Phase 1 = BoQ MVP scope | ✅ Untouched |
| Strategic differentiator: BoQ↔schedule↔cash-flow in one file/app | ✅ Untouched |

---

## 13. Approval & Next Steps

- ✅ v1.0 approved in turn 16 of GLM chat
- ✅ v1.1 (this document) adapts v1.0 for web MVP per user's Path C decision
- ⬜ v1.1 reviewed against `ADAPTATION_GUIDE.md` (cross-check §3 translation table matches §3 locked decisions)
- ⬜ v1.1 reviewed against `ERD_V1.1_WEB.md` (cross-check §5 save model matches Prisma schema)
- ⬜ Implementation begins when `IMPLEMENTATION_TODO_PHASE1.md` tasks are unblocked

**This document is the project's single source of truth. When it and reality disagree, fix one of them immediately — never let them drift.** (Unchanged from v1.0.)

---

**End of Constitution v1.1 (Web Adaptation).**

---

## AMENDMENT #6 (Web Adaptation) — Design Language: Linear

**Date**: 2026-08-20
**Source**: `DESIGN.md` (project root, copied from [VoltAgent/awesome-design-md](https://github.com/voltagent/awesome-design-md) → `linear.app/DESIGN.md`)

### 6.1 Design Language Selection
The product adopts **Linear's design language** as the primary visual system. Linear was selected because:
- Engineering/productivity SaaS aesthetic — matches TechOffice's user base (civil engineers)
- Excellent data-table density — required for the BoQ editor (5,000+ items target)
- Dark-mode-native (Constitution requires dark mode support)
- Single chromatic accent (lavender-blue `#5e6ad2`) — disciplined, not decorative
- Compatible with shadcn/ui "New York" style (both are clean/modern)

### 6.2 Design Tokens (binding)
The colors, typography, spacing, and component rules in `DESIGN.md` (project root) are **binding for all UI implementation**. Specifically:
- Primary accent: `#5e6ad2` (lavender-blue) — used for focus rings, primary CTAs, brand mark only
- Canvas: `#010102` (dark mode) / `#ffffff` (light mode)
- Surface 1-4: charcoal panels `#0f1011` → `#191a1b`
- Hairline borders: `#23252a` (dark) / `#ebebeb` (light)
- Typography: Linear Display (headlines) + Linear Text (body), fallbacks: SF Pro Display / Inter
- Negative letter-spacing on display type (measured, technical feel)

### 6.3 shadcn/ui Token Mapping
The shadcn/ui CSS variables in `src/app/globals.css` MUST be overridden to match Linear's tokens. Mapping:
| shadcn variable | Linear token | Hex |
|-----------------|--------------|-----|
| `--primary` | primary | `#5e6ad2` |
| `--primary-foreground` | on-primary | `#ffffff` |
| `--background` | canvas (dark) | `#010102` |
| `--foreground` | ink | `#f7f8f8` |
| `--card` | surface-1 | `#0f1011` |
| `--muted` | surface-2 | `#141516` |
| `--muted-foreground` | ink-subtle | `#8a8f98` |
| `--border` | hairline | `#23252a` |
| `--ring` | primary-focus | `#5e69d1` |

### 6.4 Anti-Patterns (forbidden)
- Indigo or pure blue as primary (Linear's lavender is allowed; Tailwind `indigo-*` and `blue-*` are NOT)
- Decorative use of the accent (linear rule: "appears on brand mark, focus rings, and a few intentional CTAs — never decoratively")
- Colored backgrounds on cards (cards are charcoal with hairline borders only)
- Drop shadows on flat surfaces (Linear uses hairlines, not elevation)
- Long-form marketing copy in product UI (Linear reads as "software-craft documentation: dense, technical")

### 6.5 RTL Considerations (Arabic)
Linear's design language is LTR-native. For Arabic RTL:
- Mirror layout direction (`dir="rtl"`)
- Keep the lavender accent on the same logical side (start, not left)
- Typography falls back to SF Pro Display (Linear Display has no Arabic glyphs) — acceptable per Constitution §i18n ("best-effort, not calligraphic-grade")
- Hairlines mirror correctly with `dir="rtl"` (CSS handles automatically)

### 6.6 Other Design Systems Available
74 additional DESIGN.md files are installed at `docs/design-systems/` as reference. If a future screen would benefit from a different aesthetic (e.g., Airtable's data density for the BoQ editor, Stripe's gradient for marketing pages), the implementing agent may consult those references — but the **binding design language remains Linear** unless amended.

