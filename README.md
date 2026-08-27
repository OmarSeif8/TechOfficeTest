# TechOffice — Engineering Technical Office

A bilingual (EN/AR) project management web application for civil engineers, built with Next.js 16, TypeScript, Prisma, and the Linear design language.

## What This Is

TechOffice is a technical office management tool that consolidates the day-to-day workflows of civil engineers into a single web application:

- **Bill of Quantities (BoQ)** — Build BoQ documents with sections, items, rate analysis, and live totals
- **Scheduling** — CPM engine with critical path, float, Gantt chart, WBS, calendar
- **Document Control** — Drawing register, submittals log, RFIs, correspondence, transmittal builder
- **Drawing Viewer** — DXF file parsing with SVG rendering, zoom/pan, measurement tools

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Database | Prisma ORM + SQLite |
| Auth | NextAuth.js v4 (credentials provider) |
| State | TanStack Query (server) + Zustand (client) |
| i18n | next-intl (EN/AR with RTL) |
| AI | z-ai-web-dev-sdk (LLM, vision, TTS, ASR) |
| Design | Linear design language (dark mode, lavender accent) |

## Architecture

The codebase follows a **5-layer platform-agnostic architecture**:

```
src/
├── domain/          Pure calculation logic (zero platform imports — isomorphic)
│   ├── boq/         BoQ totals, rate analysis, calculators
│   ├── scheduling/  CPM engine, calendar, cycle detection
│   ├── doccontrol/  Numbering, overdue, status workflows, transmittal
│   └── drawing/     DXF parser, transforms, measurement, layers
├── shared/          Zod schemas + entity types + i18n strings
├── services/        Interfaces (IAiProvider, IAuthProvider) + implementations
├── infrastructure/  Prisma repository implementations + DI registry
└── app/             Next.js App Router (API routes + pages)
```

**Layer purity is mechanically enforced** by eslint `no-restricted-imports` rules + an isomorphic compile test (`bun run test:domain`). The domain layer compiles without Next.js, React, Prisma, or Node.js — making it portable to Electron, Tauri, or React Native.

## Quick Start

```bash
# Install dependencies
bun install

# Set up the database
bun run db:push
bun run db:seed

# Start the dev server
bun run dev
# → http://localhost:3000

# Run quality gates
bun run lint
bun run typecheck
bun run test
```

### Environment Variables

Create a `.env` file:

```env
DATABASE_URL=file:./db/custom.db
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
DEMO_MODE=true   # Set to false to require real authentication
```

## Modules

### Phase 1 — BoQ Module ✅

| Screen | View | Description |
|--------|------|-------------|
| S1 | App Shell | Sidebar + topbar + footer (Linear dark theme) |
| S2 | Dashboard | Project list with live totals |
| S3/S4 | BoQ Editor | Document tree, inline editing, live totals |
| S5 | Rate Analysis | Build-up rates (BR-8..10) |
| S6 | Calculators | 6 takeoff calculators (concrete, formwork, rebar, masonry, plaster, paint) |
| S7 | Library | 23 seeded items with bilingual EN/AR search |
| S8 | Import | 4-step Excel import wizard |
| S9 | Export | Excel + PDF export (EN/AR/RTL) |
| S10 | Settings | User + company profile |

**Golden tests**: GT-1..GT-8 (61 assertions)

### Phase 2 — Scheduling Module ✅

| Screen | View | Description |
|--------|------|-------------|
| S11 | Scheduling | Run CPM engine, view critical path |
| S12 | WBS | Work breakdown structure tree |
| S13 | Activities | Activity list with relationships (FS/SS/FF/SF) |
| S14 | Calendar | Weekday mask + exception editor |
| S15 | Gantt | SVG Gantt chart with critical path highlighting |

**Golden tests**: GT-P1..GT-P6 (51 assertions)

### Phase 3 — Document Control + Drawing Viewer ✅

| Screen | View | Description |
|--------|------|-------------|
| S17 | Drawings | Drawing register with revision history |
| S18 | Submittals | Submittal log with status workflow + overdue tracking |
| S19 | RFIs | RFI log with Q&A + answer flow |
| S20 | Correspondence | Correspondence + transmittal builder |
| S21 | Documents Dashboard | Widget cards (overdue counts, open items) |
| S22 | DXF Viewer | SVG rendering with zoom/pan, layers, measurement |

**Golden tests**: GT-DC1..GT-DC6 (37 assertions) + GT-DXF-1..GT-DXF-5 (59 assertions)

## Testing

```bash
# Run all tests (excluding performance tests)
bun run test

# Run only golden tests (the law)
bun run test:golden

# Run performance test (5,000-item BoQ)
PERF_TEST=true bun run test tests/perf/boq-5k.test.ts

# Verify domain layer purity (isomorphic compile)
bun run test:domain
```

### Test Statistics

| Category | Count |
|----------|-------|
| Golden tests | 208 assertions (GT-1..8, GT-P1..6, GT-DC1..6, GT-DXF-1..5) |
| Unit tests | ~80 (AI provider, auth, registry, calendar, engine edge cases) |
| Integration tests | ~80 (repositories: project, BoQ, library, calculation, rate analysis, scheduling, doc control) |
| Performance tests | 4 (5k-item BoQ: compute < 300ms — actual: 20ms) |
| E2E concurrency | 5 (optimistic concurrency: concurrent edits → 1 succeeds) |
| **Total** | **460 tests** |

## Design Language

The app uses **Linear's design language** (per `DESIGN.md`):

- **Dark canvas**: `#010102` (near-black)
- **Surface**: `#0f1011` (charcoal panels)
- **Primary accent**: `#5e6ad2` (lavender — brand mark, CTAs, focus rings only)
- **Hairline borders**: `#23252a`
- **Typography**: Inter (body) + JetBrains Mono (code/numbers)
- **No decorative color usage** — the accent appears only on brand mark, primary CTAs, and focus rings

## Project Structure

```
TechOffice/
├── src/
│   ├── app/                    Next.js App Router (API routes + page)
│   │   ├── api/                55 API route files
│   │   ├── layout.tsx         Root layout (providers, fonts, i18n)
│   │   └── page.tsx           Single / route (SPA view switching)
│   ├── components/             React components
│   │   ├── ui/                 shadcn/ui (50+ components)
│   │   ├── views/              20 view components (SPA views)
│   │   ├── app-shell.tsx       Layout shell (sidebar + topbar + footer)
│   │   └── view-router.tsx    Client-side view switcher
│   ├── domain/                 Pure domain logic (isomorphic)
│   ├── shared/                 Zod schemas + entity types + i18n
│   ├── services/               Service interfaces + impls (AI, auth)
│   ├── infrastructure/         Prisma repositories + DI registry
│   └── lib/                    Helpers (db, auth, api-helpers, queries)
├── prisma/
│   ├── schema.prisma           ~60 models (Phase 1-3 + reserved Phase 4-5)
│   └── seed.ts                 Seed data (units, rebar, shape codes, library)
├── tests/
│   ├── golden/                 14 golden test files (the law)
│   ├── unit/                   6 unit test files
│   ├── integration/            6 integration test files
│   ├── perf/                   1 performance test (5k items)
│   └── e2e/                    1 concurrency test
├── docs/
│   ├── planning/               7 planning documents
│   ├── decisions/              1 exit validation doc
│   ├── imported/               Imported GLM conversation (4 files)
│   └── design-systems/         74 DESIGN.md references
├── DESIGN.md                   Linear design system
├── MODIFICATION_LOG.md         Log of code modifications
├── worklog.md                  Full development worklog (29 task records)
└── ecosystem.config.cjs        PM2 process manager config
```

## Key Principles

1. **Golden tests are law** — hand-computed values that the code must reproduce exactly. If the code disagrees with a golden test, the code is wrong.
2. **Pure domain core** — `src/domain/` has zero platform imports. Same code runs in tests, Next.js server, and (future) Electron/Tauri.
3. **AI proposes, engineer approves** — the `IAiProvider` interface returns proposals (never applies effects).
4. **Bilingual EN/AR with RTL** — 146 i18n keys × 2 locales, full RTL support.
5. **Linear design language** — dark mode native, single lavender accent, hairline borders, no decorative color.

## Process Management

The dev server runs via **PM2** for stability:

```bash
# Start
pm2 start ecosystem.config.cjs

# Restart after code changes
pm2 restart techoffice

# View logs
pm2 logs techoffice

# Stop
pm2 stop techoffice
```

## License

Proprietary — all rights reserved.
