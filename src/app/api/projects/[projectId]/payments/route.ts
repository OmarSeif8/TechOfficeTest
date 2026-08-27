/**
 * GET  /api/projects/[projectId]/payments — list IPC applications in a project.
 * POST /api/projects/[projectId]/payments — create a new IPC application.
 *
 * Per SPEC_PHASE4_WEB.md §3 + §6 (S22 Payments list + S23 IPC editor).
 *
 * Per BR-IP9: applications are processed in IPC-number order. The list endpoint
 *             returns them sorted by ipcNo asc — the UI doesn't need to re-sort.
 * Per BR-IP11: POST body validated with zod (PaymentApplicationInputSchema).
 * Per BR-WEB-5: verify the project exists AND is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 *
 * Note: this route creates the application header + child rows (lines, deductions,
 * additions) but does NOT compute IPC math. The compute endpoint
 * (POST /api/payments/[id]/compute) runs the pure engine and persists the
 * computed values back via PATCH.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  withErrorHandler,
  json,
  created,
  notFound,
  conflict,
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
  params: Promise<{ projectId: string }>;
}

// POST body schema. Most fields map onto the Prisma model. The `ipcNo` is an
// integer (Prisma stores it as Int). The lines/deductions/additions are
// optional arrays for MVP — the typical create flow is "header only", then
// PATCH with the lines after the user enters them.
const PaymentCreateBodySchema = z.object({
  ipcNo: z.number().int().positive(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO yyyy-MM-dd"),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO yyyy-MM-dd"),
  status: PaymentStatusSchema.default("DRAFT"),
  contractValue: z.string().min(1),
  retentionPercent: z.string().min(1),
  retentionCapAmount: z.string().nullable().optional(),
  advanceAmount: z.string().default("0"),
  advanceEnabled: z.boolean().default(false),
  lines: z.array(PaymentLineInputSchema).default([]),
  deductions: z.array(PaymentDeductionInputSchema).default([]),
  additions: z.array(PaymentAdditionInputSchema).default([]),
});

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const applications = await services.payments.list(projectId);
  return json({ applications });
});

// ─── POST create ──────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const body = await req.json();
  const input = PaymentCreateBodySchema.parse({
    ...body,
    projectId,
  });

  try {
    const application = await services.payments.create({
      projectId,
      ipcNo: input.ipcNo,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: input.status,
      contractValue: input.contractValue,
      retentionPercent: input.retentionPercent,
      retentionCapAmount: input.retentionCapAmount ?? null,
      advanceAmount: input.advanceAmount,
      advanceEnabled: input.advanceEnabled,
      lines: input.lines.map((l, i) => ({
        boqItemId: l.itemId,
        qtyThisPeriod: l.qtyThisPeriod,
        qtyCum: "0",
        valueThisPeriod: "0",
        valueCum: "0",
        rate: "0",
        sortOrder: i,
      })),
      deductions: input.deductions.map((d, i) => ({
        type: d.type,
        descriptionEn: d.descriptionEn,
        amount: d.amount,
        sortOrder: i,
      })),
      additions: input.additions.map((a, i) => ({
        type: a.type,
        descriptionEn: a.descriptionEn,
        amount: a.amount,
        sortOrder: i,
      })),
    });

    await writeAuditLog({
      action: "payment.create",
      entityType: "PaymentApplication",
      entityId: application.id,
      afterJson: application,
    });

    return created(application);
  } catch (err) {
    // P2002 = unique constraint violation on (projectId, ipcNo).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict(`IPC #${input.ipcNo} already exists in this project`);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return badRequest("Referenced BoQ item does not exist");
    }
    throw err;
  }
});
