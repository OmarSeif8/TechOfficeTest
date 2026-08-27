/**
 * Zustand store for the BoQ Builder editor's unsaved / in-flight UI state.
 *
 * WO-W-15: TanStack Query + Zustand infrastructure.
 *
 * Per SPEC_PHASE1_BOQ_WEB §3 F3 BoQ Builder:
 *   - "Editing any qty/rate updates all totals without manual refresh."
 *   - "A BoQ with 5,000 items scrolls and recalculates without visible lag
 *      (< 300 ms recompute)."
 *
 * This is achieved by:
 *   1. Storing the in-flight inline edit locally (this store) so the input
 *      feels instant — no network round-trip per keystroke.
 *   2. Debouncing the PATCH to the server (2s after last keystroke —
 *      BR-WEB-6 autosave).
 *   3. On PATCH success, invalidating the `items.detail(id)` and
 *      `documents.detail(documentId)` query keys so the totals recompute via
 *      TanStack Query's cache (which is the canonical source for displayed
 *      totals).
 *
 * ─── Pending edits shape ─────────────────────────────────────────────────
 * `pendingEdits[itemId]` holds the user's un-flushed edits for one BoQ item.
 * Each keystroke updates this in place. The 2s debounce watcher (in the BoQ
 * Builder screen, WO-W-14+) reads the diff, sends the PATCH, and calls
 * `clearPendingEdit(itemId)` on success.
 *
 * The fields are intentionally `string` (not `number`) — the engineer is
 * typing into a text input, and intermediate states like "1." or "2." are
 * not valid numbers. The server-side zod schema validates the final string
 * before persistence.
 *
 * ─── Drag state ──────────────────────────────────────────────────────────
 * `draggingItemId` tracks which row is being dragged via `@dnd-kit/sortable`.
 * Used to apply a CSS class (opacity, border highlight) to the dragged row
 * and to disable inline editing while a drag is in progress (otherwise the
 * input could grab focus from the drag handle).
 *
 * This file is client-safe. It imports `zustand` only.
 */

import { create } from "zustand";

/**
 * The set of fields on a BoQ item that can be inline-edited.
 * Keyed by field name (string) for ergonomics — the BoQ Builder screen
 * passes the field name from the input's `name` attribute.
 */
export interface PendingItemEdits {
  quantity?: string;
  rate?: string;
  descriptionEn?: string;
  descriptionAr?: string;
}

interface BoQEditorState {
  // ─── Inline edit focus ──────────────────────────────────────────────────
  // The id of the item whose cell is currently focused for inline editing.
  // Used by the screen to render a focus ring on the active row and to
  // handle Escape/Enter navigation between rows.
  editingItemId: string | null;
  setEditingItem: (id: string | null) => void;

  // ─── Pending inline edits ──────────────────────────────────────────────
  // Keyed by item id. Each value is the partial delta the user has typed
  // since the last successful PATCH. Flushed by a 2s debounce (BR-WEB-6).
  pendingEdits: Record<string, PendingItemEdits>;
  setPendingEdit: (itemId: string, field: string, value: string) => void;
  clearPendingEdit: (itemId: string) => void;
  clearAllPendingEdits: () => void;

  // ─── Drag state ────────────────────────────────────────────────────────
  // The id of the item being dragged via @dnd-kit/sortable. `null` when no
  // drag is in progress.
  draggingItemId: string | null;
  setDraggingItem: (id: string | null) => void;
}

export const useBoQEditorStore = create<BoQEditorState>((set) => ({
  editingItemId: null,
  setEditingItem: (id) => set({ editingItemId: id }),

  pendingEdits: {},
  setPendingEdit: (itemId, field, value) =>
    set((s) => ({
      pendingEdits: {
        ...s.pendingEdits,
        [itemId]: { ...s.pendingEdits[itemId], [field]: value },
      },
    })),
  clearPendingEdit: (itemId) =>
    set((s) => {
      const next = { ...s.pendingEdits };
      delete next[itemId];
      return { pendingEdits: next };
    }),
  clearAllPendingEdits: () => set({ pendingEdits: {} }),

  draggingItemId: null,
  setDraggingItem: (id) => set({ draggingItemId: id }),
}));
