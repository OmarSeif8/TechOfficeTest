/**
 * ICalculationRepository — interface for CalculationRecord persistence.
 *
 * Lives in src/domain/repositories/ (pure interface — no Prisma imports).
 * Implementation: src/infrastructure/persistence/prisma/calculation-repository.ts (WO-W-2-d).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this is what makes the domain layer
 * portable. The interface is imported by both the domain layer (for type
 * hints) and the infrastructure layer (for implementation).
 *
 * Per F5 (orphan-safe): a CalculationRecord can exist unlinked
 * (`linkedBoqItemId = null`). If the linked BoQItem is deleted, the
 * CalculationRecord survives with `linkedBoqItemId` set to null (the FK has
 * `onDelete: SetNull` per the schema). The "orphaned" record remains visible
 * in the calculation history.
 *
 * Per the WO-W-2-d spec, CalculationRecords are an immutable audit log —
 * no optimistic concurrency needed (the schema has a `version` column for
 * forward-compat but it is not exposed at the entity/repo interface level).
 * Deletes are HARD deletes (calculation records are disposable per the spec —
 * re-running the calculator produces a fresh row).
 *
 * Entity types come from @shared/entities (plain TS interfaces — no Prisma dep).
 */

import type { CalculationRecord, CalculatorType } from "@shared/entities";

/**
 * Input shape for `create()`.
 *
 * - `inputsJson` / `resultJson`: JSON-serialized calculator inputs/results.
 *   The repository does not parse these — it stores them verbatim as a
 *   tamper-evident audit trail.
 * - `resultQuantity` / `resultUnitId`: the headline scalar result of the
 *   calculator (e.g., concrete volume in m³). `resultUnitId` is optional
 *   because some calculators may produce a unit-less result.
 */
export interface CalculationRecordCreateInput {
  projectId: string;
  calculatorType: CalculatorType;
  inputsJson: string;
  resultJson: string;
  resultQuantity: string;
  resultUnitId?: string | null;
}

/**
 * Repository interface for CalculationRecord persistence.
 *
 * Notes:
 * - `linkToBoqItem` and `unlinkFromBoqItem` are NOT version-checked — the
 *   record is an audit log and the link state is mutable. The schema has
 *   `version` for forward-compat only.
 * - `unlinkFromBoqItem` keeps `linkedAt` for audit (per the WO-W-2-d spec —
 *   "orphaned records remain visible").
 * - `delete` is a HARD delete — calculation records are disposable.
 */
export interface ICalculationRepository {
  /**
   * List all calculation records for a project, optionally filtered by
   * calculator type. Ordered by `createdAt DESC` (most recent first).
   */
  listByProject(projectId: string, calculatorType?: CalculatorType): Promise<CalculationRecord[]>;

  /** Fetch a single record by id. Returns null if not found. */
  getById(id: string): Promise<CalculationRecord | null>;

  /** Create a new audit-log record. Returns the persisted row. */
  create(input: CalculationRecordCreateInput): Promise<CalculationRecord>;

  /**
   * Link an existing calculation record to a BoQItem. Sets
   * `linkedBoqItemId` and `linkedAt = now()`. Returns null if the
   * calculation record doesn't exist.
   */
  linkToBoqItem(id: string, boqItemId: string): Promise<CalculationRecord | null>;

  /**
   * Unlink a calculation record from its BoQItem. Sets `linkedBoqItemId = null`
   * but KEEPS `linkedAt` for audit (per F5 — orphaned records remain visible
   * with their original link timestamp). Returns null if the calculation
   * record doesn't exist.
   */
  unlinkFromBoqItem(id: string): Promise<CalculationRecord | null>;

  /** Hard delete a calculation record. Throws if the record doesn't exist. */
  delete(id: string): Promise<void>;
}
