/**
 * PrismaBoQRepository — Prisma implementation of IBoQRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/ (server-only). Per
 * CONSTITUTION_V1.1_WEB §3.3, this is the layer that knows about Prisma.
 * The domain layer sees only the IBoQRepository interface.
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Optimistic concurrency (BR-WEB-4): every mutation includes `version` in the
 * WHERE clause via `updateMany`. If 0 rows match, we re-read the row to
 * distinguish "not found" from "version mismatch" and return the appropriate
 * tagged-union variant — the caller decides whether to retry or surface to
 * the user.
 *
 * Soft-delete: deletedAt is NULL for live rows, non-NULL for tombstoned rows.
 * All read paths default to `deletedAt: null` (includeDeleted=false). Soft-
 * deleting a document CASCADES to all its sections AND items — done in a
 * single `$transaction` so the cascade is atomic.
 *
 * Denormalised `amount` (BR-2): the canonical calculation lives in the domain
 * layer (`computeDocumentTotals` in @domain/boq/totals). The repository also
 * computes and persists `amount` as a denormalised column using the same
 * formula (round(qty × rate, 2), HALF_UP, decimal.js) so the DB column is
 * always consistent with what the domain layer would compute. This is purely
 * a denormalisation; the totals path does NOT read this column — it recomputes
 * from qty × rate via `computeDocumentTotals`.
 */

import Decimal from "decimal.js";
import { db } from "@/lib/db";
import type {
  BoQDocument,
  BoQSection,
  BoQItem,
  BoQItemType,
} from "@shared/entities";
import type {
  IBoQRepository,
  BoQDocumentCreateInput,
  BoQSectionCreateInput,
  BoQItemCreateInput,
  BoQItemUpdateInput,
  BoQItemUpdateResult,
  BoQDocumentDeleteResult,
  BoQItemDeleteResult,
} from "@domain/repositories/boq-repository";

// ─── decimal.js configuration ─────────────────────────────────────────────
// HALF_UP is the standard for money. Matches @domain/boq/totals exactly.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Mapping helpers ──────────────────────────────────────────────────────
//
// Prisma's generated row types and our hand-written @shared/entities
// interfaces are structurally identical but nominally different. We cast
// through `unknown` to satisfy the compiler without mapping each field
// individually. The explicit row-shape annotation documents the contract
// at the call site so a future schema divergence is easy to spot.

type PrismaBoQDocumentRow = {
  id: string;
  projectId: string;
  nameEn: string;
  nameAr: string | null;
  status: "DRAFT" | "FINALIZED" | "ARCHIVED";
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type PrismaBoQSectionRow = {
  id: string;
  documentId: string;
  projectId: string;
  code: string;
  titleEn: string;
  titleAr: string | null;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type PrismaBoQItemRow = {
  id: string;
  sectionId: string;
  documentId: string;
  projectId: string;
  code: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unitId: string | null;
  quantity: string;
  rate: string;
  amount: string;
  itemType: BoQItemType;
  libraryItemId: string | null;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function mapDocument(row: PrismaBoQDocumentRow): BoQDocument {
  return row as unknown as BoQDocument;
}

function mapSection(row: PrismaBoQSectionRow): BoQSection {
  return row as unknown as BoQSection;
}

function mapItem(row: PrismaBoQItemRow): BoQItem {
  // The Prisma row does NOT carry `rateAnalysisId` or `calculationRecordId`
  // as scalar columns — those are 1:1 relation back-references where the FK
  // lives on the related table (RateAnalysis.boqItemId, CalculationRecord.
  // linkedBoqItemId). The @shared/entities BoQItem shape includes them as
  // scalar fields, so we default to null here. When a relation is created,
  // callers that need the id should fetch it explicitly via a relation
  // include — this repository's read paths don't include those relations.
  return {
    ...row,
    rateAnalysisId: null,
    calculationRecordId: null,
  } as unknown as BoQItem;
}

// ─── Denormalised amount (BR-2 + BR-5) ─────────────────────────────────────
//
// Mirrors the canonical calculation in @domain/boq/totals::computeItemAmount.
// We duplicate the logic here rather than import @domain/boq/totals to keep
// the infrastructure→domain dependency restricted to @domain/repositories
// (per the layer purity spec for this file).
//
// - RATE_BASED / PROVISIONAL_SUM / DAYWORK: round(qty × rate, 2)
// - LUMP_SUM: qty forced to 1; amount = round(rate, 2)
// - UNIT_ONLY: excluded from totals; amount = "0.00"
function computeDenormalisedAmount(
  itemType: BoQItemType,
  quantity: string,
  rate: string,
): string {
  if (itemType === "UNIT_ONLY") return "0.00";

  const r = new Decimal(rate ?? "0");

  if (itemType === "LUMP_SUM") {
    return r.toDecimalPlaces(2).toFixed(2);
  }

  // RATE_BASED | PROVISIONAL_SUM | DAYWORK
  const q = new Decimal(quantity ?? "0");
  return q.times(r).toDecimalPlaces(2).toFixed(2);
}

// ─── Repository implementation ───────────────────────────────────────────

export class PrismaBoQRepository implements IBoQRepository {
  // ─── Documents ─────────────────────────────────────────────────────────

  /**
   * List documents in a project. Excludes soft-deleted by default; pass
   * `includeDeleted=true` to read tombstoned rows (admin tooling). Ordered
   * by `createdAt ASC` so documents appear in creation order (stable for
   * tests and UI lists).
   */
  async listDocuments(
    projectId: string,
    includeDeleted: boolean = false,
  ): Promise<BoQDocument[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.boQDocument.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapDocument);
  }

  /**
   * Fetch a single document by id. Excludes soft-deleted by default.
   * Returns null if the row doesn't exist OR (when includeDeleted=false)
   * if it's been tombstoned.
   */
  async getDocument(
    id: string,
    includeDeleted: boolean = false,
  ): Promise<BoQDocument | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.boQDocument.findFirst({ where });
    return row ? mapDocument(row) : null;
  }

  /**
   * Create a document. `status` defaults to DRAFT and `version` defaults
   * to 1 via the Prisma schema — but we set `status: "DRAFT"` explicitly
   * so the application-layer default is visible and immune to a future
   * schema change.
   */
  async createDocument(input: BoQDocumentCreateInput): Promise<BoQDocument> {
    const row = await db.boQDocument.create({
      data: {
        projectId: input.projectId,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        status: "DRAFT",
      },
    });
    return mapDocument(row);
  }

  /**
   * Soft-delete a document with optimistic concurrency AND cascading
   * tombstone to all its sections and items — in a single `$transaction`
   * so the cascade is atomic.
   *
   * Pattern (callback-form $transaction):
   *   1. `updateMany` on the document with `where: { id, version, deletedAt: null }`.
   *   2. If count === 0, ABORT the cascade (don't tombstone sections/items
   *      when the document itself wasn't updated). Signal "fail" to the
   *      outer code; the outer code re-reads to distinguish not_found vs
   *      conflict.
   *   3. If count === 1, cascade: `updateMany` on all sections with
   *      `where: { documentId, deletedAt: null }`, then the same on all
   *      items. All three operations share the same `deletedAt = now`
   *      timestamp so the cascade is internally consistent.
   *
   * The callback form is used (not the array form) because we need to
   * conditionally branch on the document update's count before cascading.
   * The array form would execute all three operations unconditionally,
   * which would wrongly tombstone sections/items even on a version
   * mismatch.
   */
  async softDeleteDocument(
    id: string,
    expectedVersion: number,
  ): Promise<BoQDocumentDeleteResult> {
    const now = new Date();

    const outcome = await db.$transaction(async (tx) => {
      const docUpdate = await tx.boQDocument.updateMany({
        where: { id, version: expectedVersion, deletedAt: null },
        data: { deletedAt: now, version: { increment: 1 } },
      });

      if (docUpdate.count === 0) {
        // Signal "didn't delete" — outer code re-reads to distinguish
        // not_found vs conflict. Cascade MUST NOT run.
        return { kind: "fail" as const };
      }

      // Cascade: tombstone all live sections and items in this document.
      await tx.boQSection.updateMany({
        where: { documentId: id, deletedAt: null },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      await tx.boQItem.updateMany({
        where: { documentId: id, deletedAt: null },
        data: { deletedAt: now, version: { increment: 1 } },
      });

      return { kind: "ok" as const };
    });

    if (outcome.kind === "ok") return { kind: "ok" };

    // 0 rows updated — disambiguate.
    const existing = await db.boQDocument.findUnique({ where: { id } });
    if (!existing) return { kind: "not_found" };
    // Row exists — either version mismatch OR already soft-deleted. Both
    // surface as "conflict" with the current version (matches the
    // PrismaProjectRepository convention).
    return { kind: "conflict", currentVersion: existing.version };
  }

  // ─── Sections ──────────────────────────────────────────────────────────

  /**
   * List sections in a document, ordered by `sortOrder ASC`. Excludes
   * soft-deleted by default. Ties on sortOrder are broken by createdAt
   * for stable ordering in tests and UI.
   */
  async listSections(
    documentId: string,
    includeDeleted: boolean = false,
  ): Promise<BoQSection[]> {
    const where: Record<string, unknown> = { documentId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.boQSection.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapSection);
  }

  /**
   * Create a section. `version` defaults to 1 via the schema (implicit).
   * `titleEn` defaults to empty string if not provided (the column is
   * non-nullable in the schema).
   */
  async createSection(input: BoQSectionCreateInput): Promise<BoQSection> {
    const row = await db.boQSection.create({
      data: {
        documentId: input.documentId,
        projectId: input.projectId,
        code: input.code,
        titleEn: input.titleEn ?? "",
        titleAr: input.titleAr ?? null,
        sortOrder: input.sortOrder,
      },
    });
    return mapSection(row);
  }

  /**
   * Re-write sortOrder for all sections in a document based on the
   * array index of their id in `orderedIds`. Done in a single
   * `$transaction` so the reorder is atomic — partial reorders are
   * never observable.
   *
   * Uses the callback form because we want strict sequential execution
   * (each update awaits the previous). The array form would also work
   * but the callback form makes the iteration explicit.
   */
  async reorderSections(
    documentId: string,
    orderedIds: string[],
  ): Promise<void> {
    await db.$transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.boQSection.update({
          where: { id: orderedIds[i] },
          data: { sortOrder: i },
        });
      }
    });
    // documentId is in the signature for symmetry with the interface;
    // the updates are scoped by id, so we don't need to filter by documentId
    // — the caller is responsible for passing ids that all belong to the
    // same document. (A defensive check could be added if callers prove
    // unreliable.)
    void documentId;
  }

  // ─── Items ────────────────────────────────────────────────────────────

  /**
   * List items in a section, ordered by `sortOrder ASC`. Excludes
   * soft-deleted by default.
   */
  async listItems(
    sectionId: string,
    includeDeleted: boolean = false,
  ): Promise<BoQItem[]> {
    const where: Record<string, unknown> = { sectionId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.boQItem.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapItem);
  }

  /**
   * List ALL items across ALL sections in a document. This is the read
   * path used by the totals computation: the domain layer groups these
   * items by sectionId and feeds them into `computeDocumentTotals`.
   *
   * Ordered by `sortOrder ASC` for stability. (Note: items in different
   * sections may have overlapping sortOrder values; the domain layer
   * groups by sectionId before computing, so cross-section ordering
   * doesn't affect totals.)
   */
  async listAllItemsInDocument(
    documentId: string,
    includeDeleted: boolean = false,
  ): Promise<BoQItem[]> {
    const where: Record<string, unknown> = { documentId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.boQItem.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapItem);
  }

  /**
   * Create an item with default `itemType = RATE_BASED`. The denormalised
   * `amount` column is computed inline using the same formula as
   * @domain/boq/totals::computeItemAmount (BR-2 + BR-5) — see
   * `computeDenormalisedAmount` above.
   */
  async createItem(input: BoQItemCreateInput): Promise<BoQItem> {
    const itemType: BoQItemType = input.itemType ?? "RATE_BASED";
    const amount = computeDenormalisedAmount(
      itemType,
      input.quantity,
      input.rate,
    );

    const row = await db.boQItem.create({
      data: {
        sectionId: input.sectionId,
        documentId: input.documentId,
        projectId: input.projectId,
        code: input.code ?? null,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr ?? null,
        unitId: input.unitId ?? null,
        quantity: input.quantity,
        rate: input.rate,
        amount,
        itemType,
        libraryItemId: input.libraryItemId ?? null,
        sortOrder: input.sortOrder,
      },
    });
    return mapItem(row);
  }

  /**
   * Fetch a single item by id. Returns null if the row doesn't exist OR
   * if it's been soft-deleted (getItem doesn't take includeDeleted —
   * the contract is "give me a live item or null").
   */
  async getItem(id: string): Promise<BoQItem | null> {
    const row = await db.boQItem.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? mapItem(row) : null;
  }

  /**
   * Update an item with optimistic concurrency (BR-WEB-4).
   *
   * Pattern: `updateMany({ where: { id, version: expectedVersion, deletedAt: null }, data })`.
   * If 0 rows match, re-read to distinguish not_found vs conflict.
   *
   * Denormalised `amount` recomputation: if any of `quantity`, `rate`, or
   * `itemType` is in the update payload, we re-read the existing row to
   * fetch the current values for the OTHER two fields, then compute the
   * new amount. This handles partial updates like "just update quantity"
   * correctly (amount = new qty × existing rate).
   *
   * On success, version is atomically incremented and the updated row is
   * re-read and returned.
   */
  async updateItem(
    id: string,
    input: BoQItemUpdateInput,
  ): Promise<BoQItemUpdateResult> {
    // Strip expectedVersion — it's part of the WHERE, not the SET.
    const { expectedVersion, ...fields } = input;

    // Build SET payload — only include fields the caller actually provided.
    const data: Record<string, unknown> = {};
    if (fields.code !== undefined) data.code = fields.code;
    if (fields.descriptionEn !== undefined) data.descriptionEn = fields.descriptionEn;
    if (fields.descriptionAr !== undefined) data.descriptionAr = fields.descriptionAr;
    if (fields.unitId !== undefined) data.unitId = fields.unitId;
    if (fields.quantity !== undefined) data.quantity = fields.quantity;
    if (fields.rate !== undefined) data.rate = fields.rate;
    if (fields.itemType !== undefined) data.itemType = fields.itemType;
    if (fields.sortOrder !== undefined) data.sortOrder = fields.sortOrder;

    // Recompute denormalised amount if any money-relevant field is changing.
    // We need the existing row's values for the fields NOT in the update.
    const amountRecomputeNeeded =
      data.quantity !== undefined ||
      data.rate !== undefined ||
      data.itemType !== undefined;

    if (amountRecomputeNeeded) {
      const existing = await db.boQItem.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" };
      if (existing.deletedAt !== null) return { kind: "not_found" };

      const newQty = (data.quantity as string | undefined) ?? existing.quantity;
      const newRate = (data.rate as string | undefined) ?? existing.rate;
      const newType =
        (data.itemType as BoQItemType | undefined) ?? existing.itemType;
      data.amount = computeDenormalisedAmount(newType, newQty, newRate);
    }

    const result = await db.boQItem.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 1) {
      const updated = await db.boQItem.findUnique({ where: { id } });
      return { kind: "ok", item: mapItem(updated!) };
    }

    // 0 rows — disambiguate not_found vs conflict.
    const existing = await db.boQItem.findUnique({ where: { id } });
    if (!existing) return { kind: "not_found" };
    if (existing.deletedAt !== null) return { kind: "not_found" };
    return { kind: "conflict", currentVersion: existing.version };
  }

  /**
   * Soft-delete an item with optimistic concurrency. Same pattern as
   * PrismaProjectRepository.softDelete.
   *
   * If the row doesn't exist → not_found. If the row exists but the
   * version doesn't match OR the row is already soft-deleted → conflict
   * with the current version (matches the Project repository convention).
   */
  async softDeleteItem(
    id: string,
    expectedVersion: number,
  ): Promise<BoQItemDeleteResult> {
    const result = await db.boQItem.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 1) return { kind: "ok" };

    const existing = await db.boQItem.findUnique({ where: { id } });
    if (!existing) return { kind: "not_found" };
    // Row exists but version mismatch OR already deleted → conflict.
    return { kind: "conflict", currentVersion: existing.version };
  }

  /**
   * Move an item to a different section AND set its sortOrder. This is
   * a single-field-composite update — not version-checked because the
   * typical use case is a UI drag-and-drop where the user has just
   * confirmed they want to move the item, and a stale-version failure
   * would be more annoying than helpful. (If strict version checks are
   * needed for move, callers can wrap with their own optimistic-concurrency
   * guard at the service layer.)
   *
   * Implementation note: uses `update` (not `updateMany`) because the
   * id is the primary key and we don't need version protection here.
   * If the id doesn't exist, Prisma throws P2025 — the caller is
   * expected to validate the id beforehand via `getItem`.
   */
  async moveItem(
    itemId: string,
    toSectionId: string,
    newSortOrder: number,
  ): Promise<void> {
    await db.boQItem.update({
      where: { id: itemId },
      data: { sectionId: toSectionId, sortOrder: newSortOrder },
    });
  }

  /**
   * Re-number all items in a document per BR-7:
   *   - Sections get implicit codes "1", "2", "3", ... based on sortOrder.
   *   - Each item gets code "<sectionSortOrderIndex>.<itemIndexWithinSection>"
   *     where both indices are 1-based.
   *
   * Example: section #1 has 2 items, section #2 has 1 item:
   *   - Section 1 items: "1.1", "1.2"
   *   - Section 2 items: "2.1"
   *
   * Done in a single `$transaction` so renumbering is atomic. The callback
   * form is used so we can fetch-then-update inside the transaction (the
   * array form doesn't allow conditional logic).
   *
   * Only live (non-deleted) sections and items are renumbered. The document
   * itself is not modified (its status is independent of item numbering).
   */
  async renumberItems(documentId: string): Promise<void> {
    await db.$transaction(async (tx) => {
      const sections = await tx.boQSection.findMany({
        where: { documentId, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });

      for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const sectionCode = String(sIdx + 1);
        const items = await tx.boQItem.findMany({
          where: { sectionId: sections[sIdx].id, deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });

        for (let iIdx = 0; iIdx < items.length; iIdx++) {
          const code = `${sectionCode}.${iIdx + 1}`;
          await tx.boQItem.update({
            where: { id: items[iIdx].id },
            data: { code },
          });
        }
      }
    });
  }
}
