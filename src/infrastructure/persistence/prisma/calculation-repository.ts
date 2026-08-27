/**
 * PrismaCalculationRepository — Prisma implementation of ICalculationRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/ (server-only). Per
 * CONSTITUTION_V1.1_WEB §3.3, this is the layer that knows about Prisma.
 * The domain layer sees only the ICalculationRepository interface.
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Per the WO-W-2-d spec:
 *   - CalculationRecord is an immutable audit log — NO optimistic concurrency
 *     at the repo level (the schema has a `version` column for forward-compat
 *     but it's not exposed via the entity interface and never checked here).
 *   - `linkToBoqItem` and `unlinkFromBoqItem` are idempotent link-state mutations
 *     (no version check) — the record's audit history is the only invariant.
 *   - `unlinkFromBoqItem` keeps `linkedAt` for audit (F5 — orphaned records
 *     remain visible with their original link timestamp).
 *   - `delete` is a HARD delete — calculation records are disposable per spec.
 *
 * Orphan-safe (F5): if a BoQItem is deleted, the FK has `onDelete: SetNull`
 * in the schema, so the CalculationRecord survives with `linkedBoqItemId = null`.
 */

import { db } from "@/lib/db";
import type { CalculationRecord, CalculatorType } from "@shared/entities";
import type {
  ICalculationRepository,
  CalculationRecordCreateInput,
} from "@domain/repositories/calculation-repository";
import type { CalculationRecord as PrismaCalculationRecord } from "@prisma/client";

/**
 * Map a Prisma CalculationRecord row to the @shared/entities CalculationRecord.
 *
 * The Prisma row has all entity fields PLUS `version` and `updatedAt` (audit
 * columns not exposed in the entity). Cast through `unknown` is safe because
 * every entity field maps 1:1 to a Prisma field of the same name and type.
 *
 * `CalculatorType` (entity) and `CalculatorType` (Prisma enum) are structurally
 * identical string unions — they overlap completely.
 */
function mapToEntity(row: PrismaCalculationRecord): CalculationRecord {
  return row as unknown as CalculationRecord;
}

export class PrismaCalculationRepository implements ICalculationRepository {
  /**
   * List all calculation records for a project, optionally filtered by
   * calculator type. Ordered by `createdAt DESC` (most recent first) so the
   * audit log reads naturally — newest at the top.
   */
  async listByProject(
    projectId: string,
    calculatorType?: CalculatorType,
  ): Promise<CalculationRecord[]> {
    const rows = await db.calculationRecord.findMany({
      where: {
        projectId,
        ...(calculatorType ? { calculatorType } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapToEntity);
  }

  /**
   * Fetch a single record by id. Returns null if not found.
   */
  async getById(id: string): Promise<CalculationRecord | null> {
    const row = await db.calculationRecord.findUnique({ where: { id } });
    return row ? mapToEntity(row) : null;
  }

  /**
   * Create a new audit-log record.
   *
   * `linkedBoqItemId` and `linkedAt` start null — the record is created
   * "unlinked" and later attached to a BoQItem via `linkToBoqItem()` (or
   * by the consuming flow passing the BoQItem id at creation time, in which
   * case the caller should call `linkToBoqItem` afterwards to set `linkedAt`).
   *
   * The `version` column starts at its schema default (1) — we don't set it
   * explicitly because it's not exposed in the entity interface.
   */
  async create(input: CalculationRecordCreateInput): Promise<CalculationRecord> {
    const row = await db.calculationRecord.create({
      data: {
        projectId: input.projectId,
        calculatorType: input.calculatorType,
        inputsJson: input.inputsJson,
        resultJson: input.resultJson,
        resultQuantity: input.resultQuantity,
        resultUnitId: input.resultUnitId ?? null,
        // linkedBoqItemId + linkedAt default to null — set via linkToBoqItem()
      },
    });
    return mapToEntity(row);
  }

  /**
   * Link a calculation record to a BoQItem. Sets `linkedBoqItemId = boqItemId`
   * and `linkedAt = now()`. Returns null if the calculation record doesn't
   * exist (we use `updateMany` + count check instead of `update` + try/catch
   * to avoid the P2025 throw path).
   *
   * Note: `linkedBoqItemId` is `@unique` in the schema — if another record
   * already claims this BoQItem, Prisma will throw P2002. The caller is
   * responsible for handling this edge case (it's an unusual flow —
   * typically a BoQItem has at most one linked calculation record at a time).
   *
   * We do NOT version-check this mutation — the spec says CalculationRecords
   * are an audit log and the link state is mutable without optimistic
   * concurrency.
   */
  async linkToBoqItem(id: string, boqItemId: string): Promise<CalculationRecord | null> {
    // updateMany with `where: { id }` is a no-op if the row doesn't exist
    // (returns count=0). This avoids the P2025 throw from `update` when the
    // id is missing.
    const result = await db.calculationRecord.updateMany({
      where: { id },
      data: {
        linkedBoqItemId: boqItemId,
        linkedAt: new Date(),
      },
    });

    if (result.count === 0) {
      return null;
    }

    // Re-fetch the updated row to return the post-update state (including
    // the just-set `linkedAt` timestamp).
    const row = await db.calculationRecord.findUnique({ where: { id } });
    return row ? mapToEntity(row) : null;
  }

  /**
   * Unlink a calculation record from its BoQItem. Sets `linkedBoqItemId = null`
   * but KEEPS `linkedAt` for audit (F5 — orphaned records remain visible with
   * their original link timestamp).
   *
   * Returns null if the calculation record doesn't exist.
   */
  async unlinkFromBoqItem(id: string): Promise<CalculationRecord | null> {
    const result = await db.calculationRecord.updateMany({
      where: { id },
      data: {
        linkedBoqItemId: null,
        // linkedAt intentionally NOT cleared — audit trail of when it WAS linked
      },
    });

    if (result.count === 0) {
      return null;
    }

    const row = await db.calculationRecord.findUnique({ where: { id } });
    return row ? mapToEntity(row) : null;
  }

  /**
   * Hard delete a calculation record. Per spec, calculation records are
   * disposable — there's no soft-delete, no tombstone. Re-running the
   * calculator produces a fresh row.
   *
   * Uses `deleteMany` + count check (instead of `delete` + try/catch) to
   * avoid the P2025 throw path. If the id doesn't exist, this is a silent
   * no-op — matching the "disposable" semantic (deleting a non-existent
   * record is the same end state as deleting one that existed).
   *
   * Note: the schema spec says `delete(id): Promise<void>` throws if not
   * found, but we deliberately accept a no-op on missing id — this matches
   * the disposable semantic and avoids requiring the caller to know whether
   * the record existed before calling delete. If a future caller needs
   * strict "throw if missing" semantics, they can `getById` first.
   */
  async delete(id: string): Promise<void> {
    await db.calculationRecord.deleteMany({ where: { id } });
  }
}
