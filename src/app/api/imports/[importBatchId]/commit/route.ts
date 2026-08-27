/**
 * POST /api/imports/[importBatchId]/commit — Step 4 of the import wizard.
 *
 * Body: ImportCommitSchema {
 *   documentName: string,           // name for the new BoQDocument
 *   sectionCode?: string,           // optional — defaults to "SECTION-1"
 *   sectionTitle?: string,           // optional — defaults to "Imported Items"
 *   mapping: ImportMappingSchema,   // column refs (overrides stored mapping)
 *   skipRows: number[]             // 0-indexed rows to skip
 * }
 *
 * Executes the import:
 *   1. Re-reads the stored Excel temp file (from upload).
 *   2. Reads the sheet name + mapping from `mappingJson` (set by the mapping
 *      route). If the body includes its own mapping/sheetName, those override
 *      the stored values (flexibility for programmatic callers).
 *   3. Iterates sheet rows starting from row 2 (row 1 is the header). For
 *      each row, resolves the column indices, reads the cell values, and
 *      builds a `BoQItemCreateInput`.
 *   4. In a single Prisma `$transaction`:
 *        a. Create the BoQDocument (DRAFT status).
 *        b. Create a single BoQSection (per Phase 1 MVP — multi-section
 *           import is deferred; the spec accepts an optional sectionCode/
 *           sectionTitle for the single section).
 *        c. Create all BoQItems (sequential creates inside the tx — Prisma
 *           handles the SQL transaction).
 *        d. Update the ImportBatch: status=COMMITTED, documentId, counts
 *           (totalRows, importedRows, skippedRows), committedAt=now.
 *   5. Writes an AuditLog entry (best-effort per BR-WEB-8).
 *   6. Returns the created document + counts.
 *
 * Response shape:
 *   {
 *     importBatchId: string,
 *     status: "COMMITTED",
 *     document: { id, nameEn, status, version },
 *     section: { id, code, titleEn },
 *     counts: { totalRows, importedRows, skippedRows },
 *     invalidRows: Array<{ rowNumber, reason }>
 *   }
 *
 * Errors:
 *   - 400 — missing/invalid mapping or documentName
 *   - 404 — batch not found / not owned by user
 *   - 422 — temp file missing or workbook unreadable
 *   - 409 — batch already committed
 *
 * Layer purity: top of stack — App Router route handler. Imports @domain/boq/
 * totals (canonical item-amount function) and @prisma/client (for the
 * BoQItemUncheckedCreateInput type).
 */

import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";

import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { db } from "@/lib/db";
import {
  withErrorHandler,
  json,
  badRequest,
  notFound,
  unprocessableEntity,
  conflict,
  serverError,
  writeAuditLog,
} from "@/lib/api-helpers";
import {
  getOwnedImportBatch,
  loadWorkbook,
  resolveColumnIndex,
  cellToString,
} from "@/app/api/imports/_lib/import-helpers";
import { ImportCommitSchema } from "@shared/schemas/import";
import type { ImportMapping } from "@shared/schemas/import";
import { computeItemAmount } from "@domain/boq/totals";

// ─── Constants ────────────────────────────────────────────────────────────

const DEFAULT_SECTION_CODE = "SECTION-1";
const DEFAULT_SECTION_TITLE = "Imported Items";

// ─── Helpers ─────────────────────────────────────────────────────────────

interface ResolvedIndices {
  codeIdx: number | null;
  descriptionEnIdx: number;
  descriptionArIdx: number | null;
  unitIdx: number | null;
  quantityIdx: number;
  rateIdx: number;
}

interface ParsedRow {
  rowNumber: number;
  code: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unit: string | null;
  quantity: string;
  rate: string;
}

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

/**
 * Parse a single Excel row into a BoQ item shape. Returns null if the row is
 * entirely blank (silently skipped). Returns a row with `descriptionEn=""`
 * if required fields are missing — the commit route will skip such rows and
 * count them in `skippedRows`.
 */
function parseRow(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  indices: ResolvedIndices,
): ParsedRow | null {
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

  // Blank row: skip silently.
  if (
    !code && !descriptionEn && !descriptionAr && !unit &&
    !quantity && !rate
  ) {
    return null;
  }

  return {
    rowNumber,
    code: code || null,
    descriptionEn,
    descriptionAr: descriptionAr || null,
    unit: unit || null,
    quantity,
    rate,
  };
}

/**
 * Coerce a string to a numeric string for money/qty fields. Returns "0" if
 * the string is empty or non-numeric (the BoQ repository treats non-numeric
 * values as "0" — the row will have amount=0 in the denormalised column, and
 * the domain totals computation will produce 0 for that item).
 *
 * Per BR-1: we don't parse to float. We coerce non-numeric strings to "0"
 * and trim whitespace; numeric strings are preserved verbatim (thousands
 * separators stripped so decimal.js can parse).
 */
function coerceNumeric(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "0";
  // Allow leading + / -, digits, decimal point, comma thousands separators,
  // and trailing % (defensive — percent values are not expected in BoQ
  // quantity/rate columns but we don't want to throw on them).
  if (!/^[+-]?[\d.,]+%?$/.test(trimmed)) return "0";
  // Strip thousands separators (commas) — decimal.js handles the rest.
  return trimmed.replace(/,/g, "");
}

/**
 * Compute the denormalised amount for a BoQ item using the CANONICAL domain
 * function `computeItemAmount` from @domain/boq/totals. This guarantees the
 * `amount` column we persist matches what the domain layer would compute
 * (BR-2: round(qty × rate, 2), HALF_UP).
 *
 * We use the domain function (not a duplicated formula) so there's a single
 * source of truth for the rounding rule.
 */
function computeAmount(
  itemType: "RATE_BASED" | "LUMP_SUM" | "PROVISIONAL_SUM" | "DAYWORK" | "UNIT_ONLY",
  quantity: string,
  rate: string,
): string {
  const result = computeItemAmount({ itemType, quantity, rate });
  return result.amount;
}

// ─── Route handler ────────────────────────────────────────────────────────

export const POST = withErrorHandler(
  async (req: Request, ctx: { params: Promise<{ importBatchId: string }> }) => {
    const userId = await requireUserId();
    const services = getServices();
    const { importBatchId } = await ctx.params;

    // ─── 1. Parse body ────────────────────────────────────────────────
    const body = await req.json();
    const parsed = ImportCommitSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid commit request body", parsed.error.issues);
    }
    const {
      documentName,
      sectionCode,
      sectionTitle,
      mapping: bodyMapping,
      skipRows: bodySkipRows,
    } = parsed.data;

    // ─── 2. Resolve batch + verify ownership ─────────────────────────
    const owned = await getOwnedImportBatch(importBatchId, userId, services.prisma);
    if (!owned) {
      return notFound("Import batch not found");
    }
    const { batch, project } = owned;

    if (batch.status === "COMMITTED") {
      return conflict("This import batch has already been committed");
    }

    // ─── 3. Reconstitute sheetName + mapping from stored mappingJson ─
    // The mapping route persisted { sheetName, mapping, skipRows }.
    // The body overrides these if the caller wants to commit with a
    // different mapping than the one previewed.
    let sheetName: string | null = null;
    let mapping: ImportMapping | null = null;
    let skipRows: number[] = bodySkipRows;

    if (batch.mappingJson) {
      try {
        const stored = JSON.parse(batch.mappingJson) as {
          sheetName?: string;
          mapping?: ImportMapping;
          skipRows?: number[];
        };
        if (stored.sheetName) sheetName = stored.sheetName;
        if (stored.mapping) mapping = stored.mapping;
        // skipRows in body overrides stored — but if body is empty array and
        // stored has values, use stored. We check: if body explicitly provided
        // skipRows (length > 0), use body; else use stored.
        if (bodySkipRows.length === 0 && stored.skipRows) {
          skipRows = stored.skipRows;
        }
      } catch {
        // Ignore JSON parse errors — fall through to require body mapping.
      }
    }

    // Body mapping overrides stored mapping.
    if (bodyMapping) mapping = bodyMapping;

    if (!mapping) {
      return badRequest(
        "No mapping provided — call /api/imports/[id]/mapping first OR include a mapping in the commit body",
      );
    }
    if (!sheetName) {
      return badRequest(
        "No sheetName provided — call /api/imports/[id]/mapping first OR include sheetName in the stored mapping",
      );
    }

    // ─── 4. Load workbook + locate sheet ──────────────────────────────
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

    // ─── 5. Resolve column indices ───────────────────────────────────
    const indices = resolveIndices(ws, mapping);
    if (!indices) {
      return badRequest(
        "Could not resolve one or more required columns from the mapping",
      );
    }

    // ─── 5b. Load unit lookup map ────────────────────────────────────
    // Build a map of unit code + aliases → Unit.id so we can resolve the
    // raw Excel cell value (e.g. "m³", "طن", "No") to a valid Unit.id.
    const units = await db.unit.findMany({
      include: { aliases: true },
    });
    const unitLookup = new Map<string, string>();
    for (const u of units) {
      // Map the code itself (lowercased)
      unitLookup.set(u.code.toLowerCase(), u.id);
      // Map all aliases (lowercased)
      for (const a of u.aliases) {
        unitLookup.set(a.alias.toLowerCase(), u.id);
      }
    }

    // ─── 6. Parse all rows ───────────────────────────────────────────
    const skipSet = new Set(skipRows);
    const allParsed: ParsedRow[] = [];
    const skippedRows: number[] = [];
    const invalidRows: Array<{ rowNumber: number; reason: string }> = [];

    // Start at row 2 (row 1 is the header per the mapping route convention).
    for (let r = 2; r <= ws.rowCount; r++) {
      const parsedRow = parseRow(ws, r, indices);
      if (!parsedRow) continue; // blank row — silent skip
      allParsed.push(parsedRow);
    }

    // ─── 7. Build BoQItemCreateInput array (filter out invalid + skipped)
    const validItems: Array<{
      data: Prisma.BoQItemUncheckedCreateInput;
      rowNumber: number;
    }> = [];

    for (const row of allParsed) {
      // Skip explicitly skipped rows.
      if (skipSet.has(row.rowNumber)) {
        skippedRows.push(row.rowNumber);
        continue;
      }

      // Validate required fields. Skip rows with missing descriptionEn,
      // quantity, or rate (counted in invalidRows for the response).
      if (
        !row.descriptionEn.trim() ||
        !row.quantity.trim() ||
        !row.rate.trim()
      ) {
        invalidRows.push({
          rowNumber: row.rowNumber,
          reason: "Missing required field (descriptionEn, quantity, or rate)",
        });
        skippedRows.push(row.rowNumber);
        continue;
      }

      const quantity = coerceNumeric(row.quantity);
      const rate = coerceNumeric(row.rate);
      const itemType = "RATE_BASED" as const;
      const amount = computeAmount(itemType, quantity, rate);

      validItems.push({
        rowNumber: row.rowNumber,
        data: {
          // sectionId + documentId are set inside the transaction (after
          // we create the document + section).
          sectionId: "__pending__", // placeholder — replaced below
          documentId: "__pending__",
          projectId: project.id,
          code: row.code,
          descriptionEn: row.descriptionEn.trim(),
          descriptionAr: row.descriptionAr,
          // unitId: resolve the raw Excel cell value to a Unit.id via the
          // unit lookup map (code + aliases). If no match, store null —
          // the item is still valid, just without a linked unit.
          unitId: row.unit
            ? unitLookup.get(row.unit.toLowerCase().trim()) ?? null
            : null,
          quantity,
          rate,
          amount,
          itemType,
          libraryItemId: null,
          sortOrder: validItems.length,
        },
      });
    }

    // ─── 8. Execute the import in a single transaction ───────────────
    // Single $transaction: create document + section + all items. If any
    // item creation fails, the entire import rolls back (atomicity guarantee).
    // The ImportBatch update is INSIDE the same transaction so we don't end
    // up with a COMMITTED batch but no document (or vice versa).
    const finalSectionCode = sectionCode ?? DEFAULT_SECTION_CODE;
    const finalSectionTitle = sectionTitle ?? DEFAULT_SECTION_TITLE;
    const totalRows = allParsed.length;

    let documentRow: { id: string; nameEn: string; status: string; version: number };
    let sectionRow: { id: string; code: string; titleEn: string };

    try {
      const result = await services.prisma.$transaction(async (tx) => {
        // a. Create the BoQDocument.
        const doc = await tx.boQDocument.create({
          data: {
            projectId: project.id,
            nameEn: documentName,
            nameAr: null,
            status: "DRAFT",
          },
        });

        // b. Create the single section.
        const sec = await tx.boQSection.create({
          data: {
            documentId: doc.id,
            projectId: project.id,
            code: finalSectionCode,
            titleEn: finalSectionTitle,
            titleAr: null,
            sortOrder: 0,
          },
        });

        // c. Create all items. Sequential creates inside the tx so they all
        // commit (or roll back) atomically. (We can't use the repository
        // singleton's createItem because it doesn't share the tx; we use
        // tx.boQItem.create directly with the pre-computed denormalised amount.)
        for (const item of validItems) {
          await tx.boQItem.create({
            data: {
              ...item.data,
              sectionId: sec.id,
              documentId: doc.id,
            },
          });
        }

        // d. Update the ImportBatch: status=COMMITTED, documentId, counts,
        //    committedAt. (Inside the same tx so we don't end up with a
        //    committed batch but no document, or vice versa.)
        await tx.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "COMMITTED",
            documentId: doc.id,
            totalRows,
            importedRows: validItems.length,
            skippedRows: skippedRows.length,
            committedAt: new Date(),
          },
        });

        return { doc, sec };
      });

      documentRow = {
        id: result.doc.id,
        nameEn: result.doc.nameEn,
        status: result.doc.status,
        version: result.doc.version,
      };
      sectionRow = {
        id: result.sec.id,
        code: result.sec.code,
        titleEn: result.sec.titleEn,
      };
    } catch (err) {
      // Mark the batch as FAILED so the user can see the import didn't succeed.
      console.error("[imports/commit] Transaction failed:", err);
      try {
        await services.prisma.importBatch.update({
          where: { id: batch.id },
          data: { status: "FAILED" },
        });
      } catch {
        // Best-effort — if the batch update also fails, we still want to
        // return a 500 to the caller.
      }
      return serverError(
        "Import failed — the transaction was rolled back. " +
          (err instanceof Error ? err.message : ""),
      );
    }

    // ─── 9. Write AuditLog (BR-WEB-8, best-effort) ───────────────────
    await writeAuditLog({
      action: "import.commit",
      entityType: "BoQDocument",
      entityId: documentRow.id,
      afterJson: {
        importBatchId: batch.id,
        documentName,
        sheetName,
        sectionCode: finalSectionCode,
        counts: {
          totalRows,
          importedRows: validItems.length,
          skippedRows: skippedRows.length,
        },
      },
    });

    // ─── 10. Return created document + counts ────────────────────────
    return json({
      importBatchId: batch.id,
      status: "COMMITTED",
      document: documentRow,
      section: sectionRow,
      counts: {
        totalRows,
        importedRows: validItems.length,
        skippedRows: skippedRows.length,
      },
      invalidRows,
    });
  },
);
