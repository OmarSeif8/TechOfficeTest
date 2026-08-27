/**
 * GET   /api/drawings/[id] — fetch a single drawing.
 * PATCH /api/drawings/[id] — update with optimistic concurrency.
 * DELETE /api/drawings/[id] — soft-delete with optimistic concurrency.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S17 Drawing register).
 *
 * Per BR-WEB-5: every route verifies the drawing's project is owned by the
 *           session user (missing-or-not-owned → 404).
 * Per BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency
 *           (Drawing has a `version` column). On mismatch → 409 Conflict.
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod (inline DrawingUpdateSchema).
 */

import { Prisma } from "@prisma/client";
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
import { z } from "zod";
import { DisciplineSchema } from "@shared/schemas/doccontrol/entities";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH body schema — all fields optional, but expectedVersion is required.
const DrawingUpdateSchema = z.object({
  code: z.string().min(1).optional(),
  titleEn: z.string().min(1).optional(),
  titleAr: z.string().nullable().optional(),
  discipline: DisciplineSchema.optional(),
  expectedVersion: z.number().int().positive(),
});

// DELETE body schema — just expectedVersion (consistent with PATCH).
const DrawingDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── GET single drawing ────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const drawing = await services.drawings.getById(id);
  if (!drawing) return notFound("Drawing not found");

  const project = await verifyProjectOwnership(drawing.projectId, userId);
  if (!project) return notFound("Drawing not found");

  return json(drawing);
});

// ─── PATCH update (optimistic concurrency) ────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.drawings.getById(id);
  if (!before) return notFound("Drawing not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Drawing not found");

  const body = await req.json();
  const input = DrawingUpdateSchema.parse(body);

  try {
    const result = await services.drawings.update(id, {
      code: input.code,
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      discipline: input.discipline,
      expectedVersion: input.expectedVersion,
    });

    if (result.kind === "not_found") return notFound("Drawing not found");
    if (result.kind === "conflict") {
      return conflict(
        "Drawing was modified by another user. Please reload and try again.",
        result.currentVersion,
      );
    }

    await writeAuditLog({
      action: "drawing.update",
      entityType: "Drawing",
      entityId: id,
      beforeJson: before,
      afterJson: result.drawing,
    });

    return json(result.drawing);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Drawing code already exists in this project");
    }
    throw err;
  }
});

// ─── DELETE soft-delete (optimistic concurrency) ──────────────────────────

export const DELETE = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.drawings.getById(id);
  if (!before) return notFound("Drawing not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Drawing not found");

  // Accept expectedVersion via body OR ?expectedVersion= query (flexible).
  let expectedVersion: number | undefined;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const body = DrawingDeleteSchema.parse(JSON.parse(text));
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
      return conflict("expectedVersion must be a positive integer.", before.version);
    }
    expectedVersion = n;
  }

  const result = await services.drawings.softDelete(id, expectedVersion);

  if (result.kind === "not_found") return notFound("Drawing not found");
  if (result.kind === "conflict") {
    return conflict(
      "Drawing was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "drawing.delete",
    entityType: "Drawing",
    entityId: id,
    beforeJson: before,
  });

  return noContent();
});
