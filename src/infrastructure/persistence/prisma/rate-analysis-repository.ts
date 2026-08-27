/**
 * PrismaRateAnalysisRepository — Prisma implementation of IRateAnalysisRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/ (server-only). Per
 * CONSTITUTION_V1.1_WEB §3.3, this is the layer that knows about Prisma.
 * The domain layer sees only the IRateAnalysisRepository interface.
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Per the WO-W-2-d spec:
 *   - The repository does NOT compute money — `totalRate` is computed by the
 *     domain layer (`computeRate` from `@domain/estimating/rate-analysis`).
 *     The repository just persists the string.
 *   - `applyToBoqItem()` is the CRITICAL dual-write: it sets
 *     `RateAnalysis.boqItemId` AND writes `RateAnalysis.totalRate` to
 *     `BoQItem.rate` in the SAME transaction. This is what makes the rate
 *     analysis "take effect" on the BoQ.
 *   - `create()` is transactional — analysis + all lines inserted atomically.
 *   - `update()` with `lines` replaces all existing lines (delete + recreate).
 *   - `delete()` is a hard delete with cascade to lines.
 *
 * Optimistic concurrency (BR-WEB-4): `update()` and `applyToBoqItem()` use
 * `updateMany` with `version: expectedVersion` in the WHERE clause, then
 * re-read on miss to disambiguate "not_found" from "version mismatch".
 *
 * Schema-spec deviation (see DEVIATIONS section in worklog):
 *   - The Prisma schema declares `RateAnalysis.boqItemId String @unique` (non-null).
 *   - The spec interface allows `boqItemId?: string | null` (analysis can exist
 *     without an item).
 *   - The current implementation REQUIRES boqItemId in `create()` (throws on null)
 *     because the schema enforces non-null. The interface still accepts null per
 *     spec — a future schema update (make boqItemId nullable) would remove this
 *     restriction. Tests pass a valid boqItemId at create time, then call
 *     `applyToBoqItem()` to write the totalRate to BoQItem.rate.
 */

import { db } from "@/lib/db";
import type {
  RateAnalysis,
  RateAnalysisLine,
  RateAnalysisLaborMode,
  RateAnalysisLineType,
} from "@shared/entities";
import type {
  IRateAnalysisRepository,
  RateAnalysisLineInput,
  RateAnalysisCreateInput,
  RateAnalysisUpdateInput,
  RateAnalysisUpdateResult,
} from "@domain/repositories/rate-analysis-repository";
import type {
  RateAnalysis as PrismaRateAnalysis,
  RateAnalysisLine as PrismaRateAnalysisLine,
  LaborMode as PrismaLaborMode,
  RateAnalysisLineType as PrismaRateAnalysisLineType,
  Prisma,
} from "@prisma/client";

// ─── Mappers ────────────────────────────────────────────────────────────────

/**
 * Map a Prisma RateAnalysis row to the @shared/entities RateAnalysis.
 *
 * The Prisma row has `boqItemId: string` (non-null per schema). The entity
 * declares `boqItemId: string | null` (per spec) — wider type, so the cast
 * is sound. `LaborMode` (Prisma enum) is structurally identical to
 * `RateAnalysisLaborMode` (entity union) — same string values.
 */
function mapAnalysisToEntity(row: PrismaRateAnalysis): RateAnalysis {
  return row as unknown as RateAnalysis;
}

function mapLineToEntity(row: PrismaRateAnalysisLine): RateAnalysisLine {
  return row as unknown as RateAnalysisLine;
}

/**
 * Build a Prisma `RateAnalysisLineUncheckedCreateInput` for use with
 * `createMany` (which doesn't accept nested-write objects, only plain data).
 *
 * `rateAnalysisId` is included explicitly because `createMany` doesn't
 * infer it from the parent context (unlike nested-create in `db.rateAnalysis.create`).
 *
 * The `total` field is persisted verbatim — the domain layer computed it; the
 * repository does NOT recompute money.
 */
function lineToPrismaData(
  line: RateAnalysisLineInput,
  rateAnalysisId: string,
): Prisma.RateAnalysisLineUncheckedCreateInput {
  return {
    rateAnalysisId,
    lineType: line.lineType as PrismaRateAnalysisLineType,
    descriptionEn: line.descriptionEn,
    descriptionAr: line.descriptionAr ?? null,
    quantity: line.quantity,
    unitId: line.unitId ?? null,
    unitPrice: line.unitPrice,
    wastePct: line.wastePct,
    total: line.total,
    sortOrder: line.sortOrder,
  };
}

/**
 * Build the line data WITHOUT `rateAnalysisId` — for use with nested-create
 * in `db.rateAnalysis.create({ data: { lines: { create: [...] } } })`, where
 * Prisma infers `rateAnalysisId` from the parent context.
 *
 * We type this as `Omit<Prisma.RateAnalysisLineUncheckedCreateInput, 'rateAnalysisId'>`
 * because the UncheckedCreateInput type lists `rateAnalysisId` as a required
 * field (it's a NOT-NULL FK column), but Prisma's nested-create API accepts
 * the omitted form and infers the FK from the parent. The Omit<> accurately
 * describes the shape we hand to Prisma.
 */
function lineToPrismaDataWithoutId(
  line: RateAnalysisLineInput,
): Omit<Prisma.RateAnalysisLineUncheckedCreateInput, "rateAnalysisId"> {
  return {
    lineType: line.lineType as PrismaRateAnalysisLineType,
    descriptionEn: line.descriptionEn,
    descriptionAr: line.descriptionAr ?? null,
    quantity: line.quantity,
    unitId: line.unitId ?? null,
    unitPrice: line.unitPrice,
    wastePct: line.wastePct,
    total: line.total,
    sortOrder: line.sortOrder,
  };
}

/**
 * Sentinel thrown from inside a `$transaction` callback to signal an
 * optimistic-concurrency conflict. Catching this in the outer function
 * lets us return the tagged-union `conflict` variant instead of throwing
 * to the caller.
 */
class ConcurrencyConflict extends Error {
  constructor() {
    super("CONCURRENCY_CONFLICT");
    this.name = "ConcurrencyConflict";
    Object.setPrototypeOf(this, ConcurrencyConflict.prototype);
  }
}

export class PrismaRateAnalysisRepository implements IRateAnalysisRepository {
  // ─── getById ──────────────────────────────────────────────────────────

  /**
   * Fetch a single analysis by id. When `includeLines` is true, the Prisma
   * `lines` relation is included — but the returned entity type omits
   * lines (the entity is just the analysis row). Callers wanting lines
   * should use `getWithLines()` which returns both.
   *
   * The `includeLines` flag exists in the interface to allow callers to
   * optimize a single round-trip when they need lines for display. Here
   * we honor it by including the relation, but the entity type cast drops
   * it (it's still cached on the Prisma row if a future caller wants it).
   */
  async getById(id: string, includeLines?: boolean): Promise<RateAnalysis | null> {
    const row = await db.rateAnalysis.findUnique({
      where: { id },
      ...(includeLines ? { include: { lines: true } } : {}),
    });
    return row ? mapAnalysisToEntity(row) : null;
  }

  // ─── getByBoqItemId ───────────────────────────────────────────────────

  /**
   * Fetch the analysis linked to a BoQItem, if any. Uses the `boqItemId`
   * unique index (1:1 per schema) via `findUnique`. Returns null if no
   * analysis is linked.
   */
  async getByBoqItemId(boqItemId: string): Promise<RateAnalysis | null> {
    const row = await db.rateAnalysis.findUnique({
      where: { boqItemId },
    });
    return row ? mapAnalysisToEntity(row) : null;
  }

  // ─── getWithLines ─────────────────────────────────────────────────────

  /**
   * Fetch the analysis AND all its lines in one call (single SQL round-trip
   * via Prisma's `include`). Returns null if the analysis doesn't exist.
   *
   * The lines are ordered by `sortOrder ASC` to preserve the user's chosen
   * display order (BR-style convention: lines have an explicit sortOrder).
   */
  async getWithLines(
    id: string,
  ): Promise<{ rateAnalysis: RateAnalysis; lines: RateAnalysisLine[] } | null> {
    const row = await db.rateAnalysis.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!row) return null;
    return {
      rateAnalysis: mapAnalysisToEntity(row),
      // `row.lines` is typed as PrismaRateAnalysisLine[] — cast each to entity.
      lines: (row.lines ?? []).map(mapLineToEntity),
    };
  }

  // ─── create ──────────────────────────────────────────────────────────

  /**
   * Create a new analysis + all its lines in ONE transaction.
   *
   * The analysis starts at version=1 (schema default). The lines are inserted
   * via Prisma's nested-write API (`lines: { create: [...] }`), which Prisma
   * executes as a single SQL transaction — atomicity is guaranteed.
   *
   * Schema deviation (see file header): the Prisma schema requires
   * `boqItemId` to be non-null. If the caller passes null/undefined, we
   * throw with a clear message pointing to the deviation. A future schema
   * update (make boqItemId nullable) would remove this restriction.
   */
  async create(input: RateAnalysisCreateInput): Promise<RateAnalysis> {
    if (input.boqItemId == null) {
      throw new Error(
        "PrismaRateAnalysisRepository.create: boqItemId is required by the Prisma schema " +
          "(RateAnalysis.boqItemId is non-nullable String @unique). The interface allows null per spec, " +
          "but the impl rejects null until the schema is updated. Pass a valid BoQItem id at create time, " +
          "then use applyToBoqItem() to write the analysis's totalRate to the BoQItem.rate column.",
      );
    }

    const row = await db.rateAnalysis.create({
      data: {
        boqItemId: input.boqItemId,
        projectId: input.projectId,
        totalRate: input.totalRate,
        overheadPct: input.overheadPct,
        profitPct: input.profitPct,
        laborMode: input.laborMode as PrismaLaborMode,
        version: 1, // explicit; matches schema @default(1)
        lines: {
          create: input.lines.map((line) => lineToPrismaDataWithoutId(line)),
        },
      },
    });

    return mapAnalysisToEntity(row);
  }

  // ─── update ──────────────────────────────────────────────────────────

  /**
   * Update an analysis with optimistic concurrency (BR-WEB-4).
   *
   * If `lines` is provided, ALL existing lines are deleted and re-created
   * (replace pattern) within the same transaction. This is simpler than
   * diffing line-by-line and matches the spec's "if provided, replaces all
   * lines" semantics.
   *
   * The optimistic concurrency check uses `updateMany` with `version:
   * expectedVersion` in the WHERE clause. If 0 rows match, the transaction
   * is aborted (via `ConcurrencyConflict` throw) and we re-read to
   * disambiguate "not_found" from "version mismatch".
   */
  async update(
    id: string,
    input: RateAnalysisUpdateInput,
  ): Promise<RateAnalysisUpdateResult> {
    // Strip expectedVersion — it's part of the WHERE, not the SET.
    const { expectedVersion, lines, ...fields } = input;

    // Build the SET data — only include fields the caller actually provided.
    const data: Record<string, unknown> = {};
    if (fields.totalRate !== undefined) data.totalRate = fields.totalRate;
    if (fields.overheadPct !== undefined) data.overheadPct = fields.overheadPct;
    if (fields.profitPct !== undefined) data.profitPct = fields.profitPct;
    if (fields.laborMode !== undefined) {
      data.laborMode = fields.laborMode as PrismaLaborMode;
    }

    try {
      const updated = await db.$transaction(async (tx) => {
        // 1. Optimistic concurrency check via updateMany (single SQL statement).
        //    If 0 rows match (id not found OR version mismatch), abort via throw.
        const result = await tx.rateAnalysis.updateMany({
          where: { id, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });

        if (result.count === 0) {
          // Throw to abort the transaction. The outer catch translates this
          // to either "not_found" or "conflict".
          throw new ConcurrencyConflict();
        }

        // 2. If lines provided, replace all existing lines (delete + recreate).
        if (lines !== undefined) {
          await tx.rateAnalysisLine.deleteMany({ where: { rateAnalysisId: id } });
          if (lines.length > 0) {
            await tx.rateAnalysisLine.createMany({
              data: lines.map((line) => lineToPrismaData(line, id)),
            });
          }
        }

        // 3. Fetch the updated analysis row to return.
        return await tx.rateAnalysis.findUnique({ where: { id } });
      });

      return { kind: "ok" as const, rateAnalysis: mapAnalysisToEntity(updated!) };
    } catch (err) {
      if (err instanceof ConcurrencyConflict) {
        // Re-read to disambiguate: was it "not found" or "version mismatch"?
        const existing = await db.rateAnalysis.findUnique({ where: { id } });
        if (!existing) {
          return { kind: "not_found" as const };
        }
        return {
          kind: "conflict" as const,
          currentVersion: existing.version,
        };
      }
      throw err;
    }
  }

  // ─── applyToBoqItem ──────────────────────────────────────────────────

  /**
   * CRITICAL dual-write operation.
   *
   * Sets `RateAnalysis.boqItemId` AND updates `BoQItem.rate` to
   * `RateAnalysis.totalRate` in the SAME transaction.
   *
   * Workflow:
   *   1. Fetch the analysis to get its `totalRate` (we need this for the
   *      BoQItem.rate update). Returns `not_found` if missing.
   *   2. Verify the BoQItem exists. Returns `not_found` if missing.
   *   3. Open a `$transaction`:
   *      a. `updateMany` on RateAnalysis with `version: expectedVersion` in
   *         the WHERE clause. If 0 rows match, throw ConcurrencyConflict to
   *         abort the transaction. Otherwise, `boqItemId` is set (idempotent
   *         if already set to the same value) and `version` is incremented.
   *      b. `update` on BoQItem: `rate = analysis.totalRate`. This is the
   *         write that "applies" the analysis to the BoQ. Note: we do NOT
   *         version-check the BoQItem — the analysis is the source of truth
   *         for the rate; if a concurrent writer is editing the BoQItem's
   *         rate, they'll see the analysis-applied rate next read.
   *   4. On ConcurrencyConflict: re-read the analysis to return currentVersion.
   *
   * Note: in the current Prisma schema, `boqItemId` is non-nullable, so
   * `applyToBoqItem` is functionally a no-op on `boqItemId` (it was set at
   * create time). The CRITICAL part is the BoQItem.rate write. The boqItemId
   * "set" is preserved in the implementation for forward-compat — when the
   * schema is updated to allow nullable boqItemId, this same code path will
   * handle the "link after create" workflow.
   */
  async applyToBoqItem(
    id: string,
    boqItemId: string,
    expectedVersion: number,
  ): Promise<RateAnalysisUpdateResult> {
    // 1. Fetch the analysis — we need its `totalRate` for the BoQItem write.
    const analysis = await db.rateAnalysis.findUnique({ where: { id } });
    if (!analysis) {
      return { kind: "not_found" as const };
    }

    // 2. Verify the BoQItem exists (per spec).
    const boqItem = await db.boQItem.findUnique({ where: { id: boqItemId } });
    if (!boqItem) {
      return { kind: "not_found" as const };
    }

    // 3. Transaction: update analysis (version check + set boqItemId) +
    //    update BoQItem.rate. Both writes commit together or neither does.
    try {
      const updated = await db.$transaction(async (tx) => {
        // a. Optimistic concurrency check on the analysis.
        const result = await tx.rateAnalysis.updateMany({
          where: { id, version: expectedVersion },
          data: {
            boqItemId, // set the link (idempotent if already set)
            version: { increment: 1 },
          },
        });

        if (result.count === 0) {
          // Version mismatch (or, very unusually, the analysis was deleted
          // between our pre-flight fetch and the transaction). Abort.
          throw new ConcurrencyConflict();
        }

        // b. Write the analysis's totalRate to the BoQItem's rate column.
        //    This is the "apply" step — the BoQ now reflects the analysis.
        await tx.boQItem.update({
          where: { id: boqItemId },
          data: { rate: analysis.totalRate },
        });

        // c. Fetch the updated analysis row to return.
        return await tx.rateAnalysis.findUnique({ where: { id } });
      });

      return { kind: "ok" as const, rateAnalysis: mapAnalysisToEntity(updated!) };
    } catch (err) {
      if (err instanceof ConcurrencyConflict) {
        // Re-read to return currentVersion for the caller's retry logic.
        const existing = await db.rateAnalysis.findUnique({ where: { id } });
        if (!existing) {
          return { kind: "not_found" as const };
        }
        return {
          kind: "conflict" as const,
          currentVersion: existing.version,
        };
      }
      throw err;
    }
  }

  // ─── delete ──────────────────────────────────────────────────────────

  /**
   * Hard delete an analysis AND its lines (cascade).
   *
   * The Prisma schema declares `onDelete: Cascade` on the RateAnalysisLine
   * → RateAnalysis FK, so deleting the analysis automatically deletes its
   * lines. We rely on this cascade — no need to deleteMany on lines first.
   *
   * Uses `deleteMany` + count check (instead of `delete` + try/catch) to
   * avoid the P2025 throw path. If the id doesn't exist, this is a silent
   * no-op — matching the "disposable" semantic. The spec says `delete(id):
   * Promise<void>` (no return value), so the caller can't tell the
   * difference between "deleted" and "already gone" — which is fine.
   */
  async delete(id: string): Promise<void> {
    await db.rateAnalysis.deleteMany({ where: { id } });
  }
}
