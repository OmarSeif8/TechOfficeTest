"use client";

/**
 * Providers — client-side provider tree for the TechOffice web app.
 *
 * WO-W-15: TanStack Query + Zustand infrastructure.
 *
 * This component is imported by `src/app/layout.tsx` (WO-W-14) and wrapped
 * around the children of the root layout. It establishes the React context
 * for TanStack Query (`QueryClientProvider`).
 *
 * Zustand stores (`@/lib/stores/ui-store`, `@/lib/stores/boq-editor-store`)
 * do NOT need a provider — they expose plain React hooks (`useUIStore`,
 * `useBoQEditorStore`) that components import directly. This is by design:
 * Zustand stores are singletons over a module-scoped mutable state, so they
 * work without a React context.
 *
 * Design notes (per SPEC_PHASE1_BOQ_WEB §3 F3 BoQ Builder):
 *   - BoQ data changes frequently during editing. A short `staleTime` (30s)
 *     keeps the cache warm enough to make 5,000-item lists feel instant
 *     while still picking up server-side edits from another tab within a
 *     reasonable window.
 *   - `refetchOnWindowFocus: false` — refetching on every focus switch is
 *     disruptive when the engineer is mid-edit in an inline cell. Invalidation
 *     is driven by explicit `queryClient.invalidateQueries()` calls in
 *     mutation `onSuccess` handlers instead.
 *   - `retry: 1` for queries — transient network blips get one retry, but
 *     we don't hammer a failing endpoint.
 *   - `retry: 0` for mutations — never retry a non-GET. A retried PATCH
 *     could double-apply a delta (e.g. increment qty twice) or race with
 *     optimistic-concurrency version checks.
 *
 * This file is a Client Component ("use client"). It must NOT import any
 * server-only code (no `next/server`, no `@/lib/db`, no `@prisma/client`).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // `useState(() => ...)` ensures the QueryClient is created exactly once per
  // browser session (and per SSR render). Recreating it on every render would
  // wipe the cache.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30s — BoQ data changes frequently during editing; cache stays warm
            // long enough for instant re-renders, short enough to pick up
            // server-side edits from another tab.
            staleTime: 30 * 1000,
            // 5 min — keep inactive queries in memory for back/forward nav.
            gcTime: 5 * 60 * 1000,
            // 1 retry — handle transient blips without hammering.
            retry: 1,
            // Don't refetch on focus — disruptive during inline editing.
            // Invalidation is explicit (mutation onSuccess → invalidateQueries).
            refetchOnWindowFocus: false,
          },
          mutations: {
            // Never retry mutations — could double-write or race with
            // optimistic-concurrency version checks.
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
