# PHASE 1 FUNCTIONAL SPEC — BoQ Module (Web Adaptation)

**Document**: `docs/planning/SPEC_PHASE1_BOQ_WEB.md`
**Product**: TechOffice (working title)
**Phase**: 1 · **Status**: Draft v1.1 (Web Adaptation)
**Governing document**: `CONSTITUTION_V1.1_WEB.md`. Conflicts → Constitution wins.
**Source**: Turn 18 of the imported GLM 5.2 conversation (`docs/imported/full-conversation.md`).

> **How to read this document**: Plain text reproduces the v1.0 desktop spec. **WEB ADAPTATION** notes (marked `▶▶`) describe what changes for the Next.js 16 web MVP. **Business rules (BR-x) and golden tests (GT-x) are calculation law — they are UNCHANGED** because calculations are platform-agnostic by design.

---

## 1. Scope

**In scope**: Project management, BoQ builder, unit-rate analysis, takeoff calculators, item library, deterministic Excel import, Excel/PDF export (EN/AR/RTL), app & project settings.

**Explicitly out of scope (Phase 1)**: payments/IPC, variations, planning/scheduling, document control, DXF/DWG, AI features, multi-user, cloud sync, custom print templates, BBS shape graphics (shape codes as text only).

▶▶ **WEB ADAPTATION — Out-of-scope additions for v1.1**:
- True offline mode (web cannot; restored in Electron port)
- `.toproj` single-file save (web uses DB; export-archive is Phase 5)
- Local Ollama AI (web uses `ZaiAiProvider`)
- DWG native editing (DXF viewer is Phase 3)

---

## 2. Feature Inventory

| ID | FEATURE | SCREENS |
|----|---------|---------|
| F1 | App shell & navigation, language toggle, project switcher | S1 |
| F2 | Project management (create/open/rename/delete, recent projects) | S2 |
| F3 | BoQ builder: multiple BoQ documents → sections → items | S3, S4 |
| F4 | Rate analysis (build-up per item) | S5 |
| F5 | Takeoff calculators (concrete, formwork, rebar/BBS, masonry, plaster, paint) | S6 |
| F6 | Item library (app-level catalog, EN/AR) | S7 |
| F7 | Excel BoQ import (deterministic, wizard) | S8 |
| F8 | Export center (Excel/PDF, layouts & languages) | S9 |
| F9 | Settings: app, project, company profile | S10 |

---

## 3. User Stories & Acceptance Criteria

### F2 — Projects

**US**: As an engineer, I create a project with name, client, location, contract no., currency — so all documents inherit them.

▶▶ **WEB ADAPTATION — AC rewrite**:
- v1.0: "Creating a project creates its `.toproj` file immediately in the user-chosen folder."
- v1.1: **Creating a project creates a `Project` row in the DB immediately** (server-side transaction: `Project` + seeded `Unit`/`RebarDiameter`/`ShapeCode` snapshots copied in; default `BoQDocument` created). The user's project list updates optimistically.
- Opening a project loads its dashboard via `GET /api/projects/[id]` with live totals computed in the domain layer from cached child rows.
- Deleting a project = soft-delete (`deletedAt` timestamp) with a confirmation modal; restoration possible for 30 days via `UserSettings` "trash" view (Phase 5 nicety; Phase 1 just hides deleted).
- Renaming a project = `PATCH /api/projects/[id]` with optimistic concurrency check.

### F3 — BoQ Builder (the core)

**US**: I build a BoQ as documents → sections → items, with bilingual descriptions, and totals compute live.
**US**: I reorder sections and items by drag, and renumber with one click.

**AC**: Amounts/section totals/grand totals follow BR-2..BR-4 exactly. Editing any qty/rate updates all totals without manual refresh. A BoQ with 5,000 items scrolls and recalculates without visible lag (< 300 ms recompute, client-side via pure domain function on cached items).

▶▶ **WEB ADAPTATION — AC additions**:
- Items are fetched via TanStack Query (`useQuery(['boq', documentId], ...)`); mutations via `useMutation` with optimistic update + rollback on error.
- Drag-reorder via `@dnd-kit/sortable`; on drop, `PATCH /api/boq-items/reorder` with the new sort_order array.
- Inline editing: `PATCH /api/boq-items/[id]` with `{ qty?, rate?, descriptionEn?, descriptionAr? }`; debounce 2 s.
- Item types supported: rate-based, lump sum (qty locked = 1), provisional sum, daywork (rate-only, excluded from rate analysis), unit-only (no qty — for future/pricing lists).

### F4 — Rate Analysis

**US**: I build up a unit rate from materials, labor, equipment, subcontract — with waste factors, overhead, and profit — and apply it to the BoQ item's rate.

**AC**: Rate computation follows BR-8..BR-10. Each analysis is saved with the item (re-openable, editable, with `last_applied_rate` shown). Applying a rate updates the item and is undoable (PATCH item's rate; restore previous via "undo" toast within 5 s).

▶▶ **WEB ADAPTATION**: RateAnalysis is a `RateAnalysis` row + child `RateAnalysisLine` rows; persisted server-side. "Apply to item" = `POST /api/rate-analyses/[id]/apply` which sets `boq_item.rate` in the same transaction.

### F5 — Calculators

**US**: I compute a quantity in a calculator (e.g., concrete volume for 20 columns) and apply it to a BoQ item, keeping the calculation record for audit.

**AC**: Each calculator implements the formulas in §6. Applied quantities land on the chosen item; the calculation record (inputs + result + target item) is stored in `CalculationRecord` table and viewable later. Deleting the item orphans the record (link nulled), per spec F5.

▶▶ **WEB ADAPTATION**: `CalculationRecord` rows persisted server-side with JSON `inputs` field (zod-validated per calculator type). "Apply to BoQ item" = PATCH item's `qty` + POST `CalculationRecord` with `linkedBoqItemId` in one transaction.

### F6 — Item Library

**US**: I browse/search a catalog of common items (EN+AR descriptions, unit, default specs) and insert one into any BoQ; I can save any project item back to the library.

**AC**: Library ships seeded with a starter set (~150 items: concrete by grade, formwork, rebar by dia, masonry, plaster, paint, tiles) with blank rates. Library lives in the DB (`ItemLibrary` table, scoped to user or global seed). Search matches EN and AR text via `ILIKE` on both columns.

▶▶ **WEB ADAPTATION**: `ItemLibrary` rows are either `source: 'seed'` (global, shared) or `source: 'user'` (per-user). Search = `GET /api/library?search=concrete&category=Concrete` returning paginated results. "Save current item to library" = `POST /api/library` with item fields.

### F7 — Excel Import

**US**: I import a client's Excel BoQ by mapping columns, reviewing validation, and importing — no AI involved.

**AC**: Wizard steps: file upload → server parses sheets → column mapping (code, description EN, description AR, unit, qty, rate) → unit alias resolution (§7.4) → validation report (row-by-row errors, editable/skippable) → import. Section header rows are detected (a row with no qty/unit but text in description = candidate section; user confirms) or mapped via an optional section column. Import creates a new BoQ document inside the current project. Import is all-or-nothing per row group the user approves.

▶▶ **WEB ADAPTATION — AC rewrite**:
- v1.0: "Wizard steps: file → sheet → column mapping → ..."
- v1.1: **Wizard steps**:
  1. **Upload**: `POST /api/imports/upload` with multipart file (≤ 10 MB, `.xlsx`/`.xls`); returns `uploadId` + parsed sheets. File stored in `FileUpload` table (blob + sha256 + original filename).
  2. **Sheet selection**: `GET /api/imports/[uploadId]/sheets` → user picks sheet → server returns first 20 rows + detected headers.
  3. **Column mapping**: user maps columns to the 6 known fields; `POST /api/imports/[uploadId]/mapping` validates mapping.
  4. **Unit alias resolution**: server resolves `unit` column values to canonical unit IDs via `UnitAlias` table.
  5. **Validation report**: `GET /api/imports/[uploadId]/validation` returns row-by-row errors (red) + warnings (amber); user can inline-fix or skip rows.
  6. **Import**: `POST /api/imports/[uploadId]/commit` creates `BoQDocument` + `BoQSection` + `BoQItem` rows + `ImportBatch` provenance row, all in one Prisma `$transaction`. Atomic per row group the user approved.

### F8 — Export

**US**: I export the BoQ as a polished Excel or PDF — single language (EN or AR) or bilingual — with my company branding.

**AC**: Outputs match §8 layouts. Arabic exports render correctly (RTL sheets in Excel; proper shaping in PDF via server-side Puppeteer/Chromium). Exports include cover, summary page, and per-section pages with running page numbers.

▶▶ **WEB ADAPTATION — AC rewrite**:
- v1.0: implied "save to disk via Electron dialog".
- v1.1: **Export = HTTP response with `Content-Disposition: attachment; filename="..."`**. Two endpoints:
  - `POST /api/exports/excel` — ExcelJS server-side → returns `.xlsx` blob.
  - `POST /api/exports/pdf` — server renders HTML via React render-to-string → Puppeteer prints to PDF → returns `.pdf` blob.
- Quick preview: dedicated route `/projects/[id]/print?format=pdf&lang=bilingual` opens a print-optimized Server Component; user can `Cmd/Ctrl+P` for native browser print.

### F9 — Settings

**US**: I configure app, project, and company settings once and they apply everywhere.

**AC**: Tabs: App (language, theme light/dark, autosave interval), Project (currency, VAT enabled + %, qty precision defaults per unit per BR-6, item numbering pattern, OH% and profit% defaults, rounding mode), Company (name EN/AR, logo, address, phone — used in exports).

▶▶ **WEB ADAPTATION**:
- App settings stored in `UserSettings` table (per-user, one row per user).
- Project settings are columns on the `Project` table.
- Company profile stored in `CompanyProfile` table (per-user; one profile per user, used in their exports).
- Changing VAT % on a project re-computes document totals client-side (pure domain function) and is persisted via `PATCH /api/projects/[id]` with new `vat_percent`.
- Logo upload = `POST /api/file-uploads` (image, ≤ 2 MB) → `FileUpload` row referenced from `CompanyProfile.logo_file_id`.

---

## 4. Screen Specifications

### S1 — App Shell
Left nav (icons+labels): Dashboard, BoQ, Calculators, Library, Import, Export, Settings. Project name + currency badge top bar. Language toggle (EN/عربي) — instant switch, remembered per user (`UserSettings.locale`). Nav mirrors in RTL (Tailwind `dir="rtl"` + `rtl:` variants).

▶▶ **WEB ADAPTATION**: Implemented as Next.js App Router layout (`src/app/(app)/layout.tsx`) with nested routes; sidebar is a Server Component reading user's locale from session; language toggle is a Client Component that updates `UserSettings.locale` and reloads via `router.refresh()`.

### S2 — Dashboard
Cards: BoQ grand total (project currency), per-document totals, item count, last modified. Quick actions: New BoQ, Import Excel, Open Calculator. Recent projects list (from DB, scoped to current user).

▶▶ **WEB ADAPTATION**: Server Component fetches via `IProjectRepository.list(userId)` + `IBoQRepository.totals(projectId)`; cards rendered server-side with no client JS for initial paint.

### S3 — BoQ Editor
Master–detail. Left: document selector + section tree (drag-reorder via `@dnd-kit`, add/rename/delete section, section totals inline). Right: items table — columns: # | Code | Description (EN & AR stacked or side-by-side per language mode) | Unit | Qty | Rate | Amount | Type badge. Inline editing in the table (qty, rate, descriptions); full editor (S4) opens from row. Toolbar: add item, insert from library, renumber, move item between sections, filters (by type, by "has analysis"). Sticky section subtotal rows; grand total bar pinned bottom. Keyboard: Enter commits cell & moves down, Tab across — engineers live in this grid.

▶▶ **WEB ADAPTATION**: Items table via `@tanstack/react-table` + `@tanstack/react-virtual` (virtualization for 5k-item perf). Inline edits via `react-hook-form` per row + debounced PATCH. Section tree via `@dnd-kit/sortable`.

### S4 — Item Editor (Drawer)
Fields: code (auto, editable), type (rate/LS/PS/daywork/unit-only), unit (picker from unit registry), descriptions EN + AR (both required to mark item "complete"; warning-only if missing), qty, rate. Button: "Rate analysis →" (opens S5 bound to this item).

▶▶ **WEB ADAPTATION**: shadcn/ui `Sheet` component (right-side drawer); form via `react-hook-form` + zod resolver; submit = PATCH /api/boq-items/[id].

### S5 — Rate Analysis Builder
Output unit shown. Four component groups (Materials / Labor / Equipment / Subcontract), each a rows-table: name (free text or library pick), unit, consumption per output unit, unit cost, waste % (materials only), line total. Labor alternative entry: crew cost/day + crew output units/day → derived cost/unit (one field pair, auto-computed — both entry modes accepted). Below: Direct cost (computed) → Overhead % (default from project settings) → Subtotal → Profit % → Final rate (BR-10) with "Apply to item" button. Live recompute on any change.

▶▶ **WEB ADAPTATION**: Pure domain function `computeRate(input)` runs client-side on every keystroke (sub-ms for typical inputs); displayed result is from pure domain, never recomputed in UI logic. Persisted via PATCH /api/rate-analyses/[id].

### S6 — Calculators Hub
Grid of calculator cards → opens a calculator page: input form (with "add row" for repetitive elements — e.g., 12 columns of same size), live result panel, buttons: Save record, Apply to BoQ item (item picker or create-new), Copy result. Saved calculations list (name, type, date, result, linked item).

Concrete: element types (footing/pile cap/column/wall/beam/slab/stair) with geometric inputs; result m³. Deduct openings option for slabs/walls.
Formwork: same elements; contact-area formulas; result m². Options: deduct intersections/matrix per standard toggles (defaults per Egyptian practice per Decision A; each toggle states its assumption in a hint).
Rebar/BBS: bar schedule rows — member, bar mark, dia (picker), shape code (text code from BS 8666 subset), no. of bars, cutting length (or computed from member dims + hooks/laps inputs), → unit weight (from seeded weight table) → total kg → Σ kg and Σ ton. Export BBS.
Masonry: wall area (L×H) − openings (rows) × net volume per wall type; result m³ or m² per unit choice.
Plaster: area − openings (rule: openings deduction configurable, default deduct > 1.0 m², add jambs/soffits toggle — both spec-dependent, hence configurable), faces count (1/2), result m².
Paint: similar area logic incl. minor-opening no-deduction default; result m² per coat × coats.

▶▶ **WEB ADAPTATION**: Each calculator is a Client Component form; calculation runs `concreteVolume(rows)` (pure domain) on every input change; "Save record" = POST /api/calculation-records; "Apply to BoQ item" = PATCH /api/boq-items/[id].qty + POST /api/calculation-records in one server transaction.

### S7 — Library Browser
Search box (EN/AR), category tree (matches section taxonomy), table: description EN | AR | unit | spec notes. Actions: insert into open BoQ (section picker), edit, duplicate, delete. "Save current item to library" from S4.

▶▶ **WEB ADAPTATION**: `GET /api/library?search=...&category=...` paginated; "insert into BoQ" = POST /api/boq-items with sectionId + libraryItemId (for provenance source_library_id).

### S8 — Import Wizard
Stepper (upload → mapping → validation → done) per F7 AC. Validation table: row #, errors (red) / warnings (amber), inline fix editors, skip-row checkbox.

▶▶ **WEB ADAPTATION**: Multi-step form with state in TanStack Query cache (so user can navigate between steps without losing progress); final commit sends only the validated mapping + skip list.

### S9 — Export Center
Pick: document(s), scope (full BoQ / summary only / selected sections), format (xlsx / pdf), language (EN / AR / bilingual), include rate analyses (Excel only), include BBS sheets. Preview pane (rendered HTML). Company profile shown as it will appear.

▶▶ **WEB ADAPTATION**: Preview pane = Server Component rendering the same HTML the export will use (no Puppeteer round-trip for preview); "Download" button triggers `POST /api/exports/{excel|pdf}` and saves via browser.

### S10 — Settings
Tabs: App (language, theme light/dark, autosave interval), Project (currency, VAT enabled + %, qty precision defaults per unit per BR-6, item numbering pattern, OH% and profit% defaults, rounding mode), Company (name EN/AR, logo, address, phone — used in exports).

▶▶ **WEB ADAPTATION**: Three-tab form (shadcn/ui `Tabs`); each tab a separate Server Component reading from `UserSettings` / `Project` / `CompanyProfile`; mutations via PATCH endpoints. Theme toggle uses `next-themes` (already installed). Logo upload via file input + POST /api/file-uploads.

---

## 5. Business Rules (calculation law)

**These are UNCHANGED from v1.0. They are platform-agnostic by definition.**

| ID | RULE |
|----|------|
| BR-1 | All money/qty math uses decimal.js. Floats never touch money. |
| BR-2 | Item amount = round(qty × rate, 2). |
| BR-3 | Section subtotal = Σ of rounded item amounts. Document total = Σ section subtotals. Project grand total = Σ document totals. (Round at item; sum rounded — standard practice.) |
| BR-4 | VAT (if enabled): shown as separate line on document total: VAT = round(subtotal × vat%, 2); Total incl. VAT = subtotal + VAT. |
| BR-5 | LS items: qty fixed at 1; amount = rate. PS & daywork excluded from analysis features; PS included in totals, flagged. |
| BR-6 | Display precision defaults (configurable in project settings): m³/m²/m → 2dp; kg → 2dp; ton → 3dp; no. → 0dp; LS → qty 0dp. |
| BR-7 | Numbering: sections 1..n, items S.n (e.g., 3.12); renumber rewrites codes in order; custom codes preserved until renumber. |
| BR-8 | Material line cost = consumption × (1 + waste%) × unit cost. |
| BR-9 | Direct cost = Σ materials (incl. waste) + Σ labor + Σ equipment + Σ subcontract, per output unit. |
| BR-10 | Rate = round((Direct × (1+OH%)) × (1+Profit%), 2). Order is fixed in Phase 1 (OH then profit compounding); order configurability deferred. |
| BR-11 | Rebar unit weights from seeded table (Ø8→0.395, Ø10→0.617, Ø12→0.888, Ø16→1.578, Ø20→2.466, Ø25→3.854, Ø32→6.313 kg/m; table extensible). |
| BR-12 | Rebar weight = Σ(cutting length × count × unit weight), kg; tonnage = kg/1000 displayed per BR-6. |
| BR-13 | Quantity edits via calculator application write qty + store record (never overwrite silently: applying to an item with existing qty prompts confirm/replace). |

### 5.1 Web-Specific Business Rules (new in v1.1)

| ID | RULE |
|----|------|
| BR-WEB-1 | **Project create is a server-side transaction.** Creating a Project row also creates: seeded `Unit` snapshot rows, `RebarDiameter` snapshot rows, `ShapeCode` snapshot rows, a default `BoQDocument`, and an `AuditLog` entry. All succeed or all fail (Prisma `$transaction`). |
| BR-WEB-2 | **Excel import file size limit: 10 MB.** Larger files are rejected at upload with a 413 response and a user-facing message. |
| BR-WEB-3 | **Excel import allowed file types: `.xlsx`, `.xls`.** Other types rejected at upload. |
| BR-WEB-4 | **Optimistic concurrency on all PATCH endpoints.** Every updatable aggregate (`Project`, `BoQDocument`, `BoQSection`, `BoQItem`, `RateAnalysis`, `ItemLibrary`, `CompanyProfile`, `UserSettings`) carries a `version: Int` column. PATCH must include `expectedVersion`; the WHERE clause is `{ id, version: expectedVersion }`. If 0 rows updated → 409 Conflict response; client shows "another tab edited this; reload or fork" modal. |
| BR-WEB-5 | **All mutations require an authenticated session.** API routes check `getServerSession()`; unauthenticated → 401. Data is scoped to `userId` from session; cross-user access → 404 (don't leak existence). |
| BR-WEB-6 | **Autosave debounce: 2 seconds.** Inline edits (qty, rate, descriptions) debounce 2 s before PATCH; rapid edits coalesce into one PATCH with the final value. |
| BR-WEB-7 | **Soft delete only.** No hard deletes in Phase 1. Deleted aggregates have `deletedAt: DateTime`; queries filter `WHERE deletedAt IS NULL`. Restoration possible via `PATCH /api/<resource>/[id]/restore` (Phase 5 admin feature). |
| BR-WEB-8 | **Audit log on all writes.** Every POST/PATCH/DELETE writes an `AuditLog` row with `userId`, `action`, `entityType`, `entityId`, `before JSON`, `after JSON`, `timestamp`. |
| BR-WEB-9 | **File uploads validated by MIME + sha256.** `FileUpload` rows store `mimeType` (validated against allowlist), `sha256` (computed server-side), `sizeBytes` (checked against limit per type), `originalFilename` (sanitized). |
| BR-WEB-10 | **API rate limiting: 60 req/min per user.** Standard protection against runaway clients; 429 on exceed. |
| BR-WEB-11 | **Server-side input validation via zod.** Every API route's request body is parsed through the relevant zod schema from `src/shared/schemas/`. Invalid → 400 with structured error list. |
| BR-WEB-12 | **Pure domain functions never touch the request/response cycle.** They take typed inputs, return typed outputs. The API route layer translates HTTP ↔ domain types. |

---

## 6. Golden Test Cases (authoritative — tests must reproduce these exactly)

**These are UNCHANGED from v1.0. They are the calculation law, and calculations are platform-agnostic.**

| ID | CASE | EXPECTED |
|-----|------|----------|
| GT-1 | BoQ: 2 sections; items (qty 12.5 × rate 85.40) and (qty 3 × rate 1,250.00) in S1; (qty 40 × rate 964.31) in S2; VAT 14% | Amounts: 1,067.50 · 3,750.00 · 38,572.40 → subtotal 43,389.90 → VAT 6,074.59 → total 49,464.49 |
| GT-2 | Rate analysis (per 1 m³): materials Σ 602.30 (cement 0.35 t @1,000 · sand 0.45 m³ @150 · agg 0.85 m³ @180 · water @10 = 1.80 · admix 30.00); labor crew 4,000/day ÷ 40 m³/day = 100.00; equipment 60.00; OH 10%, profit 15% | Direct 762.30 → +OH 838.53 → rate = 964.31 |
| GT-3 | Concrete: column 0.30×0.30×3.00 m, ×12 nos | 0.27 m³ each → 3.24 m³ |
| GT-4 | Formwork: same columns, 4 faces × 0.30 × 3.00 | 3.60 m² each → 43.20 m² |
| GT-5 | Rebar: Ø12, cutting length 11.25 m, 85 bars | 0.888 × 11.25 × 85 = 849.15 kg = 0.849 ton |
| GT-6 | Masonry: wall 6.00×3.00 m, two 1.2×1.5 m openings, 0.25 m thick | (18 − 3.60) × 0.25 = 3.60 m³ |
| GT-7 | Plaster: wall 20×3 m, one 2×1.5 m door, both faces, deduct openings >1 m², no jambs | (60−3)×2 = 114.00 m² |
| GT-8 | (Added in WO-3 of v1.0) Paint: GT-7's wall, 2 coats | 228.00 m² |

> **Ritual (unchanged)**: GT values were hand-computed for this spec. Before implementation, the pilot engineer re-verifies each on paper — that's the QA sign-off ritual for this spec.

---

## 7. Data & i18n Requirements

- Bilingual descriptions are two fields (`descriptionEn`, `descriptionAr`) everywhere — items, sections, library, company profile. Never one concatenated field.
- Unit registry (shared/domain, seeded): m³, m², m, kg, ton, no., LS, hr, day — each with EN abbreviation, AR abbreviation, default precision. Units are referenced by ID everywhere.
- Unit alias table for import: `m3, m³, M3, م3, م٣ → m³`; `Ton, طن → ton`; `No, EA, عدد → no.`; etc. Extensible in settings.
- RTL: full layout mirroring in Arabic mode; numbers remain Western digits (standard in technical docs — configurable later, not Phase 1).
- Every user-visible string via i18n keys; no literals (Constitution §8).

▶▶ **WEB ADAPTATION — i18n implementation**:
- Use `next-intl` (already installed in `package.json`) for App Router integration — handles server-side rendering of locale strings.
- Strings stored in `src/shared/i18n/en.json` and `src/shared/i18n/ar.json` (same structure as v1.0 plan).
- Locale detection: session-based (`UserSettings.locale`); URL-based (`/[locale]/...`) deferred to Phase 5 for SEO.
- `react-i18next` may also be installed if a future React Native port needs it — for v1.1 web MVP, `next-intl` is sufficient and idiomatic.

▶▶ **WEB ADAPTATION — Data model reference**: The detailed schema is in `ERD_V1.1_WEB.md`. Phase 1 entities:
- `User`, `Session`, `UserSettings`, `CompanyProfile` (app-level, per-user)
- `Project`, `BoQDocument`, `BoQSection`, `BoQItem` (BoQ core)
- `RateAnalysis`, `RateAnalysisLine` (rate build-up)
- `CalculationRecord` (F5 audit trail)
- `ImportBatch` (F7 provenance)
- `ItemLibrary`, `LibraryCategory` (F6 catalog)
- `Unit`, `UnitAlias`, `RebarDiameter`, `ShapeCode` (reference tables, seeded snapshots per project)
- `FileUpload` (attachments — logos, future drawing files)
- `AuditLog` (every mutation)
- `ProjectSnapshot` (version history)

---

## 8. Export Layouts (contract for the export engine)

> **Unchanged from v1.0.** The layout contract is platform-agnostic; only the rendering runtime differs (server-side ExcelJS/Puppeteer instead of in-process).

**BoQ — Excel (xlsx)**: Sheet 1 cover (logo, company EN/AR, project data, currency, date, doc title). Sheet 2 summary (section code, description EN/AR, amount; document total; VAT lines per BR-4). Sheets 3+ per section: columns # | Code | Description | Unit | Qty | Unit Rate | Amount; bilingual mode stacks EN+AR in the description cell; subtotal row at section end; footer grand total. Arabic/bilingual sheets: `rightToLeft: true`. Styling: professional minimal (borders, bold totals, alternating row fill) — no theme dependencies.

**BoQ — PDF**: same structure, HTML template → server-side Puppeteer → Chromium print; cover + summary + sections; running page numbers "Page X of Y"; EN-only, AR-only (RTL), or bilingual variants.

**Rate analysis — Excel**: per-item sheet replicating S5 math with final rate highlighted.

**BBS — Excel**: columns: Member | Bar Mark | Dia (mm) | Shape Code | No. Bars | Length (m) | Total Length (m) | Unit Wt (kg/m) | Total Wt (kg); footer Σkg + tons.

---

## 9. Non-Functional Requirements (Phase 1, Web Adaptation)

| NFR | v1.0 (desktop) | v1.1 (web) |
|-----|-----------------|------------|
| 5,000-item grid perf | 60fps scroll, < 300 ms recompute, file save < 1 s | 60fps virtualized scroll (TanStack Virtual), < 300 ms **client-side** recompute (pure domain on cached rows), PATCH roundtrip < 500 ms |
| Cold start | App cold start < 3 s; project open < 2 s | First Contentful Paint < 2 s on fast connection; project dashboard Time-to-Interactive < 3 s |
| Autosave + atomic + version | Active from first alpha | DB transactions + 2 s debounce + `version` optimistic concurrency + `ProjectSnapshot` rows — active from first alpha |
| Crash-free data | Killing app mid-edit loses at most debounce window | Closing tab mid-edit loses at most debounce window (2 s); in-flight PATCH may complete server-side even after tab close |
| Installers on clean OS | Windows 10/11 + Ubuntu 22.04+ | N/A — web app, runs in any modern browser (Chrome 100+, Firefox 100+, Safari 15+, Edge 100+) |
| ▶▶ NEW: Browser support | N/A | Latest Chrome, Firefox, Safari, Edge; mobile responsive but not mobile-optimized (mobile = Phase 5 RN port) |
| ▶▶ NEW: Accessibility | Implicit | WCAG 2.1 AA for keyboard nav; shadcn/ui components are accessible by default; ARIA labels via i18n keys |
| ▶▶ NEW: SEO | N/A | Auth-gated app — minimal SEO needed; landing page (Phase 5) is the only public-facing surface |

---

## 10. Phase 1 Exit Criteria (Web Adaptation)

| # | v1.0 criterion | v1.1 criterion |
|---|----------------|----------------|
| 1 | All GT-1..7 pass in CI | **Unchanged**: all GT-1..7 pass in CI (vitest, pure domain tests) |
| 2 | A real client Excel BoQ imports, totals match their Excel to the cent | **Unchanged**: pilot firm's Excel BoQ imports via F7 wizard, totals match their Excel to the cent |
| 3 | Pilot engineer builds full small-project BoQ (≥300 items, ≥1 rate analysis per major trade, ≥3 calculator applications) start-to-finish | **Unchanged**: same scope, via web UI in browser |
| 4 | Exports (EN, AR, bilingual; xlsx + PDF) opened and approved by one pilot office | **Unchanged**: same exports, downloaded via browser |
| 5 | No known data-loss scenario in manual QA (kill, close, conflict, disk full) | Adapted: **kill = close browser tab; conflict = open same project in 2 tabs (optimistic concurrency returns 409); disk full = N/A server-side; server crash = DB transaction rollback** |
| 6 | ▶▶ NEW: Browser compatibility matrix | Manual QA on Chrome, Firefox, Safari, Edge — all golden paths work |
| 7 | ▶▶ NEW: Performance budget met | Lighthouse Performance ≥ 80 on dashboard; LCP < 2.5 s; TTI < 3 s |

---

## 11. Open Items Affecting Phase 1 Build (need your input, not blocking)

- Standards for the seed library & calculator defaults — **Decision A locks Egyptian practice; BS 8666 shape code subset; revisable on pilot feedback** (Constitution Amendment #1, carried over).
- Pilot firms' actual Excel BoQ samples — collect 2–3 real files now; they become import test fixtures for F7. ▶▶ **WEB ADAPTATION**: synthetic fixtures will be built by WO-W-13 if pilot files aren't yet available.

---

**End of Phase 1 Functional Spec v1.1 (Web Adaptation).**
