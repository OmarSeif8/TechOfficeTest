/**
 * GET  /api/projects/[projectId]/activities — list activities in a project.
 * POST /api/projects/[projectId]/activities — create an activity.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S13 Activities List) and BR-WEB-P6.
 *
 * Per BR-WEB-5: both routes verify the project is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod (ActivityCreateSchema).
 * Per BR-P3: duration is a non-negative integer (zod enforces).
 *
 * GET supports an optional `?wbsNodeId=` query filter to scope activities to
 * a single WBS node. The filter is applied in-process (the repository returns
 * the full project list, the route filters) — keeping the repository simple
 * and the filter logic in one place. For large projects this may need an
 * index-aware repository method, but Phase 2 lists are small enough.
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
import { ActivityCreateSchema } from "@shared/schemas/scheduling/entities";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

// ─── GET list ────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const all = await services.activities.list(projectId);

  // Optional ?wbsNodeId= filter — applied in-process. If the node id is
  // non-empty AND no activities match, that's just an empty list (not a 404).
  const url = new URL(req.url);
  const wbsNodeId = url.searchParams.get("wbsNodeId");
  const activities = wbsNodeId
    ? all.filter((a) => a.wbsNodeId === wbsNodeId)
    : all;

  return json({ activities });
});

// ─── POST create ──────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const body = await req.json();
  // Strip any projectId from the body — the URL is the source of truth.
  const { projectId: _ignored, ...rest } = body as Record<string, unknown>;
  const input = ActivityCreateSchema.parse({ ...rest, projectId });

  // Defensive: if wbsNodeId is provided, verify it belongs to this project.
  if (input.wbsNodeId) {
    const node = await services.wbs.getById(input.wbsNodeId);
    if (!node || node.projectId !== projectId) {
      return notFound("WBS node not found in this project");
    }
  }

  const activity = await services.activities.create({
    projectId,
    wbsNodeId: input.wbsNodeId ?? null,
    code: input.code,
    nameEn: input.nameEn,
    nameAr: input.nameAr ?? null,
    duration: input.duration,
    isMilestone: input.isMilestone,
    sortOrder: input.sortOrder,
  });

  await writeAuditLog({
    action: "activity.create",
    entityType: "Activity",
    entityId: activity.id,
    afterJson: activity,
  });

  return created(activity);
});
