/**
 * GET    /api/items/[id] — fetch single item.
 * PATCH  /api/items/[id] — update item with optimistic concurrency. After a
 *          successful update, recompute document totals via
 *          `computeDocumentTotals` and return them alongside the updated item
 *          (the UI needs live totals — see BR-WEB-12, pure domain functions
 *          never touch the request/response cycle, so totals are computed in
 *          the route handler using the domain function).
 * DELETE /api/items/[id] — soft-delete item.
 *
 * BR-WEB-5: every route verifies the item's project is owned by the session
 *           user. Missing-or-not-owned → 404 (no existence leak).
 * BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * BR-WEB-11: PATCH body is zod-validated.
 */

import {
  withErrorHandler,
  json,
  notFound,
  conflict,
  noContent,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { db } from "@/lib/db";
import {
  verifyProjectOwnership,
  loadDocumentTree,
  computeTreeTotals,
} from "@/app/api/_lib/boq-helpers";
import { BoQItemUpdateSchema } from "@/shared/schemas/boq/document";

// ─── GET single item ──────────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const services = getServices();
    const item = await services.boq.getItem(id);
    if (!item) return notFound("Item not found");

    const project = await verifyProjectOwnership(item.projectId, userId);
    if (!project) return notFound("Item not found");

    return json({ item });
  },
);

// ─── PATCH item (returns live totals) ────────────────────────────────────

export const PATCH = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const services = getServices();
    const existing = await services.boq.getItem(id);
    if (!existing) return notFound("Item not found");

    const project = await verifyProjectOwnership(existing.projectId, userId);
    if (!project) return notFound("Item not found");

    const body = await req.json();
    const input = BoQItemUpdateSchema.parse(body);

    const result = await services.boq.updateItem(id, input);

    if (result.kind === "not_found") return notFound("Item not found");
    if (result.kind === "conflict") {
      return conflict(
        "Item was modified by another user. Please reload and try again.",
        result.currentVersion,
      );
    }

    await writeAuditLog({
      action: "boq.item.update",
      entityType: "BoQItem",
      entityId: id,
      beforeJson: existing,
      afterJson: result.item,
    });

    // Recompute live document totals — the UI shows the running subtotal on
    // every edit. We re-read the full tree (sections + items) from the DB
    // to ensure we have the freshest state (other concurrent edits included).
    const tree = await loadDocumentTree(existing.documentId);
    if (!tree) {
      // Document was concurrently deleted — return just the item. The UI
      // will handle the next navigation gracefully.
      return json({ item: result.item });
    }
    const totals = computeTreeTotals(
      tree.document,
      tree.sections,
      tree.items,
    );

    return json({ item: result.item, totals });
  },
);

// ─── DELETE item (soft-delete) ───────────────────────────────────────────

export const DELETE = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const services = getServices();
    const existing = await services.boq.getItem(id);
    if (!existing) return notFound("Item not found");

    const project = await verifyProjectOwnership(existing.projectId, userId);
    if (!project) return notFound("Item not found");

    const url = new URL(req.url);
    const versionParam = url.searchParams.get("expectedVersion");
    if (versionParam === null) {
      return conflict(
        "expectedVersion query parameter is required for optimistic concurrency.",
        existing.version,
      );
    }
    const expectedVersion = Number.parseInt(versionParam, 10);
    if (!Number.isFinite(expectedVersion) || expectedVersion < 0) {
      return conflict(
        "expectedVersion must be a non-negative integer.",
        existing.version,
      );
    }

    const result = await services.boq.softDeleteItem(id, expectedVersion);

    if (result.kind === "not_found") return notFound("Item not found");
    if (result.kind === "conflict") {
      return conflict(
        "Item was modified by another user. Please reload and try again.",
        result.currentVersion,
      );
    }

    await writeAuditLog({
      action: "boq.item.delete",
      entityType: "BoQItem",
      entityId: id,
      beforeJson: existing,
    });

    return noContent();
  },
);
