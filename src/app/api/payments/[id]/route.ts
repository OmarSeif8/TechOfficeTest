/**
 * GET   /api/payments/[id] — fetch a single IPC application (with child rows).
 * PATCH /api/payments/[id] — update with optimistic concurrency.
 * DELETE /api/payments/[id] — soft-delete with optimistic concurrency.
 *
 * Per SPEC_PHASE4_WEB.md §3 + §6 (S22 Payments list + S23 IPC editor).
 *
 * Per BR-WEB-5: every route verifies the application's project is owned by the
 *           session user (missing-or-not-owned → 404).
 * Per BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod.
 *
 * GET returns the application + its child rows (lines, deductions, additions)
 * so the UI can render the IPC editor (S23).
 *
 * Per BR-IP10: CERTIFIED applications are immutable. PATCH/DELETE on a CERTIFIED
 *           application returns 409 (the route handler checks status before
 *           forwarding to the repository).
 */

import { z } from "zod";
import {
  withErrorHandler,
  json,
  notFound,
  conflict,
  noContent,
  badRequest,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import {
  PaymentStatusSchema,
  PaymentLineInputSchema,
  PaymentDeductionInputSchema,
  PaymentAdditionInputSchema,
} from "@shared/schemas/payments/ipc";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd");

// PATCH body schema — all fields optional, expectedVersion required.
const PaymentUpdateSchema = z.object({
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
  status: PaymentStatusSchema.optional(),
  contractValue: z.string().optional(),
  retentionPercent: z.string().optional(),
  retentionCapAmount: z.string().nullable().optional(),
  advanceAmount: z.string().optional(),
  advanceEnabled: z.boolean().optional(),
  lines: z
    .array(PaymentLineInputSchema)
    .optional()
    .transform((arr) =>
      arr
        ? arr.map((l, i) => ({
            boqItemId: l.itemId,
            qtyThisPeriod: l.qtyThisPeriod,
            qtyCum: "0",
            valueThisPeriod: "0",
            valueCum: "0",
            rate: "0",
            sortOrder: i,
          }))
        : undefined,
    ),
  deductions: z
    .array(PaymentDeductionInputSchema)
    .optional()
    .transform((arr) =>
      arr
        ? arr.map((d, i) => ({
            type: d.type,
            descriptionEn: d.descriptionEn,
            amount: d.amount,
            sortOrder: i,
          }))
        : undefined,
    ),
  additions: z
    .array(PaymentAdditionInputSchema)
    .optional()
    .transform((arr) =>
      arr
        ? arr.map((a, i) => ({
            type: a.type,
            descriptionEn: a.descriptionEn,
            amount: a.amount,
            sortOrder: i,
          }))
        : undefined,
    ),
  expectedVersion: z.number().int().positive(),
});

const PaymentDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── GET single application ────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const detail = await services.payments.getDetail(id);
  if (!detail) return notFound("Payment application not found");

  const project = await verifyProjectOwnership(detail.application.projectId, userId);
  if (!project) return notFound("Payment application not found");

  return json(detail);
});

// ─── PATCH update (optimistic concurrency) ────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.payments.getById(id);
  if (!before) return notFound("Payment application not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Payment application not found");

  // BR-IP10: CERTIFIED applications are immutable.
  if (before.status === "CERTIFIED") {
    return badRequest("Certified applications are immutable. Corrections via later applications.");
  }

  const body = await req.json();
  const input = PaymentUpdateSchema.parse(body);

  const result = await services.payments.update(id, {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: input.status,
    contractValue: input.contractValue,
    retentionPercent: input.retentionPercent,
    retentionCapAmount: input.retentionCapAmount,
    advanceAmount: input.advanceAmount,
    advanceEnabled: input.advanceEnabled,
    lines: input.lines,
    deductions: input.deductions,
    additions: input.additions,
    expectedVersion: input.expectedVersion,
  });

  if (result.kind === "not_found") return notFound("Payment application not found");
  if (result.kind === "conflict") {
    return conflict(
      "Payment application was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "payment.update",
    entityType: "PaymentApplication",
    entityId: id,
    beforeJson: before,
    afterJson: result.application,
  });

  return json(result.application);
});

// ─── DELETE soft-delete (optimistic concurrency) ──────────────────────────

export const DELETE = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.payments.getById(id);
  if (!before) return notFound("Payment application not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Payment application not found");

  // BR-IP10: CERTIFIED applications are immutable.
  if (before.status === "CERTIFIED") {
    return badRequest("Certified applications cannot be deleted.");
  }

  let expectedVersion: number | undefined;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const body = PaymentDeleteSchema.parse(JSON.parse(text));
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

  const result = await services.payments.softDelete(id, expectedVersion);

  if (result.kind === "not_found") return notFound("Payment application not found");
  if (result.kind === "conflict") {
    return conflict(
      "Payment application was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "payment.delete",
    entityType: "PaymentApplication",
    entityId: id,
    beforeJson: before,
  });

  return noContent();
});
