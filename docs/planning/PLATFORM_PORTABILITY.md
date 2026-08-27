# TechOffice — Platform Portability Guide

**Document**: `docs/planning/PLATFORM_PORTABILITY.md`
**Purpose**: The architecture contract that makes the TechOffice codebase **easily portable** to other platforms (Electron, Tauri, React Native) after the Next.js web MVP ships.
**Governing documents**: `CONSTITUTION_V1.1_WEB.md` §4, §7; `ADAPTATION_GUIDE.md` §3, §6, §7.

---

## 1. The Core Idea

The user explicitly asked: **"easy for all platform code."** This document is the contract that delivers it.

The pattern is **Hexagonal Architecture (Ports & Adapters)** with a strict purity boundary:

```
┌───────────────────────────────────────────────────────────────┐
│  PLATFORM (Next.js Web today; Electron/Tauri/RN tomorrow)     │
│  • Renders UI                                                 │
│  • Receives user input                                        │
│  • Calls Application Services                                 │
└─────────────────────────┬─────────────────────────────────────┘
                          │ depends on interfaces
                          ▼
┌───────────────────────────────────────────────────────────────┐
│  PORTS (interfaces) — defined in src/domain/repositories/      │
│                       and src/services/                        │
│  • IProjectRepository, IBoQRepository, ...                     │
│  • IAiProvider, IFileStorage, IAuthProvider, IExportService     │
└─────────────────────────┬─────────────────────────────────────┘
                          │ implemented by
                          ▼
┌───────────────────────────────────────────────────────────────┐
│  ADAPTERS (concrete implementations) — in src/infrastructure/   │
│  and src/services/<svc>/                                       │
│  • PrismaProjectRepository (web)                              │
│  • SqliteProjectRepository (Electron — future)                │
│  • TauriProjectRepository (Tauri — future)                     │
│  • ZaiAiProvider (web), OllamaProvider (Electron — future)    │
└─────────────────────────┬─────────────────────────────────────┘
                          │ uses pure types from
                          ▼
┌───────────────────────────────────────────────────────────────┐
│  DOMAIN CORE (src/domain/) — PURE TypeScript                   │
│  Zero platform imports. Compiles & runs identically in:       │
│  • Next.js server (Node ESM)                                  │
│  • Next.js client (webpack/turbopack browser bundle)          │
│  • Vitest (Node)                                              │
│  • Electron main (Node CJS/ESM)                               │
│  • Tauri (via ts-rs or similar)                               │
│  • React Native (Metro bundler)                               │
└───────────────────────────────────────────────────────────────┘
```

**The one rule that guarantees portability**: nothing in `src/domain/` or `src/shared/` may import any platform-specific module. This is mechanically enforced by `eslint.config.mjs` `no-restricted-imports` and verified by an **isomorphic compile test** in CI.

---

## 2. Repository Interface Definitions

All repository interfaces live in `src/domain/repositories/` (in the domain layer, because they're contracts the domain depends on). Implementations live in `src/infrastructure/`.

### 2.1 `IProjectRepository`

```typescript
// src/domain/repositories/project-repository.ts
import type { Project, ProjectCreateInput, ProjectUpdateInput } from '@shared/schemas/project'

export interface IProjectRepository {
  // Read
  list(userId: string, opts?: { includeDeleted?: boolean }): Promise<Project[]>
  getById(userId: string, projectId: string): Promise<Project | null>
  getRecent(userId: string, limit: number): Promise<Project[]>

  // Write
  create(userId: string, input: ProjectCreateInput): Promise<Project>
  // Optimistic concurrency: expectedVersion must match; throws VersionConflictError on mismatch
  update(userId: string, projectId: string, input: ProjectUpdateInput, expectedVersion: number): Promise<Project>
  softDelete(userId: string, projectId: string): Promise<void>
  restore(userId: string, projectId: string): Promise<Project>

  // Snapshot management
  createSnapshot(projectId: string, reason: string, payload: string): Promise<void>
  listSnapshots(projectId: string): Promise<ProjectSnapshotMeta[]>
  restoreFromSnapshot(projectId: string, snapshotId: string): Promise<Project>
}
```

### 2.2 `IBoQRepository`

```typescript
// src/domain/repositories/boq-repository.ts
import type { BoQDocument, BoQSection, BoQItem } from '@shared/schemas/boq'
import type { BoQTotals } from '@domain/boq/totals'

export interface IBoQRepository {
  // Documents
  listDocuments(projectId: string): Promise<BoQDocument[]>
  createDocument(projectId: string, input: BoQDocumentCreateInput): Promise<BoQDocument>
  updateDocument(documentId: string, input: BoQDocumentUpdateInput, expectedVersion: number): Promise<BoQDocument>

  // Sections
  listSections(documentId: string): Promise<BoQSection[]>
  createSection(documentId: string, input: BoQSectionCreateInput): Promise<BoQSection>
  reorderSections(documentId: string, sectionIds: string[]): Promise<void>

  // Items
  listItems(sectionId: string): Promise<BoQItem[]>
  createItem(sectionId: string, input: BoQItemCreateInput): Promise<BoQItem>
  updateItem(itemId: string, input: BoQItemUpdateInput, expectedVersion: number): Promise<BoQItem>
  reorderItems(sectionId: string, itemIds: string[]): Promise<void>
  moveItemToSection(itemId: string, targetSectionId: string, newSortOrder: number): Promise<void>
  applyCalculationToItem(itemId: string, qty: string, calculatorRecordId: string): Promise<BoQItem>  // BR-13

  // Aggregate (computed via domain layer from cached rows)
  computeDocumentTotals(documentId: string): Promise<BoQTotals>
  computeProjectGrandTotal(projectId: string): Promise<{ total: string; currency: string }>
}
```

### 2.3 `IItemLibraryRepository`

```typescript
// src/domain/repositories/item-library-repository.ts
import type { ItemLibrary, LibraryCategory } from '@shared/schemas/library'

export interface IItemLibraryRepository {
  search(userId: string, query: { searchText?: string; categoryId?: string; limit?: number; offset?: number }): Promise<{ items: ItemLibrary[]; total: number }>
  getById(id: string): Promise<ItemLibrary | null>
  listCategories(userId: string): Promise<LibraryCategory[]>
  create(userId: string, input: ItemLibraryCreateInput): Promise<ItemLibrary>
  update(id: string, input: ItemLibraryUpdateInput, expectedVersion: number): Promise<ItemLibrary>
  softDelete(id: string): Promise<void>
}
```

### 2.4 `ICalculationRepository`

```typescript
// src/domain/repositories/calculation-repository.ts
import type { CalculationRecord } from '@shared/schemas/calculator'

export interface ICalculationRepository {
  list(projectId: string, opts?: { linkedItemId?: string }): Promise<CalculationRecord[]>
  getById(id: string): Promise<CalculationRecord | null>
  create(projectId: string, input: CalculationRecordCreateInput): Promise<CalculationRecord>
  linkToBoqItem(recordId: string, itemId: string): Promise<CalculationRecord>  // BR-13 confirm flow in service layer
  unlinkFromBoqItem(recordId: string): Promise<CalculationRecord>  // orphan-safe per F5
  softDelete(id: string): Promise<void>
}
```

### 2.5 `IRateAnalysisRepository`

```typescript
// src/domain/repositories/rate-analysis-repository.ts
import type { RateAnalysis, RateAnalysisLine } from '@shared/schemas/rate-analysis'

export interface IRateAnalysisRepository {
  getByBoqItemId(boqItemId: string): Promise<RateAnalysis | null>
  create(boqItemId: string, input: RateAnalysisCreateInput): Promise<RateAnalysis>
  update(id: string, input: RateAnalysisUpdateInput, expectedVersion: number): Promise<RateAnalysis>
  addLine(analysisId: string, input: RateAnalysisLineCreateInput): Promise<RateAnalysisLine>
  updateLine(lineId: string, input: RateAnalysisLineUpdateInput): Promise<RateAnalysisLine>
  removeLine(lineId: string): Promise<void>
  applyRateToItem(analysisId: string, rate: string): Promise<void>  // sets BoQItem.rate in same transaction
}
```

### 2.6 `IImportRepository` & `IExportRepository`

```typescript
// src/domain/repositories/import-repository.ts
export interface IImportRepository {
  createBatch(projectId: string, input: ImportBatchCreateInput): Promise<ImportBatch>
  commitBatch(batchId: string, items: BoQItemCreateInput[]): Promise<{ importedCount: number }>  // atomic per row group
  getBatch(batchId: string): Promise<ImportBatch | null>
}

// src/domain/repositories/export-repository.ts
export interface IExportRepository {
  // Export doesn't write to DB; it generates a binary payload
  exportBoQToExcel(projectId: string, opts: ExportOptions): Promise<Buffer>
  exportBoQToPDF(projectId: string, opts: ExportOptions): Promise<Buffer>
  exportBbsToExcel(projectId: string, opts: ExportOptions): Promise<Buffer>
  exportRateAnalysisToExcel(itemId: string): Promise<Buffer>
}
```

---

## 3. Provider Interface Definitions

Providers abstract external services (AI, file storage, auth). All interfaces live in `src/services/`; implementations live in the same folder (or sub-folder).

### 3.1 `IAiProvider` — AI service abstraction

```typescript
// src/services/ai/types.ts

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiCompletionRequest {
  messages: AiMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface AiCompletionResponse {
  content: string
  model: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  // AI never writes to project data directly — caller must apply with human review (Constitution §7.3)
  proposal: boolean  // always true; engineer approves (Constitution §3 non-negotiable #3)
}

export interface IAiProvider {
  readonly name: string  // "zai" | "ollama" | "openai" | "anthropic"
  isAvailable(): Promise<boolean>  // health check
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>
  // Future: stream?(request, onChunk): Promise<final>  — Phase 4+ only
}
```

### 3.2 `IFileStorage` — Blob storage abstraction

```typescript
// src/services/file-storage/types.ts

export interface FileUploadInput {
  userId: string
  filename: string
  mimeType: string
  data: Buffer | ReadableStream<Uint8Array> | Blob
}

export interface StoredFile {
  id: string
  userId: string
  storageKey: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  createdAt: Date
}

export interface IFileStorage {
  upload(input: FileUploadInput): Promise<StoredFile>  // validates MIME, computes sha256, persists
  download(fileId: string): Promise<{ stream: ReadableStream; meta: StoredFile }>
  delete(fileId: string): Promise<void>  // soft delete in DB; blob garbage-collected later
  getUrl(fileId: string, opts?: { expiresIn?: number }): Promise<string>  // signed URL or local path
}
```

### 3.3 `IAuthProvider` — Authentication abstraction

```typescript
// src/services/auth/types.ts

export interface AuthSession {
  userId: string
  email: string
  name?: string
  expiresAt: Date
}

export interface AuthCredentials {
  email: string
  password: string
}

export interface IAuthProvider {
  // For Next.js web: delegates to NextAuth (server-side only)
  signIn(credentials: AuthCredentials): Promise<AuthSession | null>
  signOut(sessionToken: string): Promise<void>
  getSession(sessionToken: string): Promise<AuthSession | null>
  // Future Electron: validateLicenseFile / machine binding
}
```

### 3.4 `IExportRenderer` — PDF/Excel rendering abstraction

```typescript
// src/services/export/types.ts

export interface IExportRenderer {
  renderExcel(workbookSpec: ExcelWorkbookSpec): Promise<Buffer>  // ExcelJS server-side
  renderPDF(htmlContent: string): Promise<Buffer>  // Puppeteer/Chromium server-side
}
```

> **Future-proof**: on Electron, `renderPDF` could use the in-process Chromium instead of Puppeteer. On Tauri, this would use `wkhtmltopdf` or a Rust crate. The interface doesn't change.

---

## 4. Concrete Implementations (web MVP, Phase 1)

| Interface | Web implementation | File location |
|-----------|---------------------|---------------|
| `IProjectRepository` | `PrismaProjectRepository` | `src/infrastructure/persistence/prisma/project-repository.ts` |
| `IBoQRepository` | `PrismaBoQRepository` | `src/infrastructure/persistence/prisma/boq-repository.ts` |
| `IItemLibraryRepository` | `PrismaItemLibraryRepository` | `src/infrastructure/persistence/prisma/item-library-repository.ts` |
| `ICalculationRepository` | `PrismaCalculationRepository` | `src/infrastructure/persistence/prisma/calculation-repository.ts` |
| `IRateAnalysisRepository` | `PrismaRateAnalysisRepository` | `src/infrastructure/persistence/prisma/rate-analysis-repository.ts` |
| `IImportRepository` | `PrismaImportRepository` | `src/infrastructure/persistence/prisma/import-repository.ts` |
| `IExportRepository` | `ExcelExportRepository` + `PuppeteerPdfExportRepository` | `src/infrastructure/export/` |
| `IAiProvider` | `ZaiAiProvider` | `src/services/ai/zai-provider.ts` |
| `IFileStorage` | `DbFileStorage` (blob on local disk in dev, S3-compatible in prod) | `src/services/file-storage/db-file-storage.ts` |
| `IAuthProvider` | `NextAuthProvider` (wraps NextAuth) | `src/services/auth/next-auth-provider.ts` |
| `IExportRenderer` | `ServerExportRenderer` (ExcelJS + Puppeteer) | `src/services/export/server-renderer.ts` |

### 4.1 Provider Registry (where the wiring happens)

```typescript
// src/infrastructure/registry.ts  (server-only — never imported by client)
import { PrismaProjectRepository } from './persistence/prisma/project-repository'
import { PrismaBoQRepository } from './persistence/prisma/boq-repository'
import { ZaiAiProvider } from '@/services/ai/zai-provider'
// ... other imports

import type { IProjectRepository, IBoQRepository /* ... */ } from '@domain/repositories'
import type { IAiProvider } from '@/services/ai/types'

// Singleton instances for the current request scope
export function createRepositories(prisma: PrismaClient) {
  return {
    project: new PrismaProjectRepository(prisma),
    boq: new PrismaBoQRepository(prisma),
    library: new PrismaItemLibraryRepository(prisma),
    calculation: new PrismaCalculationRepository(prisma),
    rateAnalysis: new PrismaRateAnalysisRepository(prisma),
    import: new PrismaImportRepository(prisma),
    // export is stateless; constructor takes renderer
  }
}

export function createAiProvider(): IAiProvider {
  // Future: switch on env var — `process.env.AI_PROVIDER === 'ollama' ? new OllamaProvider() : new ZaiAiProvider()`
  return new ZaiAiProvider({ apiKey: process.env.ZAI_API_KEY! })
}
```

> **For Electron port (Phase 5)**: a parallel `src/infrastructure/registry.electron.ts` would wire `SqliteProjectRepository` (using better-sqlite3 directly) and `OllamaProvider` (HTTP to `localhost:11434`). Domain layer and UI components are unchanged.

---

## 5. Migration Path: Web MVP → Electron Desktop

When the user takes this codebase to a desktop agent for Electron packaging, here's the diff:

### 5.1 What stays identical (the ~85%)

| Folder | Status |
|--------|--------|
| `src/domain/` (all calculation logic) | ✅ 100% unchanged |
| `src/shared/` (zod schemas, i18n, types) | ✅ 100% unchanged |
| `src/services/ai/types.ts`, `src/services/file-storage/types.ts`, etc. (all interfaces) | ✅ 100% unchanged |
| `src/services/ai/zai-provider.ts` (still useful as fallback) | ✅ unchanged |
| `src/infrastructure/persistence/prisma/*` (Prisma impls) | ✅ still usable — Prisma+SQLite works in Electron |
| `src/components/*` (all React UI) | ✅ unchanged — React renders the same in Electron renderer |
| `tests/golden/*` (all GTs) | ✅ unchanged — pure domain tests run in Node either way |

### 5.2 What changes (the ~15%)

| Folder / file | Change | Notes |
|---------------|--------|-------|
| `src/app/api/*/route.ts` (Next.js API routes) | Replaced with `src/electron/main.ts` IPC handlers that call the same repositories | The handler signatures match the route handlers' shape |
| `src/app/(app)/layout.tsx` (Next.js layout) | Becomes Electron renderer entry; `next dev` replaced with `electron-vite dev` | Same React tree |
| `src/services/ai/ollama-provider.ts` | NEW — implements `IAiProvider` via HTTP to `localhost:11434` | Pure addition |
| `src/services/file-storage/node-file-storage.ts` | NEW — implements `IFileStorage` via Node `fs/promises` writing to user-data dir | Pure addition |
| `src/infrastructure/sqlite/*` | NEW (optional) — `better-sqlite3` direct impls for faster desktop performance | Optional; Prisma works fine in Electron too |
| `src/electron/preload.ts` | NEW — contextBridge exposes typed API surface to renderer | Maps 1:1 with API routes |
| `package.json` | Add `electron`, `electron-builder`, `electron-vite`; add build scripts for NSIS/AppImage | Same `next` deps retained |
| `prisma/schema.prisma` | Optional: switch from SQLite to embedded Postgres if multi-project performance needs it. SQLite is fine for desktop. | Unchanged in 95% of cases |
| `.github/workflows/ci.yml` | Add `electron-builder` build matrix for Windows + Linux | Same vitest tests run |

### 5.3 Estimated porting effort

- **Pure domain code (golden tests)**: zero changes — verified by running the same vitest suite against the Electron build.
- **UI components**: zero changes — React tree renders identically; `next/navigation` (URL routing) replaced with Electron's history API or kept as `next-router` if using `next-electron`.
- **Persistence layer**: zero changes if Prisma retained; ~5% changes if switching to direct `better-sqlite3` impls.
- **AI provider**: ~10% changes (add `OllamaProvider`; swap default in registry).
- **Total estimated porting effort**: **2-4 engineer-weeks** for a working Electron MVP, with 85% of code reused verbatim.

---

## 6. Future Platform Targets (beyond Electron)

### 6.1 Tauri (Rust + WebView)

**Why**: smaller binary, lower memory, native Rust performance for CPM engine (Phase 2A).

**Architecture changes**:
- `src/domain/` exposed to Rust via `ts-rs` (TypeScript → Rust type bindings) — pure domain compiles to Rust for native speed.
- `src/infrastructure/tauri/*` — Rust-backed repository impls that call into Rust persistence (e.g., `rusqlite`).
- UI: same React tree; Tauri's WebView renders it.
- AI: same `IAiProvider` interface; Ollama runs locally on `localhost:11434`.

**Estimated effort**: 4-6 engineer-weeks, because Rust persistence layer needs writing from scratch (no Prisma equivalent for Tauri). Domain code unchanged.

### 6.2 React Native (mobile)

**Why**: iOS/Android access for field engineers (view BoQ, mark progress on daily reports).

**Architecture changes**:
- `src/domain/` unchanged — pure TypeScript runs in Metro.
- UI: shadcn/ui → React Native Paper (or Tamagui for cross-platform).
- Persistence: API calls to the existing Next.js server (mobile is a thin client).
- AI: same `IAiProvider` interface over HTTP to the server (no local Ollama on mobile).
- File storage: `RnFileStorage` uses platform file system (DocumentPicker + FileSystem API).

**Estimated effort**: 8-12 engineer-weeks, mostly UI rewrites. Domain unchanged. Phase 5+ target.

---

## 7. The Isomorphic Compile Test (the guarantee)

To prove the domain layer is truly platform-agnostic, CI runs an **isomorphic compile test**:

```yaml
# .github/workflows/ci.yml (excerpt)
jobs:
  isomorphic-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      # Compile domain under three different module resolutions
      - name: Compile domain under Next.js server config
        run: npx tsc --project tsconfig.domain.json --module esnext --moduleResolution bundler
      - name: Compile domain under Next.js client config
        run: npx tsc --project tsconfig.domain.json --module esnext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable
      - name: Compile domain under Electron main config
        run: npx tsc --project tsconfig.domain.json --module commonjs --moduleResolution node
      - name: Compile domain under React Native config (no DOM lib)
        run: npx tsc --project tsconfig.domain.json --module esnext --moduleResolution bundler --lib ES2022
      - name: Run golden tests
        run: npx vitest run
```

A `tsconfig.domain.json` includes only `src/domain/` and `src/shared/`. If domain ever imports anything platform-specific, this compile fails — the rule is enforced by CI, not by code review.

---

## 8. The Build Matrix (Quick Reference)

| Folder | Web (Next.js) | Electron | Tauri | React Native |
|--------|---------------|----------|-------|--------------|
| `src/domain/` | ✅ | ✅ | ✅ | ✅ |
| `src/shared/` | ✅ | ✅ | ✅ | ✅ |
| `src/domain/repositories/` (interfaces) | ✅ | ✅ | ✅ | ✅ |
| `src/services/*/types.ts` (interfaces) | ✅ | ✅ | ✅ | ✅ |
| `src/services/ai/zai-provider.ts` | ✅ server | ❌ (no z-ai SDK in Electron — use Ollama) | ✅ via HTTP | ✅ via HTTP |
| `src/services/ai/ollama-provider.ts` | ✅ (future) | ✅ (primary) | ✅ (primary) | ✅ via HTTP |
| `src/services/file-storage/db-file-storage.ts` | ✅ | ✅ (Prisma) | ❌ | ❌ |
| `src/services/file-storage/node-file-storage.ts` | ❌ (no fs in browser) | ✅ (primary) | ❌ (no Node) | ❌ |
| `src/infrastructure/persistence/prisma/*` | ✅ | ✅ (Prisma+SQLite) | ❌ | ❌ |
| `src/infrastructure/persistence/sqlite/*` (future) | ❌ | ✅ (better-sqlite3) | ❌ | ❌ |
| `src/infrastructure/persistence/tauri/*` (future) | ❌ | ❌ | ✅ (Rust) | ❌ |
| `src/components/*` (React UI) | ✅ | ✅ | ✅ | 🟡 (RN primitives needed) |
| `src/app/` (Next.js routes) | ✅ | 🟡 (renderer reuses components) | 🟡 | ❌ |
| `prisma/schema.prisma` | ✅ | ✅ | ❌ | ❌ |
| `tests/golden/*` | ✅ vitest | ✅ vitest | ✅ vitest | ✅ vitest |

Legend: ✅ works as-is · 🟡 works with adapter · ❌ needs replacement

---

## 9. Anti-Patterns to Avoid (enforced by lint + review)

| Anti-pattern | Why forbidden | Enforced by |
|---------------|---------------|-------------|
| Domain file imports `next/server`, `react`, `prisma`, `fs`, `path` | Breaks isomorphic compile + violates layer purity | `eslint.config.mjs` `no-restricted-imports` |
| UI component imports `prisma` or `@infrastructure/*` directly | Client bundle bloat; breaks Electron/RN port | `eslint.config.mjs` |
| Service impl writes to project data without going through repository | Skips optimistic concurrency; breaks audit log | Code review + integration test |
| `IAiProvider.complete()` writes to DB directly | Violates "AI proposes, engineer approves" | Interface design (returns proposal, not effect) |
| Hard-coded string in component (e.g., `<button>Save</button>`) | Breaks i18n; Arabic parity fails | `eslint.config.mjs` `react/no-unescaped-entities` + review |
| Money math via `number` instead of `decimal.js` | Floats in money — Constitution §3 non-negotiable #1 | `eslint.config.mjs` `no-restricted-syntax` flagging `Number()` on money vars |
| Repository impl in `src/domain/` | Domain depends on impl — breaks portability | Folder structure + lint |
| Client Component fetches Prisma client | Server-only module in client bundle → security leak | `eslint.config.mjs` + Next.js build error |

---

## 10. What This Document Guarantees

1. **The same `src/domain/` runs unmodified in 5 runtimes** (Next.js server, Next.js client, Vitest, Electron main, future Tauri/RN).
2. **Adding a new platform is additive, never breaking** — new impls in `src/infrastructure/<platform>/`, no edits to domain.
3. **The Constitution's "AI proposes, engineer approves" rule is structural**, not aspirational — the `IAiProvider` interface returns proposals, never applies them.
4. **The golden tests are platform-agnostic** — they run in plain Node via vitest, no Electron/Next needed.
5. **Migration cost is bounded** — Electron port estimated at 2-4 engineer-weeks; Tauri 4-6; RN 8-12. Domain code: zero changes in all three.

This is what "easy for all platform code" means in practice.

---

**End of Platform Portability Guide.**
