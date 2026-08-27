/**
 * GET   /api/rfis/[id] — fetch a single RFI (with events timeline).
 * PATCH /api/rfis/[id] — update with optimistic concurrency.
 * DELETE /api/rfis/[id] — soft-delete with optimistic concurrency.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S19 RFI log).
 *
 * Per BR-WEB-5: every route verifies the RFI's project is owned by the session
 *           user (missing-or-not-owned → 404).
 * Per BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod.
 *
 * GET returns the RFI + its event timeline (RfiEvent[] ordered by eventDate asc)
 * so the UI can render the workflow history (S19).
 *
 * PATCH does NOT change status — use POST /api/rfis/[id]/answer for that.
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

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDateOptional = z
  .string()
  .regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd")
  .nullable()
  .optional();

const RfiUpdateSchema = z.object({
  questionEn: z.string().min(1).optional(),
  questionAr: z.string().nullable().optional(),
  linkedDrawingId: z.string().nullable().optional(),
  sentDate: isoDateOptional,
  reviewPeriodDays: z.number().int().nonnegative().optional(),
  expectedVersion: z.number().int().positive(),
});

const RfiDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── GET single RFI ────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const rfi = await services.rfis.getById(id);
  if (!rfi) return notFound("RFI not found");

  const project = await verifyProjectOwnership(rfi.projectId, userId);
  if (!project) return notFound("RFI not found");

  const events = await services.rfis.listEvents(id);

  return json({ rfi, events });
});

// ─── PATCH update (optimistic concurrency) ────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.rfis.getById(id);
  if (!before) return notFound("RFI not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("RFI not found");

  const body = await req.json();
  const input = RfiUpdateSchema.parse(body);

  const result = await services.rfis.update(id, {
    questionEn: input.questionEn,
    questionAr: input.questionAr,
    linkedDrawingId: input.linkedDrawingId,
    sentDate: input.sentDate,
    reviewPeriodDays: input.reviewPeriodDays,
    expectedVersion: input.expectedVersion,
  });

  if (result.kind === "not_found") return notFound("RFI not found");
  if (result.kind === "conflict") {
    return conflict(
      "RFI was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "rfi.update",
    entityType: "Rfi",
    entityId: id,
    beforeJson: before,
    afterJson: result.rfi,
  });

  return json(result.rfi);
});

// ─── DELETE soft-delete (optimistic concurrency) ──────────────────────────

export const DELETE = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.rfis.getById(id);
  if (!before) return notFound("RFI not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("RFI not found");

  let expectedVersion: number | undefined;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const body = RfiDeleteSchema.parse(JSON.parse(text));
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

  const result = await services.rfis.softDelete(id, expectedVersion);

  if (result.kind === "not_found") return notFound("RFI not found");
  if (result.kind === "conflict") {
    return conflict(
      "RFI was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "rfi.delete",
    entityType: "Rfi",
    entityId: id,
    beforeJson: before,
  });

  return noContent();
});
