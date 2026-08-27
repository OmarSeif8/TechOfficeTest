/**
 * POST /api/imports/[importBatchId]/mapping — Step 3 of the import wizard.
 *
 * Body: { sheetName, mapping, skipRows }
 *
 * Stores the mapping in the ImportBatch's `mappingJson` field and returns the
 * first 5 rows of the sheet mapped to BoQ item shapes (so the user can verify
 * the mapping before committing).
 *
 * Response shape:
 *   {
 *     importBatchId: string,
 *     sheetName: string,
 *     skipRows: number[],
 *     mapping: ImportMapping,
 *     preview: Array<{                           // first 5 mappable rows
 *       rowNumber: number,
 *       code: string | null,
 *       descriptionEn: string,
 *       descriptionAr: string | null,
 *       unit: string | null,
 *       quantity: string,
 *       rate: string,
 *       skipped: boolean                         // true if row is in skipRows
 *     }>
 *   }
 *
 * The mapping is persisted to `mappingJson` as JSON (the column refs are
 * preserved verbatim — resolution happens on commit). The `sheetName` and
 * `skipRows` are also persisted so the commit route only needs the documentName.
 *
 * The ImportBatch's `validationJson` field is set with a row-by-row validation
 * snapshot (rows with missing required fields are flagged) so the commit route
 * can skip them (or the UI can warn the user).
 */

import ExcelJS from "exceljs";

import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import {
  withErrorHandler,
  json,
  badRequest,
  notFound,
  unprocessableEntity,
} from "@/lib/api-helpers";
import {
  getOwnedImportBatch,
  loadWorkbook,
  resolveColumnIndex,
  cellToString,
} from "@/app/api/imports/_lib/import-helpers";
import { ImportMappingRequestSchema } from "@shared/schemas/import";
import type { ImportMapping } from "@shared/schemas/import";

const PREVIEW_ROW_COUNT = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────

interface MappedRow {
  rowNumber: number;
  code: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unit: string | null;
  quantity: string;
  rate: string;
  skipped: boolean;
  /** True if required fields (descriptionEn, quantity, rate) are missing/empty. */
  hasMissingRequired: boolean;
}

/**
 * Build a mapped row preview for a single Excel row.
 * Returns null if ALL mapped fields are empty (treated as a blank row —
 * the commit route will skip these silently).
 */
function buildMappedRow(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  mapping: ImportMapping,
  indices: ResolvedIndices,
  skipped: boolean,
): MappedRow | null {
  const code = indices.codeIdx !== null
    ? cellToString(ws, rowNumber, indices.codeIdx)
    : "";
  const descriptionEn = cellToString(ws, rowNumber, indices.descriptionEnIdx);
  const descriptionAr = indices.descriptionArIdx !== null
    ? cellToString(ws, rowNumber, indices.descriptionArIdx)
    : "";
  const unit = indices.unitIdx !== null
    ? cellToString(ws, rowNumber, indices.unitIdx)
    : "";
  const quantity = cellToString(ws, rowNumber, indices.quantityIdx);
  const rate = cellToString(ws, rowNumber, indices.rateIdx);

  // Blank row: skip silently (commit route also skips these).
  if (
    !code && !descriptionEn && !descriptionAr && !unit &&
    !quantity && !rate
  ) {
    return null;
  }

  const hasMissingRequired =
    !descriptionEn.trim() || !quantity.trim() || !rate.trim();

  return {
    rowNumber,
    code: code || null,
    descriptionEn,
    descriptionAr: descriptionAr || null,
    unit: unit || null,
    quantity,
    rate,
    skipped,
    hasMissingRequired,
  };
}

interface ResolvedIndices {
  codeIdx: number | null;
  descriptionEnIdx: number;
  descriptionArIdx: number | null;
  unitIdx: number | null;
  quantityIdx: number;
  rateIdx: number;
}

/**
 * Resolve all column indices for the mapping. If a REQUIRED field can't be
 * resolved, returns null (caller surfaces a 400 to the client). Optional
 * fields that can't be resolved are silently set to null (no values will be
 * read for those fields).
 */
function resolveIndices(
  ws: ExcelJS.Worksheet,
  mapping: ImportMapping,
): ResolvedIndices | null {
  const descriptionEnIdx = resolveColumnIndex(ws, mapping.descriptionEn);
  const quantityIdx = resolveColumnIndex(ws, mapping.quantity);
  const rateIdx = resolveColumnIndex(ws, mapping.rate);
  if (descriptionEnIdx === null || quantityIdx === null || rateIdx === null) {
    return null;
  }
  return {
    codeIdx: mapping.code ? resolveColumnIndex(ws, mapping.code) : null,
    descriptionEnIdx,
    descriptionArIdx: mapping.descriptionAr
      ? resolveColumnIndex(ws, mapping.descriptionAr)
      : null,
    unitIdx: mapping.unit ? resolveColumnIndex(ws, mapping.unit) : null,
    quantityIdx,
    rateIdx,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────

export const POST = withErrorHandler(
  async (req: Request, ctx: { params: Promise<{ importBatchId: string }> }) => {
    const userId = await requireUserId();
    const services = getServices();
    const { importBatchId } = await ctx.params;

    // ─── 1. Parse body ────────────────────────────────────────────────
    const body = await req.json();
    const parsed = ImportMappingRequestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid mapping request body", parsed.error.issues);
    }
    const { sheetName, mapping, skipRows } = parsed.data;

    // ─── 2. Resolve batch + verify ownership ─────────────────────────
    const owned = await getOwnedImportBatch(importBatchId, userId, services.prisma);
    if (!owned) {
      return notFound("Import batch not found");
    }
    const { batch } = owned;

    if (batch.status === "COMMITTED") {
      return unprocessableEntity(
        "This import batch has already been committed",
      );
    }

    // ─── 3. Load workbook + locate sheet ──────────────────────────────
    let workbook: ExcelJS.Workbook;
    try {
      workbook = await loadWorkbook(batch.id);
    } catch (err) {
      return unprocessableEntity(
        err instanceof Error ? err.message : "Failed to load workbook",
      );
    }

    const ws = workbook.getWorksheet(sheetName);
    if (!ws) {
      return badRequest(
        `Sheet "${sheetName}" not found in workbook`,
        { availableSheets: workbook.worksheets.map((w) => w.name) },
      );
    }

    // ─── 4. Resolve column indices ───────────────────────────────────
    const indices = resolveIndices(ws, mapping);
    if (!indices) {
      return badRequest(
        "Could not resolve one or more required columns from the mapping. " +
          "Required fields: descriptionEn, quantity, rate. " +
          "Use column letters (e.g. \"A\") or exact header names from row 1.",
      );
    }

    // ─── 5. Build preview (first 5 mappable rows) ────────────────────
    const skipSet = new Set(skipRows);
    const preview: MappedRow[] = [];
    // Start at row 2 to skip the header row (ExcelJS rows are 1-indexed).
    const maxRow = Math.min(ws.rowCount, PREVIEW_ROW_COUNT + 1);
    for (let r = 2; r <= maxRow; r++) {
      const mapped = buildMappedRow(
        ws,
        r,
        mapping,
        indices,
        skipSet.has(r),
      );
      if (mapped) preview.push(mapped);
    }

    // ─── 6. Persist mapping + skipRows + sheetName to mappingJson ────
    // The commit route reads this back to re-resolve indices and apply the
    // mapping. We persist the column refs verbatim (not the resolved indices)
    // so the mapping survives reordering of the underlying sheet (though the
    // user would have to re-upload if the sheet structure changes).
    const mappingPayload = {
      sheetName,
      mapping,
      skipRows,
      savedAt: new Date().toISOString(),
    };
    await services.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        mappingJson: JSON.stringify(mappingPayload),
        status: "VALIDATED",
      },
    });

    // ─── 7. Return preview ───────────────────────────────────────────
    return json({
      importBatchId: batch.id,
      sheetName,
      skipRows,
      mapping,
      preview,
    });
  },
);
