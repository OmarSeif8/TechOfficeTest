# TechOffice Architecture Guide

## 1. Architectural Philosophy

TechOffice is structured around **Domain-Driven Design (DDD)** and **Hexagonal (Ports and Adapters)** architectural principles. The goal is complete decoupling of core engineering calculation logic from the UI framework, ORM, database engine, or execution runtime.

The core engineering calculations (CPM scheduling algorithms, Bill of Quantities mathematics, DXF vector processing, and Document Control state machines) are pure, platform-agnostic TypeScript functions and domain models.

---

## 2. The 5-Layer Law of Layers

The codebase strictly enforces unidirectional dependencies from outer layers inward:

```
┌─────────────────────────────────────────────────────────┐
│                      App Layer                          │
│        (Next.js 16 App Router, UI Views, API Routes)    │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                 Infrastructure Layer                    │
│   (Prisma Repositories, Database Client, DI Container)  │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                    Services Layer                       │
│    (Service Interfaces, Auth Providers, AI Providers)   │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                     Shared Layer                        │
│       (Zod Schemas, Domain Entity Types, DTOs, i18n)    │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                     Domain Layer                        │
│   (Pure Mathematical Engines, Zero External Dep Imports)│
└─────────────────────────────────────────────────────────┘
```

### Layer Rules & Responsibilities

| Layer | Directory | Responsibilities & Restrictions |
| :--- | :--- | :--- |
| **Domain** | `src/domain/` | Pure business rules and calculation engines. **Forbidden from importing React, Next.js, Prisma, Node.js, or external HTTP clients**. Must be isomorphic (runs in Node, Browser, React Native, or Tauri). |
| **Shared** | `src/shared/` | Shared contracts: entity TypeScript types, Zod validation schemas, constants, and internationalization tokens. |
| **Services** | `src/services/` | External provider abstractions (`IAiProvider`, `IAuthProvider`) and integrations. |
| **Infrastructure** | `src/infrastructure/` | Data persistence adapters (Prisma ORM implementations of repository interfaces), database client, and Dependency Injection container registry. |
| **App** | `src/app/`, `src/components/` | Next.js App Router API route handlers, React 19 server/client components, UI store (Zustand), and TanStack Query data fetching. |

---

## 3. Domain Modules

### 3.1 Bill of Quantities (BoQ) Engine (`src/domain/boq/`)
* **Decimal Precision**: All currency and measurement calculations use `decimal.js` to eliminate IEEE-754 floating-point drift.
* **Totals Accumulation**: Deterministic hierarchical aggregation from Item $\rightarrow$ Section $\rightarrow$ Document $\rightarrow$ Project.
* **Rate Analysis**: Unit rate build-ups split across 5 cost components: Material, Labor, Equipment, Subcontractor, and Overhead/Profit markup.
* **Calculators**: Civil engineering takeoff routines (Concrete slab/column/footing volume, Formwork contact area, Rebar tonnage by shape codes, Masonry block counts, Plaster and Paint area).

### 3.2 CPM Scheduling Engine (`src/domain/scheduling/`)
* **Critical Path Method (CPM)**: Topological sort forward pass (Early Start, Early Finish) and backward pass (Late Start, Late Finish) calculating Total Float and Free Float.
* **Cycle Detection**: Directed graph cycle rejection algorithm preventing deadlocked circular dependencies in project activities.
* **Relationship Types**: Full support for standard construction dependencies:
  * `FS` (Finish-to-Start)
  * `SS` (Start-to-Start)
  * `FF` (Finish-to-Finish)
  * `SF` (Start-to-Finish) with positive and negative lead/lag days.
* **Work Calendar**: 5/6/7-day work week calendars with statutory holiday blackout dates and weekend non-working days.

### 3.3 Document Control Workflows (`src/domain/doccontrol/`)
* **Document Numbering**: Configurable auto-incrementing serial number generators per document discipline and type.
* **Status Lifecycles**: Strict state-machine transitions for RFIs, Submittals, Drawings, and Correspondence.
* **Overdue Tracking**: Dynamic overdue threshold calculations based on submission dates, required turnaround days, and project calendars.

### 3.4 DXF CAD Vector Engine (`src/domain/drawing/`)
* **Parser**: Tokenizes ASCII DXF files into structured CAD entity collections (`LINE`, `LWPOLYLINE`, `CIRCLE`, `ARC`, `TEXT`, `MTEXT`, `INSERT`).
* **Coordinate Transformations**: World Coordinate System (WCS) to viewport matrix projections, model-to-screen transforms, and extent calculations.
* **Measurement Tools**: Exact point-to-point euclidean distances, multi-segment perimeter calculations, and polygon area integration with shoelace formula.

---

## 4. Key Architectural Patterns

### 4.1 Repository Pattern & Dependency Injection
Routes and services never execute direct Prisma queries. Instead, they interact with strongly-typed interfaces defined in `src/domain/repositories/`:
* `IProjectRepository`
* `IBoQRepository`
* `IItemLibraryRepository`
* `IRateAnalysisRepository`
* `ICalculationRepository`
* `ISchedulingRepository`

The registry (`src/infrastructure/registry.ts`) manages singleton instances of each repository and wires them to route handlers via `getServices()`.

### 4.2 Optimistic Concurrency Control (OCC)
To prevent accidental write collisions in multi-user environments:
* Aggregates maintain an integer `version` field (starting at `1`).
* Mutations (`PATCH`, `DELETE`) require an `expectedVersion` parameter.
* The update query includes `version: expectedVersion` in the `WHERE` clause.
* If another user updated the entity in the meantime, the query updates 0 rows, and the API returns `409 Conflict` with the current state.

### 4.3 Audit Logging & Soft Deletes
* **Soft Delete**: Deletions set `deletedAt = new Date()`. Queries filter `deletedAt: null` by default.
* **Audit Trail**: All mutating operations trigger an append-only row to the `AuditLog` table capturing:
  * `actorUserId` (Session identity)
  * `action` (e.g. `boq.item.update`, `project.delete`)
  * `entityType` & `entityId`
  * `beforeJson` & `afterJson` state snapshots.
