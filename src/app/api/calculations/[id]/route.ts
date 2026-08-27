/**
 * API Route: /api/calculations/[id]
 *
 * Per WO-W-11:
 *   - GET    — fetch a single calculation record by id.
 *   - DELETE — hard delete the record (calculation records are disposable per
 *              the spec — re-running the calculator produces a fresh row).
 *
 * Per BR-WEB-5: mutations require an authenticated session.
 * Per BR-WEB-8: mutations write to AuditLog.
 * Per BR-WEB-11: no body on GET; DELETE takes no body.
 */

import type { NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  json,
  noContent,
  notFound,
  withErrorHandler,
  writeAuditLog,
} from "@/lib/api-helpers";
import { getServices } from "@/lib/services";

// ─── GET /api/calculations/[id] ──────────────────────────────────────────
export const GET = withErrorHandler(
  async (
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    const record = await services.calculation.getById(id);
    if (!record) return notFound("Calculation not found");

    return json({ calculation: record });
  },
);

// ─── DELETE /api/calculations/[id] ────────────────────────────────────────
export const DELETE = withErrorHandler(
  async (
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    await requireUserId();
    const { id } = await ctx.params;
    const services = getServices();

    // Fetch before delete so we can audit (the audit needs the entity state
    // prior to deletion — best-effort).
    const existing = await services.calculation.getById(id);
    if (!existing) return notFound("Calculation not found");

    await services.calculation.delete(id);

    // BR-WEB-8: audit the mutation.
    await writeAuditLog({
      action: "calculation.delete",
      entityType: "CalculationRecord",
      entityId: id,
      beforeJson: existing,
    });

    return noContent();
  },
);
