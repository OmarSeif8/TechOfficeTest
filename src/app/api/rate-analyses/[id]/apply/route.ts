/**
 * API Route: /api/rate-analyses/[id]/apply
 *
 * Per WO-W-11:
 *   - POST — apply the analysis's `totalRate` to the BoQItem's `rate` column.
 *            Body: `{ boqItemId, expectedVersion }`.
 *            Calls `services.rateAnalysis.applyToBoqItem(id, boqItemId, expectedVersion)`.
 *            This is the "engineer approves" action — the analysis's totalRate
 *            is written to BoQItem.rate atomically (dual-write transaction).
 *            Maps repo result to 200 / 404 / 409.
 *
 * Per BR-WEB-5: mutations require an authenticated session.
 * Per BR-WEB-8: mutations write to AuditLog. The audit entry uses
 *   entityType: "BoQItem" (the entity being mutated), with afterJson
 *   `{ rate: analysis.totalRate }` capturing the new BoQItem.rate.
 * Per BR-WEB-11: server-side input validation via zod.
 */

import type { NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  conflict,
  json,
  notFound,
  withErrorHandler,
  writeAuditLog,
} from "@/lib/api-helpers";
import { getServices } from "@/lib/services";
import { ApplyToBoqItemSchema } from "@shared/schemas/rate-analysis-api";

// ─── POST /api/rate-analyses/[id]/apply ──────────────────────────────────
export const POST = withErrorHandler(
  async (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    const body = ApplyToBoqItemSchema.parse(await req.json());

    // The repository's `applyToBoqItem()` performs the dual-write:
    //   1. Sets RateAnalysis.boqItemId (idempotent — already set at create).
    //   2. Updates BoQItem.rate = RateAnalysis.totalRate (the "apply" step).
    // Both writes commit in the same Prisma $transaction (atomic).
    const result = await services.rateAnalysis.applyToBoqItem(
      id,
      body.boqItemId,
      body.expectedVersion,
    );

    // Map tagged-union result to HTTP responses (BR-WEB-4).
    if (result.kind === "not_found") {
      return notFound(
        "Rate analysis or BoQ item not found",
      );
    }
    if (result.kind === "conflict") {
      return conflict(
        "Rate analysis was modified by another user. Refresh and retry.",
        result.currentVersion,
      );
    }

    // BR-WEB-8: audit the mutation. The audited entity is the BoQItem (since
    // that's the entity whose `rate` column was changed). afterJson captures
    // the new BoQItem.rate value (the analysis's totalRate).
    await writeAuditLog({
      action: "rate-analysis.apply",
      entityType: "BoQItem",
      entityId: body.boqItemId,
      afterJson: { rate: result.rateAnalysis.totalRate },
    });

    return json({ rateAnalysis: result.rateAnalysis });
  },
);
