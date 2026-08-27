/**
 * GET  /api/projects/[projectId]/drawings — list drawings in a project.
 * POST /api/projects/[projectId]/drawings — create a drawing register entry.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S17 Drawing register).
 *
 * Per BR-WEB-5: both routes verify the project exists AND is owned by the
 *           session user before doing anything (missing-or-not-owned → 404).
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod (DrawingInputSchema).
 * Per BR-DC2: drawing code is engineer-assigned, unique per project. The
 *           @unique([projectId, code]) constraint enforces this; a duplicate
 *           → P2002 → 409 Conflict (caught by withErrorHandler? — no, we
 *           surface it explicitly via the catch for Prisma's P2002).
 */

import { Prisma } from "@prisma/client";
import {
  withErrorHandler,
  json,
  created,
  notFound,
  conflict,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { DrawingInputSchema } from "@shared/schemas/doccontrol/entities";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const drawings = await services.drawings.list(projectId);
  return json({ drawings });
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
  const input = DrawingInputSchema.parse({ ...rest, projectId });

  try {
    const drawing = await services.drawings.create({
      projectId,
      code: input.code,
      titleEn: input.titleEn,
      titleAr: input.titleAr ?? null,
      discipline: input.discipline,
    });

    await writeAuditLog({
      action: "drawing.create",
      entityType: "Drawing",
      entityId: drawing.id,
      afterJson: drawing,
    });

    return created(drawing);
  } catch (err) {
    // Prisma P2002 = unique constraint violation. Surface as 409 Conflict so
    // the caller can show "Drawing code already exists in this project".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict(`Drawing code "${input.code}" already exists in this project`);
    }
    throw err;
  }
});
