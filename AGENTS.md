# TechOffice — AI Agent Operating Instructions (AGENTS.md)

This file defines the strict non-negotiables, laws of layers, and operational runbooks for any AI coding agent (Antigravity, Cursor, Claude Code, Codex, Aider, Copilot) working in this repository.

---

## 1. Non-Negotiable Core Laws

### Law 1: The Law of Layers (Domain Purity)
* `src/domain/` is the sacred calculation core.
* **FORBIDDEN IN DOMAIN**: Never import React, Next.js, Prisma, Node.js (`fs`, `path`, `process`), or external network clients into `src/domain/`.
* The domain layer must remain 100% isomorphic and portable to browser, desktop (Tauri/Electron), and mobile.
* Always verify domain purity by running:
  ```bash
  npm run test:domain
  ```

### Law 2: Golden Tests Are Immutable Law
* Test suites in `tests/golden/` represent hand-verified engineering benchmarks for BoQ math, CPM dates, DXF shoelace geometry, and takeoff calculations.
* **NEVER modify a golden test assertion to make code pass**. If code disagrees with a golden test, the code is wrong.

### Law 3: Financial & Measurement Precision
* Never use raw JavaScript IEEE-754 floating-point arithmetic (`+`, `-`, `*`, `/`) for money, rates, item quantities, or section totals.
* **Always use `decimal.js`** (`Decimal`) to guarantee precision without rounding drift.

### Law 4: Optimistic Concurrency Control (OCC)
* When updating or deleting updatable aggregates (Projects, BoQDocuments, BoQSections, BoQItems, RateAnalyses), **always include `expectedVersion` in payload and `version: expectedVersion` in Prisma `WHERE` clauses**.
* Atomic updates increment `version: { increment: 1 }`.
* If zero rows are affected, return `409 Conflict` with `{ currentVersion }`.

### Law 5: PostgreSQL Text Search Case-Insensitivity
* When using Prisma's `contains` filter on PostgreSQL, **always pass `mode: 'insensitive'`**:
  ```ts
  { nameEn: { contains: term, mode: 'insensitive' } }
  ```

### Law 6: Tenancy & Anti-Enumeration
* Every API route verifying project ownership must return `404 Not Found` (never `403 Forbidden`) if a project is missing or owned by another user. This prevents project ID enumeration or existence leakage.

---

## 2. Standard Quality Gates & Verification Commands

Before completing any task or proposing changes, execute these verification commands in order:

```bash
# 1. Typecheck (Zero errors required)
npm run typecheck

# 2. Domain layer purity verification (Must compile standalone)
npm run test:domain

# 3. Unit and golden regression tests
npm test

# 4. Lint check
npm run lint
```

---

## 3. Graphify Knowledge Graph Rules

This repository maintains a Graphify knowledge graph under `graphify-out/`.

* **Ask the Graph First**: For architectural or call-chain questions, query the graph before grepping files:
  ```powershell
  graphify query "<question>"
  graphify path "<SymbolA>" "<SymbolB>"
  graphify explain "<Symbol>"
  ```
* **Keep the Graph Synchronized**: After modifying code files in any session, run:
  ```powershell
  graphify update .
  ```
  *(AST extraction only; requires no API key or token cost)*.

---

## 4. Architectural Map & Key Interfaces

| Component | Interface Location | Implementation Location |
| :--- | :--- | :--- |
| **Project Repository** | `src/domain/repositories/project-repository.ts` | `src/infrastructure/persistence/prisma/project-repository.ts` |
| **BoQ Repository** | `src/domain/repositories/boq-repository.ts` | `src/infrastructure/persistence/prisma/boq-repository.ts` |
| **Item Library** | `src/domain/repositories/item-library-repository.ts`| `src/infrastructure/persistence/prisma/item-library-repository.ts` |
| **Rate Analysis** | `src/domain/repositories/rate-analysis-repository.ts`| `src/infrastructure/persistence/prisma/rate-analysis-repository.ts`|
| **Takeoff Calculations**| `src/domain/repositories/calculation-repository.ts` | `src/infrastructure/persistence/prisma/calculation-repository.ts` |
| **CPM Scheduling** | `src/domain/repositories/scheduling-repository.ts` | `src/infrastructure/persistence/prisma/scheduling/` |
| **Dependency Registry**| `src/infrastructure/registry.ts` | Singleton container accessed via `getServices()` |

---

## 5. Coding Conventions

* **Bilingual Data**: Entities have paired bilingual strings (`nameEn` and `nameAr`). Do not concatenate them.
* **Primary Keys**: CUIDs (`@default(cuid())`).
* **Soft Deletes**: Always check `deletedAt: null` unless `includeDeleted=true` is explicitly requested.
* **Audit Logging**: Any mutating action must call `await writeAuditLog({ action, entityType, entityId, beforeJson, afterJson })`.
