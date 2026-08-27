/**
 * GET  /api/projects/[projectId]/progress — list progress updates in a project.
 * POST /api/projects/[projectId]/progress — create a new progress update
 *      (header + activity progress rows in one atomic transaction).
 *
 * Per SPEC_PHASE4_WEB.md §2 + §6 (S27 Progress update).
 *
 * Per BR-CS5: EV = activity % complete × planned cost. The compute happens
 *             downstream in the project-dashboard route (W4-12), not here —
 *             this route just persists the progress snapshot.
 * Per BR-WEB-5: verify the project exists AND is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod.
 */

import { z } from "zod";
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

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ActivityProgressInputSchema = z.object({
  activityId: z.string().min(1),
  percentComplete: z.number().int().min(0).max(100),
  actualStart: z
    .string()
    .regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd")
    .nullable()
    .optional(),
  actualFinish: z
    .string()
    .regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd")
    .nullable()
    .optional(),
});

const ProgressCreateBodySchema = z.object({
  dataDate: z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd"),
  scheduleRunId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  activityProgress: z.array(ActivityProgressInputSchema),
});

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const updates = await services.progress.list(projectId);
  return json({ updates });
});

// ─── POST create ──────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const body = await req.json();
  const input = ProgressCreateBodySchema.parse(body);

  // Verify all activities belong to this project.
  if (input.activityProgress.length > 0) {
    const activityIds = input.activityProgress.map((a) => a.activityId);
    const found = await services.prisma.activity.findMany({
      where: { id: { in: activityIds }, projectId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== new Set(activityIds).size) {
      return notFound("One or more activities do not exist in this project");
    }
  }

  const update = await services.progress.create({
    projectId,
    dataDate: input.dataDate,
    scheduleRunId: input.scheduleRunId ?? null,
    notes: input.notes ?? null,
    activityProgress: input.activityProgress.map((ap) => ({
      activityId: ap.activityId,
      percentComplete: ap.percentComplete,
      actualStart: ap.actualStart ?? null,
      actualFinish: ap.actualFinish ?? null,
    })),
  });

  await writeAuditLog({
    action: "progress.create",
    entityType: "ProgressUpdate",
    entityId: update.id,
    afterJson: update,
  });

  return created(update);
});
