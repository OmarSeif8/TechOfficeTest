/**
 * GET  /api/sections/[id]/items — list items in a section.
 * POST /api/sections/[id]/items — create a new item in the section.
 *
 * BR-WEB-5: verify the section's project is owned by the session user.
 * BR-WEB-8: POST writes AuditLog.
 * BR-WEB-11: POST body is zod-validated.
 *
 * `BoQItemCreateInput` requires `documentId` + `projectId` (denormalised on
 * BoQItem). The route handler resolves them from the parent section so
 * callers only need to pass the item-specific fields (`descriptionEn`,
 * `quantity`, `rate`, etc.) plus `sectionId` (which is also re-validated
 * against the URL).
 */

import {
  withErrorHandler,
  json,
  created,
  notFound,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { db } from "@/lib/db";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { BoQItemCreateSchema } from "@/shared/schemas/boq/document";

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const section = await db.boQSection.findUnique({
      where: { id, deletedAt: null },
    });
    if (!section) return notFound("Section not found");

    const project = await verifyProjectOwnership(section.projectId, userId);
    if (!project) return notFound("Section not found");

    const services = getServices();
    const items = await services.boq.listItems(id);
    return json({ items });
  },
);

// ─── POST create ─────────────────────────────────────────────────────────

export const POST = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const section = await db.boQSection.findUnique({
      where: { id, deletedAt: null },
    });
    if (!section) return notFound("Section not found");

    const project = await verifyProjectOwnership(section.projectId, userId);
    if (!project) return notFound("Section not found");

    const body = await req.json();
    const input = BoQItemCreateSchema.parse({
      ...body,
      sectionId: id,
      documentId: section.documentId,
      projectId: section.projectId,
    });

    const services = getServices();
    const item = await services.boq.createItem(input);

    await writeAuditLog({
      action: "boq.item.create",
      entityType: "BoQItem",
      entityId: item.id,
      afterJson: item,
    });

    return created(item);
  },
);
