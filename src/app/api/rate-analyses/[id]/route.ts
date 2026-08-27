/**
 * API Route: /api/rate-analyses/[id]
 *
 * Per WO-W-11:
 *   - GET    — fetch the analysis with its lines (use `getWithLines`).
 *   - PATCH  — update the analysis with optimistic concurrency (BR-WEB-4).
 *   - DELETE — hard delete the analysis + cascade its lines.
 *
 * Per BR-WEB-5: mutations require an authenticated session.
 * Per BR-WEB-8: mutations write to AuditLog.
 * Per BR-WEB-11: server-side input validation via zod.
 */

import type { NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  conflict,
  json,
  noContent,
  notFound,
  withErrorHandler,
  writeAuditLog,
} from "@/lib/api-helpers";
import { getServices } from "@/lib/services";
import { computeRate } from "@domain/estimating/rate-analysis";
import { RateAnalysisUpdateApiSchema } from "@shared/schemas/rate-analysis-api";
import type {
  RateAnalysisLineInput,
  RateAnalysisUpdateInput,
} from "@domain/repositories/rate-analysis-repository";

// ─── GET /api/rate-analyses/[id] ─────────────────────────────────────────
export const GET = withErrorHandler(
  async (
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    const result = await services.rateAnalysis.getWithLines(id);
    if (!result) return notFound("Rate analysis not found");

    return json(result);
  },
);

// ─── PATCH /api/rate-analyses/[id] ───────────────────────────────────────
export const PATCH = withErrorHandler(
  async (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    const body = RateAnalysisUpdateApiSchema.parse(await req.json());

    // If `lines` are provided, recompute the line totals via `computeRate()`.
    // This keeps the persisted `total` fields consistent with the rate math
    // (BR-8/9/10) — the client never sends `total`; the route derives it.
    let updateInput: RateAnalysisUpdateInput;
    if (body.lines) {
      // Fetch the existing analysis to fill in defaults for overhead/profit/
      // laborMode if the caller didn't specify them. This guarantees the
      // rate computation uses the right parameters even on a partial update.
      const existing = await services.rateAnalysis.getWithLines(id);
      if (!existing) return notFound("Rate analysis not found");

      const laborMode = body.laborMode ?? existing.rateAnalysis.laborMode;
      const overheadPct = body.overheadPct ?? existing.rateAnalysis.overheadPct;
      const profitPct = body.profitPct ?? existing.rateAnalysis.profitPct;

      // outputQuantity is not persisted on the analysis entity — default to "1".
      // (CREW-mode analyses that need a non-1 outputQuantity should be
      // recreated via POST to capture the correct value at create time.)
      const computed = computeRate({
        lines: body.lines,
        overheadPct,
        profitPct,
        laborMode,
        outputQuantity: "1",
      });

      const lines: RateAnalysisLineInput[] = body.lines.map((line, idx) => ({
        lineType: line.lineType,
        descriptionEn: line.descriptionEn,
        descriptionAr: line.descriptionAr,
        quantity: line.quantity,
        unitId: line.unitId,
        unitPrice: line.unitPrice,
        wastePct: line.wastePct,
        total: computed.lines[idx].lineCost,
        sortOrder: line.sortOrder ?? idx,
      }));

      updateInput = {
        totalRate: body.totalRate ?? computed.rate,
        overheadPct,
        profitPct,
        laborMode,
        lines,
        expectedVersion: body.expectedVersion,
      };
    } else {
      updateInput = {
        totalRate: body.totalRate,
        overheadPct: body.overheadPct,
        profitPct: body.profitPct,
        laborMode: body.laborMode,
        expectedVersion: body.expectedVersion,
      };
    }

    const result = await services.rateAnalysis.update(id, updateInput);

    // Map tagged-union result to HTTP responses (BR-WEB-4).
    if (result.kind === "not_found") return notFound("Rate analysis not found");
    if (result.kind === "conflict") {
      return conflict(
        "Rate analysis was modified by another user. Refresh and retry.",
        result.currentVersion,
      );
    }

    // BR-WEB-8: audit the mutation.
    await writeAuditLog({
      action: "rate-analysis.update",
      entityType: "RateAnalysis",
      entityId: id,
      afterJson: { rateAnalysis: result.rateAnalysis },
    });

    return json({ rateAnalysis: result.rateAnalysis });
  },
);

// ─── DELETE /api/rate-analyses/[id] ──────────────────────────────────────
export const DELETE = withErrorHandler(
  async (
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    // Fetch before delete so we can audit (the audit needs the entity state
    // prior to deletion — best-effort; if the row is already gone, we still
    // record the delete attempt).
    const existing = await services.rateAnalysis.getWithLines(id);
    if (!existing) return notFound("Rate analysis not found");

    await services.rateAnalysis.delete(id);

    // BR-WEB-8: audit the mutation.
    await writeAuditLog({
      action: "rate-analysis.delete",
      entityType: "RateAnalysis",
      entityId: id,
      beforeJson: existing,
    });

    return noContent();
  },
);
