/**
 * POST /api/items/[id]/reorder — reorder items within a section.
 *
 * The request body is `{ orderedItemIds: string[] }` — the full ordered list
 * of item ids in the target section. The anchor item id (from the URL) is
 * used to determine which section the items belong to (the route handler
 * loads that section and verifies all the passed ids actually live there).
 *
 * Implementation: IBoQRepository (WO-W-2-b) exposes `reorderSections` but NOT
 * `reorderItems`. The route handler writes sortOrder for each item in a
 * single Prisma `$transaction` — atomic, so partial reorders are never
 * observable. sortOrder values are written as the array index × 10 (gives
 * headroom for future insertions without rewriting the whole list).
 *
 * BR-WEB-5: verify the section's project is owned by the session user.
 * BR-WEB-8: writes AuditLog entry.
 * BR-WEB-11: body is zod-validated.
 */

import {
  withErrorHandler,
  json,
  notFound,
  writeAuditLog,
  badRequest,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { BoQItemReorderSchema } from "@/shared/schemas/boq/document";

export const POST = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    // The URL's [id] is the anchor item — its section is the target section
    // whose items are being reordered.
    const anchor = await db.boQItem.findUnique({
      where: { id, deletedAt: null },
    });
    if (!anchor) return notFound("Item not found");

    const project = await verifyProjectOwnership(anchor.projectId, userId);
    if (!project) return notFound("Item not found");

    const body = await req.json();
    const input = BoQItemReorderSchema.parse(body);

    // Verify every id in the request body lives in the same section.
    // This is a sanity check — the caller should already know the section,
    // but we don't want a buggy client to silently rewrite sortOrder on
    // items in other sections.
    const targetSectionId = anchor.sectionId;
    const ids = input.orderedItemIds;
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      return badRequest("orderedItemIds contains duplicates.");
    }
    if (!uniqueIds.has(id)) {
      return badRequest(
        "The anchor item id must be present in orderedItemIds.",
      );
    }

    // Fetch the items currently in this section to make sure every id in
    // the reorder list is actually there.
    const liveItems = await db.boQItem.findMany({
      where: { sectionId: targetSectionId, deletedAt: null },
      select: { id: true },
    });
    const liveIds = new Set(liveItems.map((i) => i.id));
    for (const itemId of ids) {
      if (!liveIds.has(itemId)) {
        return badRequest(
          `Item ${itemId} is not in the target section or does not exist.`,
        );
      }
    }
    // The caller may pass fewer items than the section has (e.g., a partial
    // drag-and-drop reorder). We accept the input as the full truth: the
    // items named in `orderedItemIds` get sortOrder = index × 10; items NOT
    // in the list are left untouched. This matches typical UI drag-and-drop
    // semantics where the client sends the visible/affected subset.

    await db.$transaction(
      ids.map((itemId, index) =>
        db.boQItem.update({
          where: { id: itemId },
          data: { sortOrder: index * 10 },
        }),
      ),
    );

    await writeAuditLog({
      action: "boq.item.reorder",
      entityType: "BoQItem",
      entityId: targetSectionId,
      afterJson: { orderedItemIds: ids },
    });

    return json({ ok: true, sectionId: targetSectionId });
  },
);
