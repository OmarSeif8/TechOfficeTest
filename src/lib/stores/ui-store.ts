/**
 * Zustand store for cross-screen UI state.
 *
 * WO-W-15: TanStack Query + Zustand infrastructure.
 *
 * Zustand stores are plain React hooks — no provider needed. Components
 * import `useUIStore` directly:
 *
 *   const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
 *   const toggleSidebar = useUIStore((s) => s.toggleSidebar);
 *
 * Or with a shallow selector (preferred for components that read multiple
 * fields — avoids re-rendering when unrelated fields change):
 *
 *   import { useShallow } from "zustand/react/shallow";
 *   const { sidebarCollapsed, toggleSidebar } = useUIStore(useShallow((s) => ({
 *     sidebarCollapsed: s.sidebarCollapsed,
 *     toggleSidebar: s.toggleSidebar,
 *   })));
 *
 * Persistence: Phase 1 stores UI state in memory only. Phase 2 should
 * persist `sidebarCollapsed`, `currentProjectId`, `currentDocumentId` to
 * `localStorage` via the `persist` middleware (zustand/middleware). The
 * `commandPaletteOpen` flag is intentionally NOT persisted — it should
 * default to closed on every page load.
 *
 * This file is client-safe. It imports `zustand` only (no React, no Next.js,
 * no Prisma). It is consumed by Client Components.
 */

import { create } from "zustand";

interface UIState {
  // ─── Sidebar collapse (desktop) ──────────────────────────────────────────
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // ─── Active view (SPA view-switching) ────────────────────────────────────
  // Per environment constraint: only the / route exists. The sidebar switches
  // between views via this state (no URL routing). Values: "dashboard" |
  // "projects" | "boq" | "calculators" | "library" | "import" | "export" |
  // "settings" | "scheduling" | "wbs" | "activities" | "calendar" | "gantt" |
  // "drawings" | "submittals" | "rfis" | "correspondence" | "documents-dashboard".
  currentView: ViewName;
  setCurrentView: (view: ViewName) => void;

  // ─── Current active project ─────────────────────────────────────────────
  currentProjectId: string | null;
  setCurrentProject: (id: string | null) => void;

  // ─── Current active BoQ document ────────────────────────────────────────
  currentDocumentId: string | null;
  setCurrentDocument: (id: string | null) => void;

  // ─── Command palette (Cmd+K) ────────────────────────────────────────────
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export type ViewName =
  | "dashboard"
  | "projects"
  | "boq"
  | "calculators"
  | "library"
  | "import"
  | "export"
  | "settings"
  // Phase 2 — Scheduling (CPM engine) views
  | "scheduling"
  | "wbs"
  | "activities"
  | "calendar"
  | "gantt"
  // Phase 3A — Document Control views (Group Q)
  | "drawings"
  | "submittals"
  | "rfis"
  | "correspondence"
  | "documents-dashboard"
  // Phase 3B — Drawing Viewer (Group S)
  | "dxf-viewer"
  // Phase 4 — Financials (Groups U+V+W)
  | "payments"
  | "variations"
  | "cost-loading"
  | "progress-update"
  | "project-dashboard"
  | "daily-report"
  | "monthly-report"
  // Phase 5 — Commercial (subscription management)
  | "subscription";

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  currentView: "dashboard",
  setCurrentView: (view) => set({ currentView: view }),

  currentProjectId: null,
  setCurrentProject: (id) => set({ currentProjectId: id }),

  currentDocumentId: null,
  setCurrentDocument: (id) => set({ currentDocumentId: id }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
