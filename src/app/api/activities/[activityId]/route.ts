/**
 * GET   /api/activities/[activityId] — fetch a single activity.
 * PATCH /api/activities/[activityId] — update with optimistic concurrency.
 * DELETE /api/activities/[activityId] — soft-delete with optimistic concurrency.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S13 Activities List) and BR-WEB-P6.
 *
 * Per BR-WEB-5: every route verifies the activity's project is owned by the
 *           session user (missing-or-not-owned → 404).
 * Per BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency
 *           (Activity has a `version` column). On mismatch → 409 Conflict.
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod (ActivityUpdateSchema).
 *
 * Per BR-P3: duration is a non-negative integer (zod enforces).
 *
 * DELETE accepts `expectedVersion` via the body (JSON). The Phase 1 pattern
 * uses query string for items (`?expectedVersion=`) — we follow the project
 * pattern instead (body) for consistency with PATCH on the same resource and
 * because Activity is a richer resource than BoQItem. Both forms are
 * defensible; the Activity pattern matches Project (body) which is more
 * recent and preferred.
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
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import {
  ActivityUpdateSchema,
} from "@shared/schemas/scheduling/entities";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ activityId: string }>;
}

// Body schema for DELETE — just expectedVersion (consistent with PATCH).
const ActivityDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── GET single activity ──────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { activityId } = await ctx.params;
  const services = getServices();

  const activity = await services.activities.getById(activityId);
  if (!activity) return notFound("Activity not found");

  const project = await verifyProjectOwnership(activity.projectId, userId);
  if (!project) return notFound("Activity not found");

  return json(activity);
});

// ─── PATCH update (optimistic concurrency) ─────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { activityId } = await ctx.params;
  const services = getServices();

  const before = await services.activities.getById(activityId);
  if (!before) return notFound("Activity not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Activity not found");

  const body = await req.json();
  const input = ActivityUpdateSchema.parse(body);

  // Defensive: if wbsNodeId is provided (and not null), verify it belongs to
  // this project.
  if (input.wbsNodeId) {
    const node = await services.wbs.getById(input.wbsNodeId);
    if (!node || node.projectId !== before.projectId) {
      return notFound("WBS node not found in this project");
    }
  }

  const result = await services.activities.update(activityId, {
    wbsNodeId: input.wbsNodeId,
    code: input.code,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    duration: input.duration,
    isMilestone: input.isMilestone,
    sortOrder: input.sortOrder,
    expectedVersion: input.expectedVersion,
  });

  if (result.kind === "not_found") return notFound("Activity not found");
  if (result.kind === "conflict") {
    return conflict(
      "Activity was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "activity.update",
    entityType: "Activity",
    entityId: activityId,
    beforeJson: before,
    afterJson: result.activity,
  });

  return json(result.activity);
});

// ─── DELETE soft-delete (optimistic concurrency) ──────────────────────────

export const DELETE = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { activityId } = await ctx.params;
  const services = getServices();

  const before = await services.activities.getById(activityId);
  if (!before) return notFound("Activity not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Activity not found");

  // DELETE with a body is unusual but allowed by HTTP. We accept a JSON body
  // `{ expectedVersion: number }`. Callers that prefer a query-string form
  // can also pass `?expectedVersion=` and we'll fall back to it.
  let expectedVersion: number | undefined;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const body = ActivityDeleteSchema.parse(JSON.parse(text));
      expectedVersion = body.expectedVersion;
    }
  } catch {
    // No body or invalid JSON — fall back to query string below.
  }
  if (expectedVersion === undefined) {
    const url = new URL(req.url);
    const q = url.searchParams.get("expectedVersion");
    if (q === null) {
      return conflict(
        "expectedVersion is required (body or ?expectedVersion=) for optimistic concurrency.",
        before.version,
      );
    }
    const n = Number.parseInt(q, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return conflict(
        "expectedVersion must be a positive integer.",
        before.version,
      );
    }
    expectedVersion = n;
  }

  const result = await services.activities.softDelete(activityId, expectedVersion);

  if (result.kind === "not_found") return notFound("Activity not found");
  if (result.kind === "conflict") {
    return conflict(
      "Activity was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "activity.delete",
    entityType: "Activity",
    entityId: activityId,
    beforeJson: before,
  });

  return noContent();
});
