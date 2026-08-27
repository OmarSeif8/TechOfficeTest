/**
 * GET  /api/activities/[activityId]/relationships — list relationships for an
 *                                                   activity (as predecessor
 *                                                   AND successor).
 * POST /api/activities/[activityId]/relationships — create a relationship
 *                                                   (predecessorId, successorId,
 *                                                   type, lag).
 *
 * Per SPEC_PHASE2_WEB.md §6 (S13/S15 — relationships drive the Gantt arrows).
 *
 * Per BR-WEB-5: both routes verify the activity's project is owned by the
 *           session user (missing-or-not-owned → 404).
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod (RelationshipCreateSchema).
 * Per BR-P13:   multiple relationships between the same (pred, succ) pair
 *               are allowed ONLY if type differs — enforced by the @unique
 *               ([predecessorId, successorId, type]) constraint. A duplicate
 *               triple → 409 Conflict (caught at the repository level and
 *               surfaced as a Prisma P2002 error → translated here).
 * Per BR-P16:   self-relationships (predId === succId) are rejected (400).
 *
 * GET semantics: the route returns relationships where the activity appears as
 * EITHER predecessor OR successor. The UI uses this for the activity detail
 * view (incoming + outgoing arrows). The repository's `listRelationships`
 * returns all relationships for the project — we filter here in-process for
 * the "involves this activity" subset.
 *
 * POST semantics: the body specifies BOTH predecessorId and successorId. The
 * activityId in the URL is used only for ownership — the body must reference
 * at least one activity in this project (we verify both belong to the same
 * project as the URL activity).
 */

import {
  withErrorHandler,
  json,
  created,
  notFound,
  badRequest,
  conflict,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { RelationshipCreateSchema } from "@shared/schemas/scheduling/entities";

interface RouteContext {
  params: Promise<{ activityId: string }>;
}

// ─── GET list ────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { activityId } = await ctx.params;
  const services = getServices();

  const activity = await services.activities.getById(activityId);
  if (!activity) return notFound("Activity not found");

  const project = await verifyProjectOwnership(activity.projectId, userId);
  if (!project) return notFound("Activity not found");

  const all = await services.activities.listRelationships(activity.projectId);
  const relationships = all.filter(
    (r) => r.predecessorId === activityId || r.successorId === activityId,
  );
  return json({ relationships });
});

// ─── POST create ──────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { activityId } = await ctx.params;
  const services = getServices();

  const activity = await services.activities.getById(activityId);
  if (!activity) return notFound("Activity not found");

  const project = await verifyProjectOwnership(activity.projectId, userId);
  if (!project) return notFound("Activity not found");

  const body = await req.json();
  // Inject projectId from the URL's activity — the body must NOT carry it
  // (defense in depth: even if the body says `projectId: "other"`, the URL
  // wins). The RelationshipCreateSchema requires a projectId string, so we
  // override it here.
  const input = RelationshipCreateSchema.parse({
    ...(body as Record<string, unknown>),
    projectId: activity.projectId,
  });

  // BR-P16: self-relationship rejection. (The engine also rejects this, but
  // we catch it earlier — before the DB write — for a cleaner error.)
  if (input.predecessorId === input.successorId) {
    return badRequest(
      "Self-relationship is not allowed (predecessor and successor must differ).",
    );
  }

  // Verify both activities belong to the same project (the URL one's
  // project). The URL's activity must be one of {predecessor, successor} —
  // otherwise the caller is using the wrong URL.
  if (
    input.predecessorId !== activityId &&
    input.successorId !== activityId
  ) {
    return badRequest(
      "The URL activityId must appear as either predecessorId or successorId.",
    );
  }

  const [pred, succ] = await Promise.all([
    services.activities.getById(input.predecessorId),
    services.activities.getById(input.successorId),
  ]);
  const notFoundIds: string[] = [];
  const crossProjectIds: string[] = [];
  for (const [a, label] of [
    [pred, "predecessor"],
    [succ, "successor"],
  ] as const) {
    if (!a) {
      notFoundIds.push(label);
    } else if (a.projectId !== activity.projectId) {
      crossProjectIds.push(label);
    }
  }
  if (notFoundIds.length > 0) {
    return notFound(`Activity not found: ${notFoundIds.join(", ")}`);
  }
  if (crossProjectIds.length > 0) {
    return badRequest(
      `Cross-project relationship not allowed: ${crossProjectIds.join(", ")} belongs to a different project.`,
    );
  }

  // Both activities confirmed in this project. Now create the relationship.
  // The @unique([predecessorId, successorId, type]) constraint will throw
  // Prisma P2002 if a duplicate triple already exists — we catch and surface
  // as 409 Conflict.
  try {
    const relationship = await services.activities.createRelationship({
      projectId: activity.projectId,
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      type: input.type,
      lag: input.lag,
    });

    await writeAuditLog({
      action: "activity.relationship.create",
      entityType: "ActivityRelationship",
      entityId: relationship.id,
      afterJson: relationship,
    });

    return created(relationship);
  } catch (err) {
    // Prisma P2002 = unique constraint violation. Translate to 409 Conflict
    // with a descriptive message. The body of the P2002 error includes the
    // target fields, but we don't dig in — the message is enough.
    if (
      err instanceof Error &&
      /P2002|Unique constraint/i.test(err.message)
    ) {
      return conflict(
        "A relationship with the same (predecessor, successor, type) already exists.",
      );
    }
    throw err;
  }
});
