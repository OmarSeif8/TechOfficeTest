/**
 * DELETE /api/relationships/[relationshipId] — delete a relationship.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S13/S15 — relationships drive the Gantt arrows).
 *
 * Per BR-WEB-5: verify the relationship's project is owned by the session
 *           user (missing-or-not-owned → 404 to avoid leaking existence).
 * Per BR-WEB-8: writes AuditLog entry on success.
 *
 * The repository's `deleteRelationship` is a deleteMany + silent no-op on
 * missing id (consistent with the "disposable" semantic — relationships are
 * cheap to recreate). For BR-WEB-5 enforcement, we fetch the relationship
 * first via the DB (the repository has no `getRelationshipById` — see Group
 * K notes) and verify ownership BEFORE the delete.
 *
 * If the relationship doesn't exist OR belongs to another user's project,
 * we return 404 (no existence leak).
 *
 * AuditLog: before-snapshot only (no "after" — it's gone).
 */

import {
  withErrorHandler,
  notFound,
  noContent,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { db } from "@/lib/db";

interface RouteContext {
  params: Promise<{ relationshipId: string }>;
}

export const DELETE = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { relationshipId } = await ctx.params;
  const services = getServices();

  // Resolve the relationship via DB (no `getRelationshipById` on the
  // repository). The DB read is read-only; the mutation goes through the
  // repository so the @unique constraint and any future hooks still apply.
  const before = await db.activityRelationship.findUnique({
    where: { id: relationshipId },
  });
  if (!before) return notFound("Relationship not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Relationship not found");

  await services.activities.deleteRelationship(relationshipId);

  await writeAuditLog({
    action: "activity.relationship.delete",
    entityType: "ActivityRelationship",
    entityId: relationshipId,
    beforeJson: before,
  });

  return noContent();
});
