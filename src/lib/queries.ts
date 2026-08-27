/**
 * Query key factory + fetch helper for TanStack Query.
 *
 * WO-W-15: TanStack Query + Zustand infrastructure.
 *
 * This module is client-safe (it uses `fetch()` which is available in both
 * browser and Next.js server runtimes, but it never imports any server-only
 * code). It is imported by Client Components (screens in Group H) that need
 * to read server state.
 *
 * ─── Query key factory ────────────────────────────────────────────────────
 * Following TanStack Query's recommended hierarchical key factory pattern
 * (https://tkdodo.eu/blog/effective-react-query-keys#use-query-key-factories).
 *
 * The hierarchy is `["entity", "operation", ...args]` so that invalidation
 * can target any granularity:
 *   - `queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })`
 *       → refetch every project query in the cache.
 *   - `queryClient.invalidateQueries({ queryKey: queryKeys.documents.list(pid) })`
 *       → refetch only the document list for one project.
 *   - `queryClient.invalidateQueries({ queryKey: queryKeys.items.detail(itemId) })`
 *       → refetch only one item.
 *
 * All keys are declared `as const` so TypeScript infers them as the literal
 * tuple type — this is required for `queryKey` type-safety in `useQuery`.
 *
 * ─── fetchJson helper ────────────────────────────────────────────────────
 * A thin wrapper over the Fetch API used as the `queryFn` for `useQuery`.
 * Throws on non-2xx so TanStack Query can surface the error to the UI.
 */

// ─── Query key factory ────────────────────────────────────────────────────

export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    list: (params?: {
      search?: string;
      limit?: number;
      offset?: number;
    }) => ["projects", "list", params] as const,
    detail: (id: string) => ["projects", "detail", id] as const,
  },

  documents: {
    all: ["documents"] as const,
    list: (projectId: string) => ["documents", "list", projectId] as const,
    detail: (id: string) => ["documents", "detail", id] as const,
  },

  sections: {
    list: (documentId: string) => ["sections", "list", documentId] as const,
  },

  items: {
    list: (sectionId: string) => ["items", "list", sectionId] as const,
    detail: (id: string) => ["items", "detail", id] as const,
  },

  library: {
    all: ["library"] as const,
    search: (params: {
      search?: string;
      categoryId?: string;
      scope?: string;
      limit?: number;
      offset?: number;
    }) => ["library", "search", params] as const,
    categories: ["library", "categories"] as const,
  },

  settings: {
    all: ["settings"] as const,
    user: ["settings", "user"] as const,
    company: ["settings", "company"] as const,
  },

  calculations: {
    list: (projectId: string, type?: string) =>
      ["calculations", "list", projectId, type] as const,
  },

  rateAnalysis: {
    detail: (id: string) => ["rateAnalysis", "detail", id] as const,
    byItem: (itemId: string) => ["rateAnalysis", "byItem", itemId] as const,
  },

  // ─── Phase 2 — Scheduling (CPM engine) ───────────────────────────────────
  // Group M UI views use these keys to fetch + invalidate scheduling data.
  // The hierarchy mirrors the entity structure so invalidation can be scoped
  // at any granularity (whole project's WBS, one activity's relationships,
  // the latest schedule run, etc.).
  wbs: {
    all: ["wbs"] as const,
    list: (projectId: string) => ["wbs", "list", projectId] as const,
  },

  activities: {
    all: ["activities"] as const,
    list: (projectId: string) => ["activities", "list", projectId] as const,
    detail: (id: string) => ["activities", "detail", id] as const,
    relationships: (activityId: string) =>
      ["activities", "relationships", activityId] as const,
  },

  calendar: {
    all: ["calendar"] as const,
    detail: (projectId: string) => ["calendar", "detail", projectId] as const,
  },

  schedule: {
    all: ["schedule"] as const,
    current: (projectId: string) => ["schedule", "current", projectId] as const,
  },

  // ─── Phase 3A — Document Control (drawings, submittals, RFIs, correspondence) ───
  // Group Q UI views use these keys to fetch + invalidate doc-control data.
  // The hierarchy mirrors the entity structure so invalidation can be scoped
  // at any granularity (whole project's drawings, one drawing's revisions,
  // one submittal's events, the dashboard aggregate, etc.).
  drawings: {
    all: ["drawings"] as const,
    list: (projectId: string) => ["drawings", "list", projectId] as const,
    detail: (id: string) => ["drawings", "detail", id] as const,
    revisions: (drawingId: string) =>
      ["drawings", "revisions", drawingId] as const,
    // Phase 3B Group S — parsed DXF (entities + layers + extents) for the viewer
    dxf: (drawingId: string) => ["drawings", "dxf", drawingId] as const,
  },

  submittals: {
    all: ["submittals"] as const,
    list: (projectId: string) => ["submittals", "list", projectId] as const,
    detail: (id: string) => ["submittals", "detail", id] as const,
  },

  rfis: {
    all: ["rfis"] as const,
    list: (projectId: string) => ["rfis", "list", projectId] as const,
    detail: (id: string) => ["rfis", "detail", id] as const,
  },

  correspondence: {
    all: ["correspondence"] as const,
    list: (projectId: string) =>
      ["correspondence", "list", projectId] as const,
    detail: (id: string) => ["correspondence", "detail", id] as const,
    transmittalLines: (correspondenceId: string) =>
      ["correspondence", "transmittal-lines", correspondenceId] as const,
  },

  documentsDashboard: {
    all: ["documents-dashboard"] as const,
    detail: (projectId: string) =>
      ["documents-dashboard", projectId] as const,
  },

  // ─── Phase 4 — Payments / Variations / Progress / Daily Reports ────────
  // Group W UI views use these keys to fetch + invalidate Phase 4 data.
  payments: {
    all: ["payments"] as const,
    list: (projectId: string) => ["payments", "list", projectId] as const,
    detail: (id: string) => ["payments", "detail", id] as const,
  },

  variations: {
    all: ["variations"] as const,
    list: (projectId: string) => ["variations", "list", projectId] as const,
    detail: (id: string) => ["variations", "detail", id] as const,
  },

  costLoading: {
    detail: (projectId: string) => ["cost-loading", projectId] as const,
  },

  progress: {
    all: ["progress"] as const,
    list: (projectId: string) => ["progress", "list", projectId] as const,
  },

  projectDashboard: {
    detail: (projectId: string) => ["project-dashboard", projectId] as const,
  },

  dailyReports: {
    all: ["daily-reports"] as const,
    list: (projectId: string) => ["daily-reports", "list", projectId] as const,
    detail: (id: string) => ["daily-reports", "detail", id] as const,
  },
} as const;

// ─── fetchJson helper ─────────────────────────────────────────────────────

/**
 * Thin wrapper over `fetch()` for use as a TanStack Query `queryFn`.
 *
 * - Throws `Error("HTTP <status>")` on non-2xx so TanStack Query surfaces
 *   the error to the UI (and retries per the QueryClient default).
 * - Returns the parsed JSON body typed as `T` (caller is responsible for
 *   validating the shape — typically via a zod schema in the calling hook).
 *
 * Example:
 *   const { data } = useQuery({
 *     queryKey: queryKeys.projects.detail(id),
 *     queryFn: () => fetchJson<Project>(`/api/projects/${id}`),
 *   });
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  // 204 No Content has no body — return undefined typed as T (caller should
  // type T as `void` for such endpoints).
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
