/**
 * API Route: /api/calculations/[id]/link
 *
 * Per WO-W-11:
 *   - POST — link or unlink the calculation to a BoQItem.
 *            Body: `{ boqItemId?: string }`.
 *              - If `boqItemId` is provided → `linkToBoqItem(id, boqItemId)`.
 *              - If `boqItemId` is null/undefined/empty → `unlinkFromBoqItem(id)`.
 *
 * Per BR-13: "Quantity edits via calculator application write qty + store record."
 * This route implements the "store record" half: the calculation record's link
 * to a BoQItem is established (or removed). The "write qty" half is performed
 * by a separate route (the engineer reviews the calculator's output and
 * applies the quantity to the BoQItem — the calculator's job is to produce
 * the number, not write it directly).
 *
 * Per BR-WEB-5: mutations require an authenticated session.
 * Per BR-WEB-8: mutations write to AuditLog.
 * Per BR-WEB-11: server-side input validation via zod.
 *
 * Per F5 (orphan-safe): `unlinkFromBoqItem` keeps `linkedAt` for audit (the
 * orphaned record remains visible with its original link timestamp).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import {
  json,
  notFound,
  withErrorHandler,
  writeAuditLog,
} from "@/lib/api-helpers";
import { getServices } from "@/lib/services";

// Body schema: `boqItemId` is optional — omit/null/empty means unlink.
const LinkBodySchema = z.object({
  boqItemId: z.string().optional().nullable(),
});

// ─── POST /api/calculations/[id]/link ────────────────────────────────────
export const POST = withErrorHandler(
  async (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    const body = LinkBodySchema.parse(await req.json());

    // Branch: link or unlink. Empty string / null / undefined → unlink.
    const boqItemId = body.boqItemId && body.boqItemId.length > 0
      ? body.boqItemId
      : null;

    let record;
    let action: string;
    if (boqItemId) {
      record = await services.calculation.linkToBoqItem(id, boqItemId);
      action = "calculation.link";
    } else {
      record = await services.calculation.unlinkFromBoqItem(id);
      action = "calculation.unlink";
    }

    // Repository returns null when the calculation record doesn't exist.
    if (!record) return notFound("Calculation not found");

    // BR-WEB-8: audit the mutation.
    await writeAuditLog({
      action,
      entityType: "CalculationRecord",
      entityId: id,
      afterJson: {
        linkedBoqItemId: record.linkedBoqItemId,
        linkedAt: record.linkedAt,
      },
    });

    return json({ calculation: record });
  },
);
