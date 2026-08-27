/**
 * GET  /api/projects/[projectId]/documents — list BoQ documents in a project.
 * POST /api/projects/[projectId]/documents — create a new BoQ document.
 *
 * Per BR-WEB-5: both routes verify the project exists AND is owned by the
 * session user before doing anything. A missing or non-owned project
 * surfaces as 404 (we never leak existence).
 *
 * Per BR-WEB-8: POST writes an AuditLog entry on success.
 * Per BR-WEB-11: POST body is validated with zod before reaching the repo.
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
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { BoQDocumentCreateSchema } from "@/shared/schemas/boq/document";

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (
    _req: Request,
    { params }: { params: Promise<{ projectId: string }> },
  ) => {
    const userId = await requireUserId();
    const { projectId } = await params;

    const project = await verifyProjectOwnership(projectId, userId);
    if (!project) return notFound("Project not found");

    const services = getServices();
    const documents = await services.boq.listDocuments(projectId);
    return json({ documents });
  },
);

// ─── POST create ─────────────────────────────────────────────────────────

export const POST = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ projectId: string }> },
  ) => {
    const userId = await requireUserId();
    const { projectId } = await params;

    const project = await verifyProjectOwnership(projectId, userId);
    if (!project) return notFound("Project not found");

    const body = await req.json();
    const input = BoQDocumentCreateSchema.parse({ ...body, projectId });

    const services = getServices();
    const doc = await services.boq.createDocument(input);

    await writeAuditLog({
      action: "boq.document.create",
      entityType: "BoQDocument",
      entityId: doc.id,
      afterJson: doc,
    });

    return created(doc);
  },
);
