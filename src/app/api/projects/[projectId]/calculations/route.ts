/**
 * API Route: /api/projects/[projectId]/calculations
 *
 * Per WO-W-11:
 *   - GET  — list calculation records for the project (optional `?type=` filter).
 *   - POST — compute a calculation, persist the audit record, optionally link
 *            to a BoQItem, and return the record + computed result.
 *
 * Per BR-WEB-5: mutations require an authenticated session.
 * Per BR-WEB-8: mutations write to AuditLog.
 * Per BR-WEB-11: server-side input validation via zod (calculator-specific
 *   schemas dispatched per `calculatorType`).
 * Per BR-WEB-12: domain calculators are pure — never touch req/res.
 *
 * Calculator dispatch (per spec): a `switch` on `calculatorType` selects the
 * matching schema (for validation) and the matching domain function (for
 * computation). The dispatch returns a normalized `{ result, headlineQuantity,
 * unitCode }` shape — the route persists `headlineQuantity` as `resultQuantity`
 * and looks up the `Unit.id` by `unitCode` for `resultUnitId`.
 *
 * Per BR-13: "Quantity edits via calculator application write qty + store
 * record" — linking the record to a BoQItem (via `linkToBoqItem`) is the
 * "store record" half; the BoQItem's own quantity update is performed by a
 * separate route (the calculator's job is to produce the number, not write it
 * directly to the BoQItem — that would bypass the engineer's review).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import {
  created,
  json,
  withErrorHandler,
  writeAuditLog,
} from "@/lib/api-helpers";
import { getServices } from "@/lib/services";
import { db } from "@/lib/db";

// ─── Calculator domain functions (pure) ──────────────────────────────────
import { computeConcrete } from "@domain/calculators/concrete";
import { computeFormwork } from "@domain/calculators/formwork";
import { computeRebar } from "@domain/calculators/rebar";
import { computeMasonry } from "@domain/calculators/masonry";
import { computePlaster } from "@domain/calculators/plaster";
import { computePaint } from "@domain/calculators/paint";

// ─── Calculator zod schemas (input validation — BR-WEB-11) ───────────────
import {
  CalculatorTypeSchema,
  ConcreteCalculatorInputSchema,
  FormworkCalculatorInputSchema,
  RebarCalculatorInputSchema,
  MasonryCalculatorInputSchema,
  PlasterCalculatorInputSchema,
  PaintCalculatorInputSchema,
  type CalculatorType,
} from "@shared/schemas/calculator";

// ─── Dispatch helpers ────────────────────────────────────────────────────

/**
 * Normalized output of the calculator dispatcher.
 *
 * - `result` is the raw calculator-specific result object (persisted verbatim
 *   as `resultJson` — the audit trail).
 * - `headlineQuantity` is the primary scalar result (e.g., totalVolume for
 *   concrete, totalArea for formwork, totalWeightKg for rebar) — persisted as
 *   `resultQuantity`.
 * - `unitCode` is the unit code (e.g., "m3", "m2", "kg") — looked up against
 *   the Unit table to get `resultUnitId`.
 */
interface ComputeOutput {
  result: unknown;
  headlineQuantity: string;
  unitCode: "m3" | "m2" | "kg";
}

/**
 * Pure dispatcher: validates inputs against the matching zod schema, then
 * calls the matching domain calculator function. Returns a normalized
 * `ComputeOutput`.
 *
 * @throws ZodError on invalid inputs (caught by `withErrorHandler` → 400).
 * @throws Error on unknown calculatorType (exhaustiveness check).
 */
async function compute(
  calculatorType: CalculatorType,
  inputs: unknown,
): Promise<ComputeOutput> {
  switch (calculatorType) {
    case "CONCRETE": {
      const result = computeConcrete(ConcreteCalculatorInputSchema.parse(inputs));
      return { result, headlineQuantity: result.totalVolume, unitCode: result.unit };
    }
    case "FORMWORK": {
      const result = computeFormwork(FormworkCalculatorInputSchema.parse(inputs));
      return { result, headlineQuantity: result.totalArea, unitCode: result.unit };
    }
    case "REBAR": {
      const result = computeRebar(RebarCalculatorInputSchema.parse(inputs));
      return { result, headlineQuantity: result.totalWeightKg, unitCode: result.unit };
    }
    case "MASONRY": {
      const result = computeMasonry(MasonryCalculatorInputSchema.parse(inputs));
      return { result, headlineQuantity: result.volume, unitCode: result.unit };
    }
    case "PLASTER": {
      const result = computePlaster(PlasterCalculatorInputSchema.parse(inputs));
      return { result, headlineQuantity: result.netArea, unitCode: result.unit };
    }
    case "PAINT": {
      const result = computePaint(PaintCalculatorInputSchema.parse(inputs));
      return { result, headlineQuantity: result.totalCoatArea, unitCode: result.unit };
    }
    default: {
      // Exhaustiveness check — TypeScript guarantees we never get here at
      // compile time; runtime callers bypassing zod would hit this.
      const _exhaustive: never = calculatorType;
      throw new Error(`compute: unknown calculatorType "${String(_exhaustive)}"`);
    }
  }
}

// ─── Request body schemas ─────────────────────────────────────────────────

/**
 * Body for `POST /api/projects/[projectId]/calculations`.
 *
 * `calculatorType` selects the dispatcher branch; `inputs` is the
 * calculator-specific input object (validated against the matching schema
 * inside `compute()`); `linkedBoqItemId` is optional and links the record to
 * a BoQItem (per BR-13) after creation.
 */
const CreateCalculationBodySchema = z.object({
  calculatorType: CalculatorTypeSchema,
  inputs: z.record(z.string(), z.unknown()),
  linkedBoqItemId: z.string().optional(),
});

/**
 * Query string schema for `GET /api/projects/[projectId]/calculations?type=`.
 *
 * `type` is optional; if present, must be a valid CalculatorType.
 */
const ListQuerySchema = z.object({
  type: CalculatorTypeSchema.optional(),
});

// ─── Ownership verification ──────────────────────────────────────────────

/**
 * Verify the project exists and is owned by `userId`. Throws "NOT_FOUND" or
 * "FORBIDDEN" (caught by `withErrorHandler` → 404/403).
 */
async function verifyProjectOwnership(
  projectId: string,
  userId: string,
): Promise<void> {
  const services = getServices();
  const project = await services.projects.getById(projectId);
  if (!project) throw new Error("NOT_FOUND");
  if (project.ownerId !== userId) throw new Error("FORBIDDEN");
}

// ─── GET /api/projects/[projectId]/calculations ───────────────────────────
export const GET = withErrorHandler(
  async (
    req: NextRequest,
    ctx: { params: Promise<{ projectId: string }> },
  ) => {
    const userId = await requireUserId();
    const { projectId } = await ctx.params;
    const services = getServices();

    // Verify project ownership (per spec — projectId-bearing routes check).
    await verifyProjectOwnership(projectId, userId);

    // Parse query string (optional `type` filter).
    const url = new URL(req.url);
    const query = ListQuerySchema.parse({
      type: url.searchParams.get("type") ?? undefined,
    });

    const records = await services.calculation.listByProject(
      projectId,
      query.type,
    );

    return json({ calculations: records });
  },
);

// ─── POST /api/projects/[projectId]/calculations ─────────────────────────
export const POST = withErrorHandler(
  async (
    req: NextRequest,
    ctx: { params: Promise<{ projectId: string }> },
  ) => {
    const userId = await requireUserId();
    const { projectId } = await ctx.params;
    const services = getServices();

    // Verify project ownership.
    await verifyProjectOwnership(projectId, userId);

    // Parse + validate the body (BR-WEB-11). The inner `inputs` object is
    // validated against the calculator-specific schema inside `compute()`.
    const body = CreateCalculationBodySchema.parse(await req.json());

    // Dispatch to the matching calculator (validates inputs + computes result).
    const output = await compute(body.calculatorType, body.inputs);

    // Look up the Unit.id by code (e.g., "m3" → Unit row). If not found,
    // persist `resultUnitId = null` — the record's `resultQuantity` is still
    // meaningful on its own.
    const unit = await db.unit.findUnique({
      where: { code: output.unitCode },
      select: { id: true },
    });

    // Persist the calculation record (audit trail — inputs/result are stored
    // verbatim as JSON strings; the repository does not parse them).
    const record = await services.calculation.create({
      projectId,
      calculatorType: body.calculatorType,
      inputsJson: JSON.stringify(body.inputs),
      resultJson: JSON.stringify(output.result),
      resultQuantity: output.headlineQuantity,
      resultUnitId: unit?.id ?? null,
    });

    // Optional: link the record to a BoQItem (BR-13 — "store record" half).
    if (body.linkedBoqItemId) {
      await services.calculation.linkToBoqItem(
        record.id,
        body.linkedBoqItemId,
      );
    }

    // BR-WEB-8: audit the mutation.
    await writeAuditLog({
      action: "calculation.create",
      entityType: "CalculationRecord",
      entityId: record.id,
      afterJson: {
        record,
        result: output.result,
        linkedBoqItemId: body.linkedBoqItemId ?? null,
      },
    });

    // Re-fetch the record to include the (possibly newly-set) linkedBoqItemId
    // + linkedAt fields for the response.
    const finalRecord = body.linkedBoqItemId
      ? await services.calculation.getById(record.id)
      : record;

    return created({
      calculation: finalRecord,
      result: output.result,
    });
  },
);
