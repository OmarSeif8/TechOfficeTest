/**
 * GET /api/imports/[importBatchId]/sheets — Step 2 of the import wizard.
 *
 * Returns the sheet names + first 10 rows of each sheet (for the user to
 * preview and pick which sheet to import). Verifies the ImportBatch belongs
 * to the current user (via the project's ownerId).
 *
 * Response shape:
 *   {
 *     importBatchId: string,
 *     fileName: string,
 *     status: "PENDING" | "VALIDATED" | "COMMITTED" | "FAILED",
 *     sheets: Array<{
 *       name: string,
 *       rowCount: number,             // worksheet.rowCount (ExcelJS-reported)
 *       columnCount: number,          // worksheet.columnCount (ExcelJS-reported)
 *       preview: string[][]           // first 10 rows, each row = array of cell strings
 *     }>
 *   }
 *
 * Cell values are coerced to strings (numbers → String(number), Dates → ISO,
 * rich-text → .text, formula → .result) so the preview is JSON-serializable.
 */

import ExcelJS from "exceljs";

import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import {
  withErrorHandler,
  json,
  notFound,
  unprocessableEntity,
} from "@/lib/api-helpers";
import {
  getOwnedImportBatch,
  loadWorkbook,
  cellToString,
} from "@/app/api/imports/_lib/import-helpers";

const PREVIEW_ROW_COUNT = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a row preview as a string[] for the first `maxCols` columns of a row.
 * We don't know how many columns to expect — we use the worksheet's
 * `columnCount` (ExcelJS's best guess based on the max cell column seen).
 */
function buildRowPreview(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  maxCols: number,
): string[] {
  const out: string[] = [];
  for (let colIdx = 0; colIdx < maxCols; colIdx++) {
    out.push(cellToString(ws, rowNumber, colIdx));
  }
  return out;
}

// ─── Route handler ────────────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (_req: Request, ctx: { params: Promise<{ importBatchId: string }> }) => {
    const userId = await requireUserId();
    const services = getServices();
    const { importBatchId } = await ctx.params;

    // ─── 1. Resolve batch + verify ownership ───────────────────────────
    const owned = await getOwnedImportBatch(importBatchId, userId, services.prisma);
    if (!owned) {
      return notFound("Import batch not found");
    }
    const { batch } = owned;

    if (batch.status === "COMMITTED") {
      return unprocessableEntity(
        "This import batch has already been committed — create a new upload to import again",
      );
    }

    // ─── 2. Load the workbook ──────────────────────────────────────────
    let workbook: ExcelJS.Workbook;
    try {
      workbook = await loadWorkbook(batch.id);
    } catch (err) {
      return unprocessableEntity(
        err instanceof Error ? err.message : "Failed to load workbook",
      );
    }

    // ─── 3. Build preview for each sheet ───────────────────────────────
    const sheets = workbook.worksheets.map((ws) => {
      const rowCount = ws.rowCount;
      const columnCount = ws.columnCount;
      const previewRows: string[][] = [];
      const rowsToPreview = Math.min(PREVIEW_ROW_COUNT, rowCount);
      for (let r = 1; r <= rowsToPreview; r++) {
        previewRows.push(buildRowPreview(ws, r, columnCount));
      }
      return {
        name: ws.name,
        rowCount,
        columnCount,
        preview: previewRows,
      };
    });

    // ─── 4. Update batch status to VALIDATED (mapping pending) ────────
    // We mark the batch as VALIDATED to indicate the user has previewed the
    // data. This is informational — the mapping route doesn't require it.
    if (batch.status === "PENDING") {
      await services.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: "VALIDATED" },
      });
    }

    // ─── 5. Return preview ────────────────────────────────────────────
    return json({
      importBatchId: batch.id,
      fileName: batch.fileName,
      status: batch.status,
      sheets,
    });
  },
);
