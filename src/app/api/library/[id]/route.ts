/**
 * GET    /api/library/[id]   — fetch a single library item
 * PATCH  /api/library/[id]   — update a library item (optimistic concurrency)
 * DELETE /api/library/[id]   — soft-delete a library item (set `deletedAt`)
 *
 * Per BR-WEB-5: all routes require an authenticated session.
 * Per BR-WEB-8: mutations write to AuditLog.
 * Per BR-WEB-11: input validated by zod.
 *
 * The `IItemLibraryRepository` interface exposes only `search`/`countSearch`/
 * `getById`/`create`/`listCategories` (WO-W-2-c) — it does not yet expose
 * `update` or `delete`. Per WO-W-12a constraints ("DO NOT modify existing
 * files"), the PATCH and DELETE handlers here use Prisma directly. This is
 * intentional: a future work order will lift update/delete into the
 * repository interface.
 *
 * Layer purity: top of the stack — App Router route handler. Imports
 * @/lib/api-helpers, @/lib/services, @/lib/auth, @/lib/db, @shared/schemas.
 */

import { NextRequest } from "next/server";
import {
  withErrorHandler,
  json,
  noContent,
  conflict,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { db } from "@/lib/db";
import { LibraryItemUpdateSchema } from "@shared/schemas/library";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/library/[id]
 *
 * Returns the library item by id, or 404 if not found.
 */
export const GET = withErrorHandler(async (_req: NextRequest, ctx: RouteContext) => {
  await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();
  const item = await services.library.getById(id);
  if (!item) throw new Error("NOT_FOUND");
  return json(item);
});

/**
 * PATCH /api/library/[id]
 *
 * Update a library item. Body validated by `LibraryItemUpdateSchema`.
 * Optimistic concurrency: if `expectedVersion` is provided and does not match
 * the current `version` on the row, returns 409 Conflict with the current
 * version in the response body.
 *
 * Returns the updated item with incremented `version`.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, ctx: RouteContext) => {
  await requireUserId();
  const { id } = await ctx.params;
  const body = LibraryItemUpdateSchema.parse(await req.json());
  const { expectedVersion, ...updateFields } = body;
  const services = getServices();

  const existing = await services.library.getById(id);
  if (!existing) throw new Error("NOT_FOUND");

  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    return conflict("Version mismatch — the item was modified by another user", existing.version);
  }

  const updated = await db.itemLibrary.update({
    where: { id },
    data: {
      ...updateFields,
      version: { increment: 1 },
    },
  });

  await writeAuditLog({
    action: "update",
    entityType: "ItemLibrary",
    entityId: id,
    beforeJson: existing,
    afterJson: updated,
  });

  return json(updated);
});

/**
 * DELETE /api/library/[id]
 *
 * Soft-delete a library item by setting `deletedAt = now()`. Returns 204.
 * The row is retained in the database for audit history.
 */
export const DELETE = withErrorHandler(async (_req: NextRequest, ctx: RouteContext) => {
  await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const existing = await services.library.getById(id);
  if (!existing) throw new Error("NOT_FOUND");

  await db.itemLibrary.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    action: "delete",
    entityType: "ItemLibrary",
    entityId: id,
    beforeJson: existing,
  });

  return noContent();
});
