/**
 * Internal API helpers for BoQ routes — shared across document/section/item
 * route handlers. Lives in `src/app/api/_lib/` (underscore prefix → Next.js
 * does NOT treat this as a route).
 *
 * Responsibilities:
 *   - `verifyProjectOwnership` — BR-WEB-5: load project, return null if it
 *     doesn't exist OR doesn't belong to the session user. The route handler
 *     then returns 404 (we never leak existence of projects owned by other
 *     users).
 *   - `loadDocumentTree` — GET /api/documents/[id] returns the document with
 *     its sections and items in a single Prisma query (nested include).
 *   - `computeTreeTotals` — group items under their sections and feed the
 *     pure domain function (used by GET document and PATCH item responses).
 */

import { db } from "@/lib/db";
import { getServices } from "@/lib/services";
import { computeDocumentTotals } from "@domain/boq/totals";
import type { Project, BoQDocument, BoQSection, BoQItem } from "@shared/entities";
import type { DocumentTotals } from "@domain/boq/totals";

/**
 * Verify the project exists and belongs to `userId`. Returns the project or
 * null. Callers should translate null → 404 (BR-WEB-5: never leak existence).
 */
export async function verifyProjectOwnership(
  projectId: string,
  userId: string,
): Promise<Project | null> {
  const services = getServices();
  const project = await services.projects.getById(projectId);
  if (!project || project.ownerId !== userId) return null;
  return project;
}

/**
 * Load a document with its live sections and items in a single Prisma query
 * (nested include). Sections and items are ordered by `sortOrder` then
 * `createdAt` for stable ordering (matches the repository convention).
 *
 * Returns null if the document is missing or soft-deleted.
 */
export async function loadDocumentTree(
  documentId: string,
): Promise<{
  document: BoQDocument;
  sections: BoQSection[];
  items: BoQItem[];
} | null> {
  const row = await db.boQDocument.findUnique({
    where: { id: documentId, deletedAt: null },
    include: {
      sections: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      items: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!row) return null;

  // Map raw Prisma rows to the entity shapes. We do this inline rather than
  // importing the private `mapDocument/mapSection/mapItem` helpers from
  // the repository implementation (those aren't exported). The mapping is
  // a 1:1 field copy — entity types are intentionally compatible with
  // Prisma's row shape.
  const document: BoQDocument = {
    id: row.id,
    projectId: row.projectId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
  const sections: BoQSection[] = row.sections.map((s) => ({
    id: s.id,
    documentId: s.documentId,
    projectId: s.projectId,
    code: s.code,
    titleEn: s.titleEn,
    titleAr: s.titleAr,
    sortOrder: s.sortOrder,
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deletedAt: s.deletedAt,
  }));
  const items: BoQItem[] = row.items.map((i) => ({
    id: i.id,
    sectionId: i.sectionId,
    documentId: i.documentId,
    projectId: i.projectId,
    code: i.code,
    descriptionEn: i.descriptionEn,
    descriptionAr: i.descriptionAr,
    unitId: i.unitId,
    quantity: i.quantity,
    rate: i.rate,
    amount: i.amount,
    itemType: i.itemType,
    libraryItemId: i.libraryItemId,
    // `rateAnalysisId` and `calculationRecordId` are scalar fields on the
    // BoQItem entity but exist only as 1:1 relations on the Prisma side (FKs
    // live on RateAnalysis.boqItemId and CalculationRecord.linkedBoqItemId
    // — see WO-W-2-b worklog for the divergence). We null them here. The
    // UI can fetch linked analyses via the rate-analysis endpoints.
    rateAnalysisId: null,
    calculationRecordId: null,
    sortOrder: i.sortOrder,
    version: i.version,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    deletedAt: i.deletedAt,
  }));
  return { document, sections, items };
}

/**
 * Group items under their sections and compute the document totals via the
 * pure domain function `computeDocumentTotals`. Used by:
 *   - GET /api/documents/[id] (return totals alongside the tree)
 *   - PATCH /api/items/[id] (return live totals after mutation)
 *
 * `vatPercentage` is currently undefined — VAT is a project-level setting
 * that the UI will pass through once that wiring exists. The domain function
 * gracefully handles the no-VAT case (vatAmount = "0.00", total = subtotal).
 */
export function computeTreeTotals(
  document: BoQDocument,
  sections: BoQSection[],
  items: BoQItem[],
): DocumentTotals {
  return computeDocumentTotals({
    id: document.id,
    nameEn: document.nameEn,
    nameAr: document.nameAr ?? undefined,
    vatPercentage: undefined,
    sections: sections.map((s) => ({
      id: s.id,
      code: s.code,
      titleEn: s.titleEn,
      titleAr: s.titleAr ?? undefined,
      items: items
        .filter((i) => i.sectionId === s.id)
        .map((i) => ({
          id: i.id,
          itemType: i.itemType,
          quantity: i.quantity,
          rate: i.rate,
        })),
    })),
  });
}
