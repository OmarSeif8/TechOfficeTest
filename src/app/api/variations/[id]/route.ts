/**
 * GET   /api/variations/[id] — fetch a single variation.
 * PATCH /api/variations/[id] — update with optimistic concurrency.
 * DELETE /api/variations/[id] — soft-delete with optimistic concurrency.
 *
 * Per SPEC_PHASE4_WEB.md §6 (S25 Variations list).
 *
 * Per BR-WEB-5: every route verifies the variation's project is owned by the
 *           session user (missing-or-not-owned → 404).
 * Per BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod.
 *
 * Special case: PATCH with status=APPROVED + approvedValue routes to the
 * repository's `approve` method (atomic transition + value set).
 */

import { z } from "zod";
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
import { VariationStatusSchema } from "@shared/schemas/payments/variation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const VariationUpdateSchema = z.object({
  boqDocumentId: z.string().nullable().optional(),
  ref: z.string().optional(),
  titleEn: z.string().optional(),
  titleAr: z.string().nullable().optional(),
  status: VariationStatusSchema.optional(),
  approvedValue: z.string().nullable().optional(),
  expectedVersion: z.number().int().positive(),
});

const VariationDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── GET single variation ──────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const variation = await services.variations.getById(id);
  if (!variation) return notFound("Variation not found");

  const project = await verifyProjectOwnership(variation.projectId, userId);
  if (!project) return notFound("Variation not found");

  return json(variation);
});

// ─── PATCH update (optimistic concurrency) ────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.variations.getById(id);
  if (!before) return notFound("Variation not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Variation not found");

  const body = await req.json();
  const input = VariationUpdateSchema.parse(body);

  // Special case: transition to APPROVED with an approvedValue → use the
  // repository's atomic `approve` method. This prevents a race where two
  // PATCHes interleave status + value.
  const isApproveTransition =
    input.status === "APPROVED" &&
    input.approvedValue !== undefined &&
    input.approvedValue !== null;

  const result = isApproveTransition
    ? await services.variations.approve(id, {
        approvedValue: input.approvedValue!,
        expectedVersion: input.expectedVersion,
      })
    : await services.variations.update(id, {
        boqDocumentId: input.boqDocumentId,
        ref: input.ref,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        status: input.status,
        approvedValue: input.approvedValue,
        expectedVersion: input.expectedVersion,
      });

  if (result.kind === "not_found") return notFound("Variation not found");
  if (result.kind === "conflict") {
    return conflict(
      "Variation was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "variation.update",
    entityType: "Variation",
    entityId: id,
    beforeJson: before,
    afterJson: result.variation,
  });

  return json(result.variation);
});

// ─── DELETE soft-delete (optimistic concurrency) ──────────────────────────

export const DELETE = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.variations.getById(id);
  if (!before) return notFound("Variation not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Variation not found");

  let expectedVersion: number | undefined;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const body = VariationDeleteSchema.parse(JSON.parse(text));
      expectedVersion = body.expectedVersion;
    }
  } catch {
    // fall through to query string
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

  const result = await services.variations.softDelete(id, expectedVersion);

  if (result.kind === "not_found") return notFound("Variation not found");
  if (result.kind === "conflict") {
    return conflict(
      "Variation was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "variation.delete",
    entityType: "Variation",
    entityId: id,
    beforeJson: before,
  });

  return noContent();
});
