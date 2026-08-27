/**
 * GET    /api/documents/[id] — fetch single document with sections + items
 * PATCH  /api/documents/[id] — update name / status with optimistic concurrency
 * DELETE /api/documents/[id] — soft-delete (cascades to sections + items per repo)
 *
 * BR-WEB-5: every route verifies the document's project is owned by the session
 *           user. Missing-or-not-owned → 404 (no existence leak).
 * BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * BR-WEB-11: PATCH body is zod-validated.
 *
 * NOTE on PATCH: the IBoQRepository interface (WO-W-2-b) does not expose an
 * `updateDocument` method. The route handler uses Prisma's `updateMany` with
 * the `version` in the WHERE clause directly — same optimistic-concurrency
 * pattern the repository uses elsewhere. The repository interface would be
 * the right place to add this if the pattern is reused — left as a follow-up
 * to avoid modifying the existing repo contract.
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
import { BoQDocumentUpdateSchema } from "@/shared/schemas/boq/document";

// ─── GET single document ──────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const tree = await loadDocumentTree(id);
    if (!tree) return notFound("Document not found");

    // BR-WEB-5: confirm the document's project is owned by the session user.
    const project = await verifyProjectOwnership(tree.document.projectId, userId);
    if (!project) return notFound("Document not found");

    const totals = computeTreeTotals(
      tree.document,
      tree.sections,
      tree.items,
    );
    return json({ document: tree.document, sections: tree.sections, items: tree.items, totals });
  },
);

// ─── PATCH document ───────────────────────────────────────────────────────

export const PATCH = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    // Load document first so we can verify ownership before mutating.
    const existing = await db.boQDocument.findUnique({
      where: { id, deletedAt: null },
    });
    if (!existing) return notFound("Document not found");

    const project = await verifyProjectOwnership(existing.projectId, userId);
    if (!project) return notFound("Document not found");

    const body = await req.json();
    const input = BoQDocumentUpdateSchema.parse(body);

    // Optimistic concurrency via `updateMany` with version in WHERE — atomic
    // check-and-set in a single SQL statement. count===0 means either the
    // row was concurrently modified (conflict) or concurrently deleted (404);
    // we re-read to disambiguate.
    const result = await db.boQDocument.updateMany({
      where: { id, version: input.expectedVersion, deletedAt: null },
      data: {
        ...(input.nameEn !== undefined && { nameEn: input.nameEn }),
        ...(input.nameAr !== undefined && { nameAr: input.nameAr }),
        ...(input.status !== undefined && { status: input.status }),
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const current = await db.boQDocument.findUnique({ where: { id } });
      if (!current) return notFound("Document not found");
      return conflict(
        "Document was modified by another user. Please reload and try again.",
        current.version,
      );
    }

    const updated = await db.boQDocument.findUniqueOrThrow({ where: { id } });
    await writeAuditLog({
      action: "boq.document.update",
      entityType: "BoQDocument",
      entityId: id,
      beforeJson: existing,
      afterJson: updated,
    });

    return json({ document: updated });
  },
);

// ─── DELETE document (soft-delete, cascades via repo) ───────────────────

export const DELETE = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const existing = await db.boQDocument.findUnique({
      where: { id, deletedAt: null },
    });
    if (!existing) return notFound("Document not found");

    const project = await verifyProjectOwnership(existing.projectId, userId);
    if (!project) return notFound("Document not found");

    // expectedVersion is required for optimistic concurrency. Accept it
    // as a query-string param (`?expectedVersion=N`) since DELETE bodies
    // are uncommon in REST and some HTTP clients don't allow them.
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

    const services = getServices();
    const result = await services.boq.softDeleteDocument(id, expectedVersion);

    if (result.kind === "not_found") return notFound("Document not found");
    if (result.kind === "conflict") {
      return conflict(
        "Document was modified by another user. Please reload and try again.",
        result.currentVersion,
      );
    }

    await writeAuditLog({
      action: "boq.document.delete",
      entityType: "BoQDocument",
      entityId: id,
      beforeJson: existing,
    });

    return noContent();
  },
);
