/**
 * GET   /api/submittals/[id] — fetch a single submittal (with events timeline).
 * PATCH /api/submittals/[id] — update with optimistic concurrency.
 * DELETE /api/submittals/[id] — soft-delete with optimistic concurrency.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S18 Submittals log).
 *
 * Per BR-WEB-5: every route verifies the submittal's project is owned by the
 *           session user (missing-or-not-owned → 404).
 * Per BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod.
 *
 * GET returns the submittal + its event timeline (SubmittalEvent[] ordered by
 * eventDate asc) so the UI can render the status workflow panel (S18).
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
import {
  SubmittalTypeSchema,
  DisciplineSchema,
  SubmittalStatusSchema,
} from "@shared/schemas/doccontrol/entities";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ISO date — used for submittedDate (optional).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDateOptional = z
  .string()
  .regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd")
  .nullable()
  .optional();

// PATCH body schema — all fields optional, but expectedVersion is required.
const SubmittalUpdateSchema = z.object({
  subjectEn: z.string().min(1).optional(),
  subjectAr: z.string().nullable().optional(),
  type: SubmittalTypeSchema.optional(),
  discipline: DisciplineSchema.optional(),
  submittedDate: isoDateOptional,
  reviewPeriodDays: z.number().int().nonnegative().optional(),
  resubmissionNo: z.number().int().nonnegative().optional(),
  status: SubmittalStatusSchema.optional(),
  expectedVersion: z.number().int().positive(),
});

const SubmittalDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── GET single submittal ──────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const submittal = await services.submittals.getById(id);
  if (!submittal) return notFound("Submittal not found");

  const project = await verifyProjectOwnership(submittal.projectId, userId);
  if (!project) return notFound("Submittal not found");

  const events = await services.submittals.listEvents(id);

  return json({ submittal, events });
});

// ─── PATCH update (optimistic concurrency) ────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.submittals.getById(id);
  if (!before) return notFound("Submittal not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Submittal not found");

  const body = await req.json();
  const input = SubmittalUpdateSchema.parse(body);

  const result = await services.submittals.update(id, {
    subjectEn: input.subjectEn,
    subjectAr: input.subjectAr,
    type: input.type,
    discipline: input.discipline,
    submittedDate: input.submittedDate,
    reviewPeriodDays: input.reviewPeriodDays,
    resubmissionNo: input.resubmissionNo,
    status: input.status,
    expectedVersion: input.expectedVersion,
  });

  if (result.kind === "not_found") return notFound("Submittal not found");
  if (result.kind === "conflict") {
    return conflict(
      "Submittal was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "submittal.update",
    entityType: "Submittal",
    entityId: id,
    beforeJson: before,
    afterJson: result.submittal,
  });

  return json(result.submittal);
});

// ─── DELETE soft-delete (optimistic concurrency) ──────────────────────────

export const DELETE = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.submittals.getById(id);
  if (!before) return notFound("Submittal not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Submittal not found");

  let expectedVersion: number | undefined;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const body = SubmittalDeleteSchema.parse(JSON.parse(text));
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

  const result = await services.submittals.softDelete(id, expectedVersion);

  if (result.kind === "not_found") return notFound("Submittal not found");
  if (result.kind === "conflict") {
    return conflict(
      "Submittal was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "submittal.delete",
    entityType: "Submittal",
    entityId: id,
    beforeJson: before,
  });

  return noContent();
});
