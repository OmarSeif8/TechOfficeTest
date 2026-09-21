# TechOffice — Engineering Technical Office

A bilingual (**English / Arabic**) enterprise management platform for civil engineers, quantity surveyors, and project managers. Built with **Next.js 16 (Turbopack)**, **TypeScript 5**, **Prisma ORM**, **Supabase PostgreSQL**, and the **Linear design language**.

---

## 📑 Table of Contents
1. [Core Modules](#-core-modules)
2. [Architecture & Design Philosophy](#-architecture--design-philosophy)
3. [Technology Stack](#-technology-stack)
4. [Quick Start & Setup](#-quick-start--setup)
5. [Database & Seeding](#-database--seeding)
6. [Testing & Quality Gates](#-testing--quality-gates)
7. [Graphify Knowledge Graph](#-graphify-knowledge-graph)
8. [Documentation Hub](#-documentation-hub)
9. [Deployment](#-deployment)
10. [License](#-license)

---

## 🏗 Core Modules

TechOffice consolidates the fragmented day-to-day tools of technical offices into an integrated, responsive web application:

* **Bill of Quantities (BoQ) Engine**:
  * Hierarchical document tree (Project $\rightarrow$ Document $\rightarrow$ Section $\rightarrow$ Items).
  * Arbitrary decimal precision calculations via `decimal.js` (no floating-point drift).
  * Rate analysis build-ups split across Material, Labor, Equipment, Subcontractor, and Markups.
  * 6 civil engineering takeoff calculators (Concrete, Formwork, Rebar Bar-Bending Schedules, Masonry, Plaster, Paint).
  * Full Excel import/export wizard with automated column mapping.
* **CPM Scheduling Engine**:
  * Critical Path Method (CPM) with topological forward/backward passes.
  * Calculates Early Start, Early Finish, Late Start, Late Finish, Total Float, and Free Float.
  * Cyclic dependency rejection engine preventing project deadlocks.
  * Standard relationship types: `FS`, `SS`, `FF`, `SF` with positive and negative lag.
  * Interactive SVG Gantt chart with critical path highlighting and custom calendars.
* **Document Control & Transmittals**:
  * Drawing register with revision tracking and superseded status workflows.
  * Submittal logs and RFIs with Q&A status life-cycle state machines.
  * Dynamic overdue alerts linked to working-day calendars.
  * Automated transmittal slip compiler.
* **DXF CAD Vector Viewer**:
  * In-browser CAD parsing directly from raw ASCII `.dxf` files.
  * Vector rendering via interactive SVG with layer toggle, pan, zoom, and extents fit.
  * Precision measurement tools: point-to-point distance, perimeter, and polygon area.
* **Bilingual Support (EN / AR & RTL)**:
  * Full Right-to-Left (RTL) support with localized number formatting and parallel string fields (`nameEn`, `nameAr`).

---

## 🏛 Architecture & Design Philosophy

The application follows an **isomorphic 5-layer Hexagonal / Domain-Driven Design (DDD)**:

```
src/
├── domain/          Pure calculation engines (zero platform dependencies)
│   ├── boq/         BoQ totals, rate analysis, civil takeoff calculators
│   ├── scheduling/  CPM engine, calendars, cycle detection
│   ├── doccontrol/  Numbering generators, overdue tracking, workflows
│   └── drawing/     DXF parser, transformations, measurement algorithms
├── shared/          Entity types, Zod schemas, bilingual i18n dictionaries
├── services/        Provider abstractions (IAiProvider, IAuthProvider)
├── infrastructure/  Prisma repository adapters & Dependency Injection registry
└── app/             Next.js 16 App Router (REST API routes & React 19 views)
```

> **The Law of Layers**: The core `domain` layer has **zero external platform imports** (no Next.js, React, Node.js, or Prisma). Layer purity is enforced via ESLint rules and the isolated `npm run test:domain` compilation check.

For deep architectural details, see [**`docs/ARCHITECTURE.md`**](file:///d:/Prog/Prog%20file/techoffice-main/docs/ARCHITECTURE.md).

---

## 💻 Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **Language** | TypeScript 5 (Strict Mode) |
| **UI & Styling** | Tailwind CSS 4, Radix UI Primitives, shadcn/ui (Linear Dark Theme) |
| **Database** | Supabase PostgreSQL + Prisma ORM (Connection Pooler on Port 6543) |
| **Authentication**| NextAuth.js v4 (Credentials Provider with Session Verification) |
| **Client State** | Zustand (UI Store) + TanStack React Query (Server Cache) |
| **i18n** | `next-intl` (English & Arabic with full RTL styling) |
| **Math & CAD** | `decimal.js` for financial accuracy, `dxf` parser |
| **Testing** | Vitest 4 with V8 coverage |

---

## 🚀 Quick Start & Setup

### 1. Prerequisites
* **Node.js** 20.x or higher (or **Bun** 1.1+)
* **Git** installed
* A **Supabase PostgreSQL** database instance

### 2. Clone and Install
```bash
git clone https://github.com/OmarSeif8/TechOfficeTest.git
cd TechOfficeTest

npm install
# or: bun install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your connection credentials:
```bash
cp .env.example .env
```

Key variables:
```env
NEXT_PUBLIC_SUPABASE_URL="https://[YOUR-PROJECT].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
DATABASE_URL="postgresql://postgres.[REF]:[PASS]@aws-1-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[REF]:[PASS]@aws-1-[REGION].pooler.supabase.com:5432/postgres"
NEXTAUTH_SECRET="your-32-char-random-secret"
NEXTAUTH_URL="http://localhost:3000"
DEMO_MODE="true"
```

### 4. Initialize Database
Push the Prisma schema and seed standard reference data:
```bash
npx prisma db push
npx tsx prisma/seed.ts
```

### 5. Start Development Server
```bash
npm run dev
# or: bun run dev
```
Open [**`http://localhost:3000`**](http://localhost:3000) in your browser.

---

## 🗄 Database & Seeding

* **Prisma Schema**: Declared in [`prisma/schema.prisma`](file:///d:/Prog/Prog%20file/techoffice-main/prisma/schema.prisma) with optimistic concurrency locks (`version`), soft deletes (`deletedAt`), and audit logs (`AuditLog`).
* **Idempotent Seeding**: Run `npx tsx prisma/seed.ts` to initialize:
  * 9 standard engineering measurement units (`m`, `m2`, `m3`, `ton`, `kg`, etc.)
  * 38 unit aliases for fuzzy matching
  * 13 rebar diameters & 8 shape codes
  * 10 library categories and 23 standard construction items.

For full database documentation, see [**`docs/DATABASE.md`**](file:///d:/Prog/Prog%20file/techoffice-main/docs/DATABASE.md).

---

## 🧪 Testing & Quality Gates

The codebase enforces strict test verification:

```bash
# Run all unit and integration tests
npm test

# Run Golden Tests (The Law — hand-verified engineering benchmarks)
npm run test:golden

# Verify domain layer isolation (zero platform dependencies)
npm run test:domain

# Typecheck and linting
npm run typecheck
npm run lint
```

### Golden Test Law
Golden tests ([`tests/golden/`](file:///d:/Prog/Prog%20file/techoffice-main/tests/golden)) represent immutable mathematical benchmarks for:
* BoQ hierarchical totals accumulation
* CPM Early/Late date and float calculation
* Civil takeoff formula outputs
* DXF coordinate transforms and shoelace polygon area calculations.

---

## 🧠 Graphify Knowledge Graph

This repository is indexed with a **Graphify Knowledge Graph** at [`graphify-out/`](file:///d:/Prog/Prog%20file/techoffice-main/graphify-out), containing 6,100+ code nodes and 10,800+ relationship edges:

* **Interactive Visualization**: Open [`graphify-out/graph.html`](file:///d:/Prog/Prog%20file/techoffice-main/graphify-out/graph.html) in any browser to inspect the visual dependency graph.
* **Architecture Audit**: Review [`graphify-out/GRAPH_REPORT.md`](file:///d:/Prog/Prog%20file/techoffice-main/graphify-out/GRAPH_REPORT.md) for community hubs, bridge nodes, and surprising connections.
* **Query the Graph (CLI)**:
  ```powershell
  # Query architecture or call flow
  graphify query "How does CPM scheduling connect to BoQ?"

  # Trace shortest path between two symbols
  graphify path "requireUserId" "PrismaProjectRepository"

  # Update graph after refactors
  graphify update .
  ```

---

## 📚 Documentation Hub

Deep-dive documentation is available in the [`docs/`](file:///d:/Prog/Prog%20file/techoffice-main/docs) directory:

* [**Architecture Guide**](file:///d:/Prog/Prog%20file/techoffice-main/docs/ARCHITECTURE.md) — 5-layer domain architecture, repository patterns, optimistic concurrency, and audit logs.
* [**Database Guide**](file:///d:/Prog/Prog%20file/techoffice-main/docs/DATABASE.md) — Schema models, Supabase connection pooler setup, seed runbooks, and case-insensitivity rules.
* [**API Reference**](file:///d:/Prog/Prog%20file/techoffice-main/docs/API_REFERENCE.md) — RESTful endpoints, ownership security, payload schemas, and error responses.
* [**Deployment Guide**](file:///d:/Prog/Prog%20file/techoffice-main/docs/DEPLOYMENT.md) — Vercel preview branch deployment, environment variables, and build optimization.
* [**Design System Specification**](file:///d:/Prog/Prog%20file/techoffice-main/DESIGN.md) — Linear dark-mode tokens, spacing scales, and typography standards.

---

## ☁️ Deployment

TechOffice is deployed to **Vercel** with automatic preview deployments:
* Pushes to `main` $\rightarrow$ Production deployment.
* Pushes to any branch (e.g. `debug/investigation`) $\rightarrow$ Instant isolated Preview deployment with live URL.

For configuration instructions, see [**`docs/DEPLOYMENT.md`**](file:///d:/Prog/Prog%20file/techoffice-main/docs/DEPLOYMENT.md).

---

## 📄 License

Proprietary — All rights reserved.
