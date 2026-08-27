"use client";

/**
 * Mutation helpers with optimistic-update patterns for TanStack Query.
 *
 * WO-W-15: TanStack Query + Zustand infrastructure.
 *
 * This module is a Client Component (it uses the `useMutation` React hook).
 * It must NOT import any server-only code.
 *
 * ─── Low-level HTTP helpers ──────────────────────────────────────────────
 * `apiPost`, `apiPatch`, `apiDelete` are thin wrappers over `fetch()` used
 * as the `mutationFn` for `useMutation`. They:
 *   - JSON-encode the request body.
 *   - Parse the JSON error envelope (`{ "error": "..." }`) thrown by the
 *     server-side `withErrorHandler` wrapper in `src/lib/api-helpers.ts`.
 *   - Handle 204 No Content (return `undefined` typed as `T`).
 *
 * ─── `useApiMutation` wrapper ────────────────────────────────────────────
 * TanStack Query's `useMutation` already supports optimistic updates via
 * `onMutate` (return a context that `onError` uses to roll back). This hook
 * is a thin convenience wrapper that:
 *   - Surfaces server errors via Sonner toast (`toast.error(...)`).
 *   - Optionally fires a success toast.
 *   - Forwards `onMutate`/`onSuccess`/`onSettled` so callers can implement
 *     optimistic updates + invalidation as normal.
 *
 * Example (optimistic BoQ item rate update):
 *   const qc = useQueryClient();
 *   const mutation = useApiMutation({
 *     mutationFn: (vars: { id: string; rate: string }) =>
 *       apiPatch(`/api/items/${vars.id}`, { rate: vars.rate, version: 0 }),
 *     errorMessage: "Failed to update rate",
 *     onMutate: async (vars) => {
 *       await qc.cancelQueries({ queryKey: queryKeys.items.detail(vars.id) });
 *       const prev = qc.getQueryData<Item>(queryKeys.items.detail(vars.id));
 *       qc.setQueryData<Item>(queryKeys.items.detail(vars.id), (old) =>
 *         old ? { ...old, rate: vars.rate } : old,
 *       );
 *       return { prev };
 *     },
 *     onError: (_err, vars, ctx) => {
 *       if (ctx?.prev) qc.setQueryData(queryKeys.items.detail(vars.id), ctx.prev);
 *     },
 *     onSettled: (data, _err, vars) => {
 *       qc.invalidateQueries({ queryKey: queryKeys.items.detail(vars.id) });
 *       qc.invalidateQueries({ queryKey: queryKeys.documents.detail(data.documentId) });
 *     },
 *   });
 */

import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";

// ─── Low-level HTTP helpers ───────────────────────────────────────────────

/**
 * POST JSON to `url`, return parsed JSON (or `undefined` for 204).
 *
 * Errors: throws `Error("<serverError>")` when the server responds with a
 * `{ "error": "..." }` envelope (the format used by `withErrorHandler` in
 * `src/lib/api-helpers.ts`). Falls back to `HTTP <status>` if no body.
 */
export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * PATCH JSON to `url`, return parsed JSON (or `undefined` for 204).
 * Same error-handling contract as `apiPost`.
 */
export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * DELETE `url` (optionally with a JSON body for params like `version`),
 * return parsed JSON (or `undefined` for 204).
 * Same error-handling contract as `apiPost`.
 */
export async function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: "DELETE" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// ─── `useApiMutation` wrapper ─────────────────────────────────────────────

/**
 * Options for `useApiMutation`. Extends TanStack Query's `UseMutationOptions`
 * with two convenience fields:
 *   - `errorMessage`: string shown on error, OR a function of the thrown
 *     `Error` (e.g. to surface a 409 conflict differently from a 401).
 *     Defaults to `err.message`.
 *   - `successMessage`: optional string shown on success, OR a function of
 *     the returned data (e.g. to include the new entity's id). If omitted,
 *     no success toast fires.
 *
 * All standard `UseMutationOptions` callbacks (`onMutate`, `onSuccess`,
 * `onError`, `onSettled`) are forwarded unchanged, so optimistic-update
 * patterns work exactly as they would with a raw `useMutation`.
 */
export type UseApiMutationOptions<
  TData = unknown,
  TVariables = void,
  TContext = unknown,
> = UseMutationOptions<TData, Error, TVariables, TContext> & {
  errorMessage?: string | ((err: Error) => string);
  successMessage?: string | ((data: TData) => string);
};

/**
 * Thin wrapper over `useMutation` that adds consistent error toasts (and
 * optional success toasts) via Sonner.
 *
 * Callers are still responsible for:
 *   - Calling `queryClient.invalidateQueries(...)` in `onSettled` or
 *     `onSuccess` to refresh the relevant query caches.
 *   - Implementing optimistic updates via `onMutate` (return rollback context)
 *     and `onError` (roll back using the context).
 *
 * See file-level JSDoc for a worked example.
 */
export function useApiMutation<TData, TVariables, TContext = unknown>(
  options: UseApiMutationOptions<TData, TVariables, TContext>,
): UseMutationResult<TData, Error, TVariables, TContext> {
  const { errorMessage, successMessage, ...rest } = options;

  return useMutation<TData, Error, TVariables, TContext>({
    ...rest,
    onError: (err, vars, onMutateResult, context) => {
      const msg =
        typeof errorMessage === "function"
          ? errorMessage(err)
          : (errorMessage ?? err.message);
      toast.error(msg);
      return rest.onError?.(err, vars, onMutateResult, context);
    },
    onSuccess: (data, vars, onMutateResult, context) => {
      if (successMessage !== undefined) {
        const msg =
          typeof successMessage === "function"
            ? successMessage(data)
            : successMessage;
        toast.success(msg);
      }
      return rest.onSuccess?.(data, vars, onMutateResult, context);
    },
  });
}
