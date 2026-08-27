/**
 * POST /api/items/[id]/move — move an item to a different section.
 *
 * Request body: `{ toSectionId: string, newSortOrder: number }`.
 *
 * The destination section must belong to the same document as the item being
 * moved (a BoQItem's `documentId` is denormalised on the row; if the
 * destination section is in a different document, we'd be cross-linking
 * sections and documents — that's a structural violation of the schema's
 * tree semantics). The route handler verifies this.
 *
 * Delegates to `services.boq.moveItem` (WO-W-2-b) which writes `sectionId`
 * + `sortOrder` in a single atomic update.
 *
 * BR-WEB-5: verify the item's project is owned by the session user.
 *           Also verify the destination section's project matches (defence
 *           in depth — both checks must pass).
 * BR-WEB-8: writes AuditLog entry.
 * BR-WEB-11: body is zod-validated.
 */

import {
  withErrorHandler,
  json,
  notFound,
  badRequest,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { db } from "@/lib/db";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { BoQItemMoveSchema } from "@/shared/schemas/boq/document";

export const POST = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const item = await db.boQItem.findUnique({
      where: { id, deletedAt: null },
    });
    if (!item) return notFound("Item not found");

    const project = await verifyProjectOwnership(item.projectId, userId);
    if (!project) return notFound("Item not found");

    const body = await req.json();
    const input = BoQItemMoveSchema.parse(body);

    const targetSection = await db.boQSection.findUnique({
      where: { id: input.toSectionId, deletedAt: null },
    });
    if (!targetSection) return notFound("Destination section not found");

    // Defence in depth: verify the destination section's project is also
    // owned by the session user.
    const targetProject = await verifyProjectOwnership(
      targetSection.projectId,
      userId,
    );
    if (!targetProject) return notFound("Destination section not found");

    // The destination section must belong to the SAME document as the item
    // being moved. Cross-document moves would break the document tree
    // invariant (BoQItem.documentId must match its section's documentId).
    if (targetSection.documentId !== item.documentId) {
      return badRequest(
        "Cannot move an item to a section in a different document. " +
          "Delete and recreate the item in the target document instead.",
      );
    }

    const services = getServices();
    await services.boq.moveItem(id, input.toSectionId, input.newSortOrder);

    const updated = await services.boq.getItem(id);

    await writeAuditLog({
      action: "boq.item.move",
      entityType: "BoQItem",
      entityId: id,
      beforeJson: {
        fromSectionId: item.sectionId,
        fromSortOrder: item.sortOrder,
      },
      afterJson: {
        toSectionId: input.toSectionId,
        newSortOrder: input.newSortOrder,
        item: updated,
      },
    });

    return json({ item: updated });
  },
);
