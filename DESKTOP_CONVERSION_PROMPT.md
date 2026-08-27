# TechOffice — Web App to Desktop App Conversion Prompt

> **Copy this entire document and paste it as your first message to a desktop-capable AI coding agent** (Claude Code, Cursor, Cline, etc.) on your local machine after cloning the repo.
>
> The agent should read this BEFORE writing any code.

---

## PROJECT CONTEXT

You are converting a **production-ready Next.js 16 web application** into an **Electron desktop application** for Windows and Linux.

### Repository
```
git clone https://github.com/sportifseif5-coder/techoffice.git
cd techoffice
bun install
```

### What Already Exists (DO NOT Rewrite These)

The web app is **complete and tested** with:
- **590 tests** (338 golden test assertions — the law)
- **28 UI views** (all React components)
- **65 API routes** (Next.js App Router)
- **55 Prisma models** (SQLite database)
- **5 phases**: BoQ module, CPM scheduling, document control, DXF viewer, payments/financials
- **Bilingual EN/AR** with RTL support
- **Linear design language** (dark theme, lavender accent)

### The Architecture (CRITICAL — Read Before Doing Anything)

The codebase is a **5-layer platform-agnostic architecture**:

```
src/
├── domain/          ← Pure calculation logic (ZERO platform imports)
│   ├── boq/            BoQ totals, rate analysis, calculators (GT-1..GT-8)
│   ├── scheduling/     CPM engine, calendar, cycle detection (GT-P1..P6)
│   ├── doccontrol/     Numbering, overdue, status workflows (GT-DC1..DC6)
│   ├── drawing/        DXF parser, transforms, measurement (GT-DXF-1..5)
│   └── payments/       IPC engine, cost-loading, earned value (GT-PAY/CS/EV)
├── shared/          ← Zod schemas + entity types + i18n strings (ZERO platform imports)
├── services/        ← Interfaces (IAiProvider, IAuthProvider) + implementations
├── infrastructure/  ← Prisma repository implementations + DI registry
└── app/             ← Next.js App Router (API routes + pages)
    ├── api/            65 route files (THIS CHANGES for Electron)
    ├── layout.tsx      Root layout (THIS CHANGES)
    └── page.tsx        Single / route (THIS CHANGES)
```

**Layer purity is mechanically enforced** by:
- `eslint.config.mjs` — `no-restricted-imports` rules
- `tsconfig.domain.json` — isomorphic compile test
- `bun run test:domain` — verifies domain layer compiles without Next.js/React/Prisma

**These rules MUST remain in place.** The domain layer (`src/domain/`) and shared layer (`src/shared/`) must NEVER import `next`, `react`, `electron`, `prisma`, `fs`, `path`, or any platform-specific code.

---

## WHAT TO DO: Step-by-Step

### STEP 0: Verify the Existing Project Works

Before changing anything, verify the web app runs:

```bash
cd techoffice
bun install
cp .env.example .env
# Edit .env: set DATABASE_URL, NEXTAUTH_SECRET (openssl rand -base64 32)
bun run db:push
bun run db:seed
bun run dev
# Open http://localhost:3000 — the dashboard should load
bun run test
# All 590 tests should pass
bun run test:domain
# Isomorphic compile should pass (domain layer has zero platform imports)
```

If any of these fail, STOP and fix before proceeding.

---

### STEP 1: Install Electron Dependencies

```bash
bun add -D electron electron-builder concurrently wait-on
bun add -D @types/electron
bun add better-sqlite3
bun add electron-store
```

**License gate**: Before installing any package, verify its license:
- `electron` — MIT ✅
- `electron-builder` — MIT ✅
- `better-sqlite3` — MIT ✅
- `electron-store` — MIT ✅
- NEVER install LibreDWG or any GPL/AGPL package (Constitution rule)

---

### STEP 2: Create the Electron Main Process

Create `electron/main.ts`:

```typescript
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#010102", // Linear dark canvas
    title: "TechOffice — Engineering Technical Office",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development: load from the Next.js dev server
  // In production: load from the built Next.js output
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../out/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

Create `electron/preload.ts`:

```typescript
import { contextBridge, ipcRenderer } from "electron";

// Expose a safe API to the renderer process (React app)
// The renderer calls window.electronAPI.invoke(channel, data)
// instead of fetch('/api/...') — the IPC handler routes to the
// same domain logic the web app used.
contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, data: unknown) => ipcRenderer.invoke(channel, data),
  // File dialogs (desktop-only — replaces web file input)
  showOpenDialog: (options: unknown) => ipcRenderer.invoke("dialog:open", options),
  showSaveDialog: (options: unknown) => ipcRenderer.invoke("dialog:save", options),
  // App info
  getVersion: () => ipcRenderer.invoke("app:version"),
  // License file operations (desktop-only)
  readLicenseFile: () => ipcRenderer.invoke("license:read"),
  writeLicenseFile: (content: string) => ipcRenderer.invoke("license:write", content),
});
```

---

### STEP 3: Create the IPC Handler Layer (Replaces API Routes)

The web app has 65 API routes in `src/app/api/`. In Electron, these become **IPC handlers** in `electron/ipc-handlers.ts`.

**DO NOT rewrite the domain logic.** The IPC handlers should call the EXACT SAME functions the API routes called.

For example, the web app's `src/app/api/projects/route.ts` calls:
```typescript
const services = getServices();
const projects = await services.projects.list({ ownerId: userId });
```

The Electron IPC handler calls the same:
```typescript
ipcMain.handle("projects:list", async (event, { search, limit, offset }) => {
  const userId = getCurrentUserId(); // desktop: from electron-store or license
  const services = getDesktopServices();
  const projects = await services.projects.list({ ownerId: userId, search, limit, offset });
  return projects;
});
```

Create `electron/ipc-handlers.ts` and register ALL handlers. Here's the full list of routes to convert (group by domain):

**Auth:**
- `auth:signin` ← was POST /api/auth/callback/credentials
- `auth:signup` ← was POST /api/auth/signup
- `auth:signout` ← was NextAuth signout
- `auth:getSession` ← was GET /api/auth/session

**Projects:**
- `projects:list` ← was GET /api/projects
- `projects:create` ← was POST /api/projects
- `projects:get` ← was GET /api/projects/[id]
- `projects:update` ← was PATCH /api/projects/[id]
- `projects:delete` ← was DELETE /api/projects/[id]
- `projects:restore` ← was POST /api/projects/[id]/restore

**BoQ (documents, sections, items):**
- `documents:list` ← GET /api/projects/[id]/documents
- `documents:create` ← POST /api/projects/[id]/documents
- `documents:get` ← GET /api/documents/[id] (with sections + items + totals)
- `documents:update` ← PATCH /api/documents/[id]
- `documents:delete` ← DELETE /api/documents/[id]
- `sections:list` ← GET /api/documents/[id]/sections
- `sections:create` ← POST /api/documents/[id]/sections
- `sections:update` ← PATCH /api/sections/[id]
- `sections:delete` ← DELETE /api/sections/[id]
- `sections:reorder` ← POST /api/sections/[id]/reorder
- `items:list` ← GET /api/sections/[id]/items
- `items:create` ← POST /api/sections/[id]/items
- `items:get` ← GET /api/items/[id]
- `items:update` ← PATCH /api/items/[id] (with optimistic concurrency)
- `items:delete` ← DELETE /api/items/[id]
- `items:move` ← POST /api/items/[id]/move

**Rate Analysis:**
- `rateAnalysis:getByItem` ← GET /api/items/[id]/rate-analysis
- `rateAnalysis:create` ← POST /api/items/[id]/rate-analysis
- `rateAnalysis:get` ← GET /api/rate-analyses/[id]
- `rateAnalysis:update` ← PATCH /api/rate-analyses/[id]
- `rateAnalysis:delete` ← DELETE /api/rate-analyses/[id]
- `rateAnalysis:apply` ← POST /api/rate-analyses/[id]/apply

**Calculators:**
- `calculations:list` ← GET /api/projects/[id]/calculations
- `calculations:create` ← POST /api/projects/[id]/calculations
- `calculations:get` ← GET /api/calculations/[id]
- `calculations:delete` ← DELETE /api/calculations/[id]
- `calculations:link` ← POST /api/calculations/[id]/link

**Library:**
- `library:search` ← GET /api/library
- `library:create` ← POST /api/library
- `library:get` ← GET /api/library/[id]
- `library:update` ← PATCH /api/library/[id]
- `library:delete` ← DELETE /api/library/[id]
- `library:categories` ← GET /api/library/categories

**Settings:**
- `settings:get` ← GET /api/settings
- `settings:updateUser` ← PATCH /api/settings/user
- `settings:getCompany` ← GET /api/settings/company
- `settings:updateCompany` ← PATCH /api/settings/company

**Scheduling (Phase 2):**
- `calendar:get` ← GET /api/projects/[id]/calendar
- `calendar:update` ← PUT /api/projects/[id]/calendar
- `wbs:list` ← GET /api/projects/[id]/wbs
- `wbs:create` ← POST /api/projects/[id]/wbs
- `wbs:update` ← PATCH /api/wbs/[id]
- `wbs:delete` ← DELETE /api/wbs/[id]
- `activities:list` ← GET /api/projects/[id]/activities
- `activities:create` ← POST /api/projects/[id]/activities
- `activities:get` ← GET /api/activities/[id]
- `activities:update` ← PATCH /api/activities/[id]
- `activities:delete` ← DELETE /api/activities/[id]
- `relationships:list` ← GET /api/activities/[id]/relationships
- `relationships:create` ← POST /api/activities/[id]/relationships
- `relationships:delete` ← DELETE /api/relationships/[id]
- `scheduling:run` ← POST /api/projects/[id]/scheduling/run (calls computeSchedule)
- `scheduling:current` ← GET /api/projects/[id]/scheduling/current

**Document Control (Phase 3):**
- `drawings:list` ← GET /api/projects/[id]/drawings
- `drawings:create` ← POST /api/projects/[id]/drawings
- `drawings:get` ← GET /api/drawings/[id]
- `drawings:update` ← PATCH /api/drawings/[id]
- `drawings:delete` ← DELETE /api/drawings/[id]
- `drawings:revisions` ← GET/POST /api/drawings/[id]/revisions
- (same pattern for submittals, RFIs, correspondence — each with CRUD + status/answer events)
- `documentsDashboard:get` ← GET /api/projects/[id]/documents-dashboard
- `drawings:getDxf` ← GET /api/drawings/[id]/dxf (DXF parse — calls parseDrawing)

**Financials (Phase 4):**
- `payments:list` ← GET /api/projects/[id]/payments
- `payments:create` ← POST /api/projects/[id]/payments
- `payments:get` ← GET /api/payments/[id]
- `payments:update` ← PATCH /api/payments/[id]
- `payments:delete` ← DELETE /api/payments/[id]
- `payments:compute` ← POST /api/payments/[id]/compute (calls computeApplications)
- `variations:list/create/get/update/delete` ← CRUD for variations
- `costLoading:get/create` ← cost loading + validateAllocations
- `progress:list/create` ← progress updates
- `projectDashboard:get` ← GET dashboard data (S-curve, SPI, cards)
- `dailyReports:list/create/get/update/delete` ← daily reports CRUD
- `license:get` ← GET /api/license
- `license:startTrial` ← POST /api/license/start-trial

**File Uploads:**
- `files:upload` ← was POST /api/file-uploads (multipart) — now reads from disk directly
- `files:download` ← returns file blob from disk

**Export:**
- `export:excel` ← was POST /api/exports/excel — returns buffer
- `export:pdf` ← was POST /api/exports/pdf — returns printable HTML or Puppeteer PDF

**IMPORTANT**: For each IPC handler, the logic is:
1. Get the user ID (from electron-store session, not NextAuth)
2. Get services (from the desktop registry — see Step 4)
3. Call the SAME repository method the API route called
4. Write AuditLog (same writeAuditLog function)
5. Return the result

The domain functions (`computeDocumentTotals`, `computeSchedule`, `computeApplications`, etc.) are called UNCHANGED.

---

### STEP 4: Create the Desktop Service Registry

Create `electron/desktop-registry.ts`:

```typescript
// This replaces src/infrastructure/registry.ts for desktop.
// The key difference: uses better-sqlite3 directly instead of Prisma,
// and uses OllamaProvider instead of ZaiAiProvider.

import { Database } from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import Store from "electron-store";

// Desktop database: stored in userData directory (OS-specific)
const userDataPath = app.getPath("userData");
const dbPath = path.join(userDataPath, "techoffice.db");

// If migrating from web version, copy the SQLite file
if (!fs.existsSync(dbPath)) {
  // First run — create empty DB, run migrations
}

const db = new Database(dbPath);

// Desktop service container
// Uses SqliteXxxRepository (better-sqlite3) instead of PrismaXxxRepository
// BUT the interfaces (IProjectRepository, IBoQRepository, etc.) are IDENTICAL
import { PrismaProjectRepository } from "./infrastructure/persistence/prisma/project-repository";
// OR: create SqliteProjectRepository that implements the same interface using better-sqlite3
// For Phase 1 of desktop conversion: KEEP Prisma — it works in Electron!
// (Prisma + SQLite works fine in Electron main process)

// AI provider: use OllamaProvider (local, offline) or ZaiAiProvider (cloud)
import { OllamaProvider } from "./services/ai/ollama-provider";
// OR keep ZaiAiProvider if the user has an API key

export function getDesktopServices() {
  // Return the same Services interface as the web version
  // Just wired with desktop-specific implementations
}
```

**IMPORTANT DECISION**: For the initial desktop conversion, **keep Prisma**. Prisma works in Electron's main process (it's just a Node.js process). You don't need to rewrite the repositories — the Prisma implementations (`PrismaProjectRepository`, `PrismaBoQRepository`, etc.) work as-is. Only swap them to `better-sqlite3` direct if you want to avoid the Prisma engine binary in the installer.

---

### STEP 5: Create the Desktop AI Provider (Ollama)

Create `src/services/ai/ollama-provider.ts`:

```typescript
import type { IAiProvider, AiCompletionRequest, AiCompletionResponse } from "./types";

/**
 * OllamaAiProvider — runs AI fully offline via Ollama (localhost:11434).
 *
 * Per Constitution §3: "AI proposes, engineer approves" — the interface
 * is identical to ZaiAiProvider. Only the transport changes (HTTP to
 * localhost instead of z-ai-web-dev-sdk).
 *
 * User installs Ollama (https://ollama.ai) + pulls a model (e.g. llama3).
 * The app detects Ollama at startup; if not running, AI features are hidden
 * (degrade silently — no errors).
 */
export class OllamaAiProvider implements IAiProvider {
  readonly name = "ollama";
  private ollamaUrl: string;
  private model: string;

  constructor(config: { url?: string; model?: string }) {
    this.ollamaUrl = config.url ?? "http://localhost:11434";
    this.model = config.model ?? "llama3";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.ollamaUrl}/api/tags`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const resp = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model ?? this.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
        },
      }),
    });

    if (!resp.ok) throw new Error(`Ollama error: ${resp.statusText}`);

    const data = await resp.json();
    return {
      content: data.message?.content ?? "",
      model: data.model ?? this.model,
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      proposal: true, // ALWAYS true — Constitution §3
    };
  }
}
```

---

### STEP 6: Create the Desktop Auth (License-Based, Not NextAuth)

Create `electron/desktop-auth.ts`:

```typescript
import Store from "electron-store";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// Desktop auth: license file (Ed25519-signed JSON) instead of NextAuth sessions.
// Per SPEC 5 §2: the license file contains:
// { lic, customer, plan, modules, expires, machine, issued }

interface DesktopSession {
  userId: string;
  email: string;
  name: string;
  licenseVerified: boolean;
  trialStart: string | null;
}

const store = new Store<{ session: DesktopSession | null }>({
  defaults: { session: null },
});

// Machine fingerprint (for license binding)
function getMachineFingerprint(): string {
  const os = require("os");
  const cpus = os.cpus();
  const networkInterfaces = os.networkInterfaces();
  const mac = Object.values(networkInterfaces)
    .flat()
    .find((iface) => iface && !iface.internal && iface.mac !== "00:00:00:00:00:00")?.mac;
  return crypto
    .createHash("sha256")
    .update(`${os.hostname()}-${mac}-${cpus[0]?.model}`)
    .digest("hex")
    .substring(0, 32);
}

export function getCurrentUserId(): string | null {
  return store.get("session")?.userId ?? null;
}

export function isLicenseValid(): boolean {
  // Read the .lic file from userData
  // Verify Ed25519 signature with embedded public key
  // Check expiry + machine fingerprint
  // Return true/false
  // If invalid → read-only mode (data never hostage per Constitution §3)
}

export function startTrial(): void {
  // Create a trial session (30 days)
  const trialStart = new Date().toISOString();
  store.set("session", {
    userId: crypto.randomUUID(),
    email: "trial@local",
    name: "Trial User",
    licenseVerified: true,
    trialStart,
  });
}
```

---

### STEP 7: Create the Desktop Database Layer

The web app uses Prisma + SQLite at `db/custom.db`. For desktop:

**Option A (Simplest — RECOMMENDED for first conversion):**
- Keep Prisma as-is. It works in Electron's main process (Node.js).
- Change `DATABASE_URL` to point to the OS userData directory:
  ```
  DATABASE_URL=file:${app.getPath('userData')}/techoffice.db
  ```
- Run `prisma db push` on first launch (if DB doesn't exist)
- Run `prisma db seed` on first launch

**Option B (If you want to avoid the Prisma engine binary in the installer):**
- Replace Prisma with `better-sqlite3` direct calls
- Create `SqliteProjectRepository`, `SqliteBoQRepository`, etc. — all implementing the SAME interfaces from `src/domain/repositories/`
- This is more work but produces a smaller installer

**Use Option A first.** Ship it. Optimize later.

---

### STEP 8: Update the React App to Use IPC Instead of fetch()

The React components currently call `fetch('/api/projects')`. In Electron, they should call `window.electronAPI.invoke('projects:list', params)`.

Create `src/lib/desktop-fetch.ts`:

```typescript
// Detects if running in Electron (window.electronAPI exists) or web (fetch).
// This lets the SAME React components work in both environments.

declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, data?: unknown) => Promise<unknown>;
    };
  }
}

export async function apiRequest<T>(
  channel: string,
  data?: unknown,
): Promise<T> {
  // Electron: use IPC
  if (typeof window !== "undefined" && window.electronAPI) {
    return window.electronAPI.invoke(channel, data) as Promise<T>;
  }
  
  // Web: use fetch (backward compatible — the web app still works)
  // Parse the channel to determine HTTP method + URL
  // This is a simplified version — the real implementation maps
  // channel names to HTTP routes
  const [domain, action] = channel.split(":");
  // ... mapping logic ...
  const resp = await fetch(url, { method, body });
  return resp.json();
}
```

Then update the views to use `apiRequest` instead of direct `fetch`:
- `src/components/views/dashboard-view.tsx` — change `fetchJson("/api/projects")` to `apiRequest("projects:list")`
- Same for ALL other views

**This is the biggest mechanical change** — there are ~28 views that call `fetch`. Each needs to switch to `apiRequest`. The logic stays identical; only the transport changes.

---

### STEP 9: Create the Build Configuration

Create `electron-builder.yml`:

```yaml
appId: com.techoffice.app
productName: TechOffice
copyright: Copyright © 2026 TechOffice

directories:
  output: dist
  buildResources: build

files:
  - "out/**/*"
  - "electron/**/*"
  - "src/domain/**/*"
  - "src/shared/**/*"
  - "src/services/**/*"
  - "src/infrastructure/**/*"
  - "prisma/**/*"
  - "node_modules/**/*"
  - "package.json"

win:
  target:
    - nsis
  icon: build/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true

linux:
  target:
    - AppImage
    - deb
  icon: build/icon.png
  category: Office

mac:
  target:
    - dmg
  icon: build/icon.icns
```

---

### STEP 10: Update package.json Scripts

Add to `package.json`:

```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron:dev": "concurrently \"next dev\" \"wait-on http://localhost:3000 && electron .\"",
    "electron:build": "next build && electron-builder",
    "electron:dist": "next build && electron-builder --publish never"
  }
}
```

---

### STEP 11: File Upload Adaptation

The web app uses multipart form upload (`POST /api/file-uploads`). In Electron:

```typescript
// Desktop: use native file dialog instead of HTML file input
ipcMain.handle("files:upload", async (event, { filePath }) => {
  // Read file directly from disk (no multipart needed)
  const buffer = fs.readFileSync(filePath);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  
  // Store in userData/uploads/<sha256>
  const uploadDir = path.join(app.getPath("userData"), "uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, sha256), buffer);
  
  // Create FileUpload row in DB (same as web version)
  const fileUpload = await db.fileUpload.create({
    data: {
      uploaderUserId: getCurrentUserId(),
      filename: sha256,
      originalName: path.basename(filePath),
      mimeType: mime.lookup(filePath) || "application/octet-stream",
      sizeBytes: buffer.length,
      storagePath: path.join(uploadDir, sha256),
      sha256,
    },
  });
  
  return fileUpload;
});
```

---

### STEP 12: PDF Export Adaptation

The web app returns printable HTML (user does Ctrl+P). In Electron:

```typescript
// Desktop: use Electron's built-in PDF generation (WebContents.printToPDF)
ipcMain.handle("export:pdf", async (event, { html, savePath }) => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const pdf = await win.webContents.printToPDF({
    marginsType: 0,
    printBackground: true,
    pageSize: "A4",
  });
  win.close();
  
  if (savePath) {
    fs.writeFileSync(savePath, pdf);
    return { saved: true, path: savePath };
  }
  return { pdf: pdf.toString("base64") };
});
```

This gives REAL PDF files — no Ctrl+P needed. The Electron `printToPDF` uses Chromium's built-in PDF engine.

---

### STEP 13: License File Verification (Ed25519)

Per SPEC 5 §2, the desktop app uses Ed25519-signed license files:

```typescript
import * as crypto from "crypto";

// The public key is embedded in the app source (safe to distribute)
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
<your-ed25519-public-key-here>
-----END PUBLIC KEY-----`;

function verifyLicense(licenseFile: string, signature: string): boolean {
  try {
    const verify = crypto.verify(
      null, // Ed25519 doesn't use a digest algorithm
      Buffer.from(licenseFile),
      PUBLIC_KEY,
      Buffer.from(signature, "hex"),
    );
    return verify;
  } catch {
    return false;
  }
}

// On startup:
// 1. Read .lic file from userData
// 2. Verify signature
// 3. Check expiry + machine fingerprint
// 4. If invalid → read-only mode (data never hostage)
// 5. If trial → check 30-day window
```

---

### STEP 14: Test Everything

```bash
# Run the existing tests — they should ALL still pass
# (domain logic is unchanged)
bun run test
bun run test:domain
bun run lint
bun run typecheck

# Run the Electron dev mode
bun run electron:dev
# → A desktop window should open showing the app

# Build the installers
bun run electron:dist
# → dist/ folder should contain:
#   - TechOffice Setup x.x.x.exe (Windows installer)
#   - TechOffice-x.x.x.AppImage (Linux)
#   - TechOffice-x.x.x.dmg (macOS — if building on macOS)
```

---

## WHAT MUST NOT CHANGE

### 1. Domain Layer (`src/domain/`) — UNTOUCHED
- All calculation logic (BoQ totals, CPM engine, payments, earned value, DXF parser)
- All golden tests (338 assertions — the law)
- All business rules (BR-1..13, BR-P1..16, BR-DC1..10, BR-DW1..5, BR-IP1..12, BR-CS1..7)

### 2. Shared Layer (`src/shared/`) — UNTOUCHED
- All zod schemas
- All entity types
- All i18n strings (en.json, ar.json)

### 3. Repository Interfaces (`src/domain/repositories/`) — UNTOUCHED
- `IProjectRepository`, `IBoQRepository`, `IItemLibraryRepository`, etc.
- The desktop uses the SAME interfaces — just different implementations

### 4. React Components (`src/components/`) — MOSTLY UNTOUCHED
- All 28 view components stay (they're React — works in Electron renderer)
- Only the data-fetching layer changes (fetch → IPC)
- shadcn/ui components stay
- Linear design language stays

### 5. Constitution Rules — MUST BE ENFORCED
- Layer purity (eslint `no-restricted-imports`)
- Golden tests are law (never edit expected values)
- AI proposes, engineer approves (IAiProvider returns `proposal: true`)
- Data never hostage (expired license = read-only, not locked out)
- Bilingual EN/AR with RTL
- License gate (no GPL/AGPL packages)

---

## ESTIMATED EFFORT

| Step | Effort | Risk |
|------|--------|------|
| Steps 1-3 (Electron scaffold) | ~4 hours | Low — boilerplate |
| Step 4 (desktop registry) | ~2 hours | Low — keep Prisma |
| Step 5 (Ollama provider) | ~1 hour | Low — one file |
| Step 6 (desktop auth) | ~4 hours | Medium — Ed25519 license |
| Step 7 (database) | ~1 hour | Low — just change path |
| Step 8 (fetch → IPC) | ~8 hours | Medium — 28 views, mechanical |
| Step 9-10 (build config) | ~2 hours | Low — config files |
| Step 11-12 (file upload + PDF) | ~4 hours | Low — Electron APIs |
| Step 13 (license verification) | ~4 hours | Medium — crypto |
| Step 14 (testing) | ~4 hours | — |
| **Total** | **~34 hours** | |

~85% of the codebase ports verbatim. Only the outermost adapter layer (API routes → IPC handlers, fetch → IPC, NextAuth → license file) changes.

---

## GOLDEN RULES FOR THE DESKTOP AGENT

1. **Never modify `src/domain/`** — the calculation law is frozen and verified by 338 golden test assertions.
2. **Never modify `tests/golden/`** — the golden test expected values are the law. If a test fails, the code is wrong.
3. **Never install GPL/AGPL packages** — license gate is enforced. Check every dependency.
4. **Keep `src/shared/` pure** — no platform imports in schemas or entity types.
5. **Keep the React components** — they render in Electron's renderer process identically to the browser.
6. **Keep the Linear design language** — dark canvas (#010102), lavender accent (#5e6ad2), hairline borders.
7. **Keep bilingual EN/AR** — all i18n strings stay, RTL works in Electron.
8. **Data is never hostage** — if the license is invalid, the app opens in read-only mode (view + export only, no edit).
9. **Run `bun run test` after EVERY change** — all 590 tests must continue to pass.
10. **Run `bun run test:domain` after EVERY change** — the isomorphic compile test must pass (domain layer has zero platform imports).

---

## VERIFICATION CHECKLIST (Final)

Before declaring the desktop app "done":

- [ ] `bun run test` — all 590 tests pass (338 golden + 252 unit/integration/perf)
- [ ] `bun run test:domain` — isomorphic compile passes (domain layer pure)
- [ ] `bun run lint` — 0 errors
- [ ] `bun run typecheck` — 0 errors
- [ ] `bun run electron:dev` — desktop window opens, all 28 views work
- [ ] Create project → add BoQ items → inline edit → live totals update
- [ ] Run CPM schedule → Gantt chart renders
- [ ] Create drawing → upload DXF → viewer renders
- [ ] Create payment application → compute → IPC math correct
- [ ] License verification: valid license → full access
- [ ] License verification: no license → 30-day trial
- [ ] License verification: expired → read-only (data viewable + exportable)
- [ ] `bun run electron:dist` → produces `.exe` (Windows) + `.AppImage` (Linux)
- [ ] Install on a clean Windows machine → app launches
- [ ] Install on a clean Linux machine → app launches
- [ ] All data stored in OS userData directory (not in the app folder)
- [ ] Auto-update mechanism works (electron-updater)
