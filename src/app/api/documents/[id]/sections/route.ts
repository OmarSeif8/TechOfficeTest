/**
 * GET  /api/documents/[id]/sections — list sections in a document.
 * POST /api/documents/[id]/sections — create a new section.
 *
 * BR-WEB-5: verify document's project is owned by the session user.
 * BR-WEB-8: POST writes AuditLog.
 * BR-WEB-11: POST body is zod-validated.
 *
 * The `BoQSectionCreateInput` interface in @domain/repositories/boq-repository
 * requires `projectId` (denormalised on the BoQSection row for fast project-
 * level queries). The route handler injects it from the parent document so
 * callers only need to pass `code`/`titleEn`/`titleAr`/`sortOrder` + the
 * `documentId` in their body (which is also re-validated against the URL).
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
import { BoQSectionCreateSchema } from "@/shared/schemas/boq/document";

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const doc = await db.boQDocument.findUnique({
      where: { id, deletedAt: null },
    });
    if (!doc) return notFound("Document not found");

    const project = await verifyProjectOwnership(doc.projectId, userId);
    if (!project) return notFound("Document not found");

    const services = getServices();
    const sections = await services.boq.listSections(id);
    return json({ sections });
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

    const doc = await db.boQDocument.findUnique({
      where: { id, deletedAt: null },
    });
    if (!doc) return notFound("Document not found");

    const project = await verifyProjectOwnership(doc.projectId, userId);
    if (!project) return notFound("Document not found");

    const body = await req.json();
    const input = BoQSectionCreateSchema.parse({
      ...body,
      documentId: id,
    });

    const services = getServices();
    const section = await services.boq.createSection({
      documentId: id,
      projectId: doc.projectId,
      code: input.code,
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      sortOrder: input.sortOrder,
    });

    await writeAuditLog({
      action: "boq.section.create",
      entityType: "BoQSection",
      entityId: section.id,
      afterJson: section,
    });

    return created(section);
  },
);
