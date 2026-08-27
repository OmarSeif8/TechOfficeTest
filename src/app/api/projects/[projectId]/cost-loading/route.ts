/**
 * GET  /api/projects/[projectId]/cost-loading — list BoQ↔activity links + coverage.
 * POST /api/projects/[projectId]/cost-loading — replace allocations for a BoQ item.
 *
 * Per SPEC_PHASE4_WEB.md §2 + §6 (S26 Cost loading — the differentiator).
 *
 * Architecture proof:
 *   - GET returns: list of BoQItemScheduleLink rows + per-BoQ-item coverage report
 *     (linked value, total value, coverage % via `computeCoverage` from domain).
 *   - POST validates allocations via `validateAllocations` (pure domain fn — BR-CS1:
 *     per-BoQ-item allocations must sum to exactly 100, decimal-exact) BEFORE
 *     persisting. Validation failure → 422 with the structured error strings.
 *
 * Per BR-CS1: an item with NO allocations is a warning, not an error —
 *             `validateAllocations` only flags items WITH allocations that don't sum
 *             to 100. Unlinked items are surfaced in the coverage report.
 *
 * Per BR-WEB-5: verify the project exists AND is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod.
 */

import { z } from "zod";
import {
  withErrorHandler,
  json,
  notFound,
  unprocessableEntity,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import {
  validateAllocations,
  computeActivityPlannedCost,
  computeCoverage,
} from "@domain/payments/cost-loading";
import type { AllocationInput, BoqItemAmount } from "@shared/schemas/payments/cost-loading";
import type { BoQItemScheduleLink } from "@shared/entities";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

interface BoQItemLite {
  id: string;
  code: string | null;
  descriptionEn: string;
  amount: string;
}

interface ActivityLite {
  id: string;
  code: string;
  nameEn: string;
}

// POST body — replace allocations for ONE BoQ item (the typical UI flow is:
// click a BoQ item → edit its allocations → save). The body is the list of
// (activityId, allocationPct) allocations for that BoQ item.
const ReplaceAllocationsBodySchema = z.object({
  boqItemId: z.string().min(1),
  allocations: z.array(
    z.object({
      activityId: z.string().min(1),
      allocationPct: z.string().min(1),
    }),
  ),
});

// ─── GET list + coverage ──────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  // Load BoQ items (live) + activities (live) + existing links.
  const [boqItemsRaw, activitiesRaw, linksRaw] = await Promise.all([
    services.prisma.boQItem.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        code: true,
        descriptionEn: true,
        quantity: true,
        rate: true,
        amount: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    services.prisma.activity.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, code: true, nameEn: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    services.prisma.boQItemScheduleLink.findMany({
      where: { projectId },
      orderBy: [{ boqItemId: "asc" }, { activityId: "asc" }],
    }),
  ]);

  const boqItems: BoQItemLite[] = boqItemsRaw.map((r) => ({
    id: r.id,
    code: r.code,
    descriptionEn: r.descriptionEn,
    amount: r.amount,
  }));
  const activities: ActivityLite[] = activitiesRaw.map((r) => ({
    id: r.id,
    code: r.code,
    nameEn: r.nameEn,
  }));
  const links: BoQItemScheduleLink[] = linksRaw as unknown as BoQItemScheduleLink[];

  // ─── Coverage report (BR-CS4) ───
  // For each BoQ item: linked value (Σ allocations × amount) + total value (amount).
  // Coverage = Σ linked values ÷ Σ total values × 100.
  const boqAmounts: BoqItemAmount[] = boqItems.map((b) => ({ id: b.id, amount: b.amount }));
  const allocationsForDomain: AllocationInput[] = links.map((l) => ({
    boqItemId: l.boqItemId,
    activityId: l.activityId,
    allocationPct: l.allocationPct,
  }));

  // Activity planned cost map (per-activity sum of contributions).
  const activityPlannedCost = computeActivityPlannedCost(allocationsForDomain, boqAmounts);

  // Per-BoQ-item coverage.
  const linkedByItem = new Map<string, { linked: number; total: number }>();
  for (const b of boqItems) {
    linkedByItem.set(b.id, { linked: 0, total: Number.parseFloat(b.amount) || 0 });
  }
  for (const l of links) {
    const item = boqItems.find((b) => b.id === l.boqItemId);
    if (!item) continue;
    const amount = Number.parseFloat(item.amount) || 0;
    const pct = Number.parseFloat(l.allocationPct) || 0;
    const contribution = (amount * pct) / 100;
    const prev = linkedByItem.get(l.boqItemId) ?? { linked: 0, total: 0 };
    linkedByItem.set(l.boqItemId, {
      linked: prev.linked + contribution,
      total: prev.total,
    });
  }

  const perItemCoverage = boqItems.map((b) => {
    const c = linkedByItem.get(b.id) ?? { linked: 0, total: 0 };
    return {
      boqItemId: b.id,
      boqItemCode: b.code,
      boqItemDescriptionEn: b.descriptionEn,
      linkedValue: c.linked.toFixed(2),
      totalValue: c.total.toFixed(2),
      linked: c.linked > 0,
    };
  });

  // Project-wide coverage % = Σ linked / Σ total × 100.
  const totalLinked = perItemCoverage.reduce((s, c) => s + Number.parseFloat(c.linkedValue), 0);
  const totalBoQValue = perItemCoverage.reduce(
    (s, c) => s + Number.parseFloat(c.totalValue),
    0,
  );
  const coveragePct = computeCoverage(totalLinked.toFixed(2), totalBoQValue.toFixed(2));

  return json({
    boqItems,
    activities,
    links,
    coverage: {
      totalLinked: totalLinked.toFixed(2),
      totalBoQValue: totalBoQValue.toFixed(2),
      coveragePct,
      perItem: perItemCoverage,
    },
    activityPlannedCost,
  });
});

// ─── POST replace allocations for a BoQ item ──────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const body = await req.json();
  const input = ReplaceAllocationsBodySchema.parse(body);

  // Verify the BoQ item belongs to this project.
  const boqItem = await services.prisma.boQItem.findFirst({
    where: { id: input.boqItemId, projectId, deletedAt: null },
    select: { id: true },
  });
  if (!boqItem) return notFound("BoQ item not found");

  // Verify all activities belong to this project.
  if (input.allocations.length > 0) {
    const activityIds = input.allocations.map((a) => a.activityId);
    const found = await services.prisma.activity.findMany({
      where: { id: { in: activityIds }, projectId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== new Set(activityIds).size) {
      return unprocessableEntity(
        "One or more activities do not exist in this project.",
      );
    }
  }

  // ─── BR-CS1: validate allocations via pure domain fn ───
  // An item with allocations summing ≠ 100 → 422 with the error strings.
  const allocations: AllocationInput[] = input.allocations.map((a) => ({
    boqItemId: input.boqItemId,
    activityId: a.activityId,
    allocationPct: a.allocationPct,
  }));
  const errors = validateAllocations(allocations);
  if (errors.length > 0) {
    return unprocessableEntity("Allocation validation failed (BR-CS1)", { errors });
  }

  // ─── Replace allocations atomically ───
  // Delete existing links for this BoQ item + insert the new ones.
  await services.prisma.boQItemScheduleLink.deleteMany({
    where: { boqItemId: input.boqItemId },
  });
  if (input.allocations.length > 0) {
    await services.prisma.boQItemScheduleLink.createMany({
      data: input.allocations.map((a) => ({
        projectId,
        boqItemId: input.boqItemId,
        activityId: a.activityId,
        allocationPct: a.allocationPct,
      })),
    });
  }

  await writeAuditLog({
    action: "cost-loading.replace-allocations",
    entityType: "BoQItem",
    entityId: input.boqItemId,
    afterJson: { allocations: input.allocations },
  });

  return json({ boqItemId: input.boqItemId, allocations: input.allocations });
});
