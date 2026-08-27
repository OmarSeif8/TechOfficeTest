/**
 * GET  /api/projects/[projectId]/variations — list variations in a project.
 * POST /api/projects/[projectId]/variations — create a new variation.
 *
 * Per SPEC_PHASE4_WEB.md §6 (S25 Variations list).
 *
 * Per BR-WEB-5: verify the project exists AND is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod.
 *
 * Variations are simpler than payments — no compute engine. They are created
 * with DRAFT status and transition through SUBMITTED → APPROVED / REJECTED.
 * The `approve` flow is on the per-id route (PATCH with status=APPROVED +
 * approvedValue, which the repository's `approve` method handles atomically).
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
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
import { VariationStatusSchema } from "@shared/schemas/payments/variation";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

const VariationCreateBodySchema = z.object({
  boqDocumentId: z.string().nullable().optional(),
  ref: z.string().min(1),
  titleEn: z.string().min(1),
  titleAr: z.string().nullable().optional(),
  status: VariationStatusSchema.default("DRAFT"),
  approvedValue: z.string().nullable().optional(),
});

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const variations = await services.variations.list(projectId);
  return json({ variations });
});

// ─── POST create ──────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const body = await req.json();
  const input = VariationCreateBodySchema.parse(body);

  try {
    const variation = await services.variations.create({
      projectId,
      boqDocumentId: input.boqDocumentId ?? null,
      ref: input.ref,
      titleEn: input.titleEn,
      titleAr: input.titleAr ?? null,
      status: input.status,
      approvedValue: input.approvedValue ?? null,
    });

    await writeAuditLog({
      action: "variation.create",
      entityType: "Variation",
      entityId: variation.id,
      afterJson: variation,
    });

    return created(variation);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict(`Variation ref "${input.ref}" already exists in this project`);
    }
    throw err;
  }
});
