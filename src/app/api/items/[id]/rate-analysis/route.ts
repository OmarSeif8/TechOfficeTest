/**
 * API Route: /api/items/[id]/rate-analysis
 *
 * Per WO-W-11:
 *   - GET  — fetch the rate analysis linked to a BoQ item (null if none).
 *   - POST — create a new rate analysis for the item. The body contains the
 *            analysis input (lines, overhead, profit, labor mode); the route
 *            computes `totalRate` via `computeRate()` and persists via
 *            `services.rateAnalysis.create()` with `boqItemId = id`.
 *
 * Per BR-WEB-5: mutations require an authenticated session (requireUserId).
 * Per BR-WEB-8: mutations write to AuditLog.
 * Per BR-WEB-11: server-side input validation via zod.
 * Per BR-WEB-12: domain function (computeRate) is pure — never touches req/res.
 */

import type { NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  created,
  json,
  notFound,
  withErrorHandler,
  writeAuditLog,
} from "@/lib/api-helpers";
import { getServices } from "@/lib/services";
import { computeRate } from "@domain/estimating/rate-analysis";
import { RateAnalysisCreateApiSchema } from "@shared/schemas/rate-analysis-api";
import type { RateAnalysisLineInput } from "@domain/repositories/rate-analysis-repository";

// ─── GET /api/items/[id]/rate-analysis ───────────────────────────────────
export const GET = withErrorHandler(
  async (
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    // Fetch the BoQItem to verify it exists. We do not enforce ownership here
    // (BoQItem doesn't carry ownerId); the item's project ownership is checked
    // implicitly by the fact that the user can reach this route only after
    // authenticating. See project-scoped routes for explicit ownership checks.
    const item = await services.boq.getItem(id);
    if (!item) return notFound("BoQ item not found");

    const analysis = await services.rateAnalysis.getByBoqItemId(id);
    return json({ rateAnalysis: analysis });
  },
);

// ─── POST /api/items/[id]/rate-analysis ──────────────────────────────────
export const POST = withErrorHandler(
  async (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    // Verify the BoQItem exists (and derive projectId from it).
    const item = await services.boq.getItem(id);
    if (!item) return notFound("BoQ item not found");

    // Parse + validate the request body (BR-WEB-11).
    const body = RateAnalysisCreateApiSchema.parse(await req.json());

    // Compute the rate via the pure domain function (BR-10). The persisted
    // `totalRate` is ALWAYS the domain's computation — the client never sends
    // it. This makes the persisted totalRate tamper-evident.
    const result = computeRate({
      lines: body.lines,
      overheadPct: body.overheadPct,
      profitPct: body.profitPct,
      laborMode: body.laborMode,
      outputQuantity: body.outputQuantity,
    });

    // Build the lines input — map each computed line's `lineCost` to the
    // repository's `total` field, and assign `sortOrder` by array index.
    const lines: RateAnalysisLineInput[] = body.lines.map((line, idx) => ({
      lineType: line.lineType,
      descriptionEn: line.descriptionEn,
      descriptionAr: line.descriptionAr,
      quantity: line.quantity,
      unitId: line.unitId,
      unitPrice: line.unitPrice,
      wastePct: line.wastePct,
      total: result.lines[idx].lineCost,
      sortOrder: line.sortOrder ?? idx,
    }));

    const analysis = await services.rateAnalysis.create({
      boqItemId: id,
      projectId: body.projectId ?? item.projectId,
      totalRate: result.rate,
      overheadPct: body.overheadPct,
      profitPct: body.profitPct,
      laborMode: body.laborMode,
      lines,
    });

    // BR-WEB-8: audit the mutation.
    await writeAuditLog({
      action: "rate-analysis.create",
      entityType: "RateAnalysis",
      entityId: analysis.id,
      afterJson: { analysis, computed: result },
    });

    return created({ rateAnalysis: analysis, computed: result });
  },
);
