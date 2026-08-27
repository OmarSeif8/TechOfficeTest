/**
 * IRateAnalysisRepository — interface for RateAnalysis persistence.
 *
 * Lives in src/domain/repositories/ (pure interface — no Prisma imports).
 * Implementation: src/infrastructure/persistence/prisma/rate-analysis-repository.ts (WO-W-2-d).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this is what makes the domain layer
 * portable. The interface is imported by both the domain layer (for type
 * hints) and the infrastructure layer (for implementation).
 *
 * RateAnalysis is the per-item cost breakdown (materials, labor, equipment,
 * subcontract) that produces the unit `totalRate` for a RATE_BASED BoQItem per
 * BR-8, BR-9, BR-10. The totalRate is COMPUTED BY THE DOMAIN LAYER
 * (`computeRate` from `@domain/estimating/rate-analysis`); the repository just
 * persists it as a string. The repository NEVER computes money.
 *
 * `applyToBoqItem()` is the CRITICAL dual-write operation: it links an existing
 * analysis to a BoQItem AND writes the analysis's `totalRate` to the
 * `BoQItem.rate` column in the SAME transaction. This is what makes the rate
 * analysis "take effect" on the BoQ. Per the spec: "The `applyToBoqItem`
 * writes that string to the BoQItem.rate column directly."
 *
 * Optimistic concurrency (BR-WEB-4): `update()` and `applyToBoqItem()` take an
 * `expectedVersion` and return a tagged-union result on version mismatch.
 *
 * Entity types come from @shared/entities (plain TS interfaces — no Prisma dep).
 */

import type {
  RateAnalysis,
  RateAnalysisLine,
  RateAnalysisLaborMode,
  RateAnalysisLineType,
} from "@shared/entities";

/**
 * A single rate-analysis line input.
 *
 * All money/qty fields are decimal strings (BR-1 — decimal.js on the consuming
 * side). `total` is computed by the domain layer (BR-8/9) and persisted
 * verbatim — the repository does not recompute it.
 *
 * `wastePct` applies only to MATERIAL lines (BR-8); ignored otherwise.
 */
export interface RateAnalysisLineInput {
  lineType: RateAnalysisLineType;
  descriptionEn: string;
  descriptionAr?: string | null;
  /** Decimal string — consumption qty (or crew-days for CREW labor). */
  quantity: string;
  /** → ProjectUnit.id; null for crew-mode labor (no unit). */
  unitId?: string | null;
  /** Decimal string — unit cost (or daily crew cost in CREW mode). */
  unitPrice: string;
  /** Decimal string — materials waste factor (e.g. "5" for 5%). */
  wastePct: string;
  /** Decimal string — computed line total (qty × unitPrice × (1+waste)). */
  total: string;
  /** Sort order within the analysis (0-based; preserved on read). */
  sortOrder: number;
}

/**
 * Input shape for `create()`.
 *
 * - `boqItemId` is OPTIONAL — an analysis can exist without an item per the
 *   spec ("analysis can exist without an item"). The analysis is linked to a
 *   BoQItem later via `applyToBoqItem()`.
 * - `lines` MUST be a non-empty array (BR-9: direct cost = Σ line costs;
 *   an analysis with no lines has a direct cost of zero — caller's
 *   responsibility to validate).
 *
 * `create()` is transactional — the analysis row + all lines are inserted
 * atomically.
 */
export interface RateAnalysisCreateInput {
  /** Optional — analysis can exist without an item per spec. */
  boqItemId?: string | null;
  projectId: string;
  /** Decimal string — computed by `computeRate` from `@domain/estimating/rate-analysis`. */
  totalRate: string;
  /** Decimal string — overhead % applied (BR-10). */
  overheadPct: string;
  /** Decimal string — profit % applied (BR-10). */
  profitPct: string;
  /** Labor mode (BR-9): CONSUMPTION (default) or CREW. */
  laborMode: RateAnalysisLaborMode;
  /** The cost component lines. */
  lines: RateAnalysisLineInput[];
}

/**
 * Input shape for `update()`.
 *
 * All fields are optional except `expectedVersion`. If `lines` is provided,
 * ALL existing lines are deleted and replaced with the new ones (replace
 * pattern) — partial line updates are not supported.
 */
export interface RateAnalysisUpdateInput {
  totalRate?: string;
  overheadPct?: string;
  profitPct?: string;
  laborMode?: RateAnalysisLaborMode;
  /** If provided, replaces ALL existing lines (delete + recreate). */
  lines?: RateAnalysisLineInput[];
  /** For optimistic concurrency (BR-WEB-4). Must match the current version. */
  expectedVersion: number;
}

/**
 * Result of an `update()` or `applyToBoqItem()` operation.
 *
 * On version mismatch, returns `{ kind: "conflict", currentVersion }` instead
 * of throwing — caller decides how to handle.
 */
export type RateAnalysisUpdateResult =
  | { kind: "ok"; rateAnalysis: RateAnalysis }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

/**
 * Repository interface for RateAnalysis persistence.
 *
 * The `delete()` is a HARD delete (cascade to lines). The `applyToBoqItem()`
 * is the critical dual-write operation — see method docstring.
 */
export interface IRateAnalysisRepository {
  /**
   * Fetch a single analysis by id. Optionally include lines via the Prisma
   * relation. Returns null if not found.
   */
  getById(id: string, includeLines?: boolean): Promise<RateAnalysis | null>;

  /**
   * Fetch the analysis linked to a BoQItem, if any. Uses the `boqItemId`
   * unique index (1:1 per schema).
   */
  getByBoqItemId(boqItemId: string): Promise<RateAnalysis | null>;

  /**
   * Fetch the analysis AND all its lines in one call. Returns null if the
   * analysis doesn't exist.
   */
  getWithLines(id: string): Promise<{ rateAnalysis: RateAnalysis; lines: RateAnalysisLine[] } | null>;

  /**
   * Create a new analysis + all its lines in ONE transaction. The analysis
   * starts at version=1. Returns the persisted analysis row (without lines —
   * use `getWithLines()` to fetch the lines).
   */
  create(input: RateAnalysisCreateInput): Promise<RateAnalysis>;

  /**
   * Update an analysis with optimistic concurrency (BR-WEB-4). If `lines`
   * is provided, all existing lines are deleted and recreated (replace
   * pattern) within the same transaction as the analysis update.
   *
   * Returns a tagged-union result — caller decides how to handle conflicts.
   */
  update(id: string, input: RateAnalysisUpdateInput): Promise<RateAnalysisUpdateResult>;

  /**
   * CRITICAL dual-write operation.
   *
   * Sets `RateAnalysis.boqItemId` AND updates the linked `BoQItem.rate` to
   * `RateAnalysis.totalRate` in the SAME transaction. The BoQItem must
   * exist (verified before the transaction starts).
   *
   * Returns a tagged-union result:
   *   - `ok` — both writes succeeded; the analysis (with new version) is returned.
   *   - `not_found` — the analysis or the BoQItem doesn't exist.
   *   - `conflict` — version mismatch on the analysis; currentVersion returned.
   *
   * This is the operation that "applies" the rate analysis to the BoQ. After
   * this call, the BoQItem's `rate` reflects the analysis's `totalRate`.
   */
  applyToBoqItem(id: string, boqItemId: string, expectedVersion: number): Promise<RateAnalysisUpdateResult>;

  /**
   * Hard delete an analysis AND its lines (cascade). Does NOT version-check
   * — once deleted, the data is gone (this matches the audit-log semantics
   * for an analysis: if you delete it, you delete it; you don't get a
   * tombstone).
   *
   * Throws if the analysis doesn't exist.
   */
  delete(id: string): Promise<void>;
}
