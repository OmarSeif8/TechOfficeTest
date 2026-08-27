/**
 * Shared helpers for the import wizard routes (steps 2–4).
 *
 * Lives at src/app/api/imports/_lib/ — Next.js App Router ignores directories
 * prefixed with `_` for routing, so this is private utility code, not a route
 * handler. Imported by the [importBatchId]/sheets, mapping, and commit routes.
 *
 * Responsibilities:
 *   - Resolve the ImportBatch row + verify ownership (via the project's ownerId).
 *   - Locate the temp file written by the upload route (/tmp/import-<id>.xlsx).
 *   - Load the workbook with ExcelJS (single place that knows about the temp-file
 *     layout — easy to swap for S3 storage later).
 *   - Resolve a column reference (column letter "A" or header name "Description")
 *     to a 0-indexed column number on a worksheet.
 */

import ExcelJS from "exceljs";
import { promises as fs } from "fs";
import path from "path";

import type { ImportBatch, Project } from "@prisma/client";

// ─── Constants ────────────────────────────────────────────────────────────

const TMP_DIR = "/tmp";

/** Build the temp file path for a given ImportBatch id. */
export function importBatchFilePath(batchId: string): string {
  return path.join(TMP_DIR, `import-${batchId}.xlsx`);
}

// ─── Batch + ownership ────────────────────────────────────────────────────

/**
 * Verify that the ImportBatch belongs to the current user (via the project's
 * ownerId). Returns the batch + the project, or null if either is missing or
 * the user doesn't own the project.
 */
export async function getOwnedImportBatch(
  batchId: string,
  userId: string,
  prisma: {
    importBatch: { findUnique: (args: { where: { id: string } }) => Promise<ImportBatch | null> };
    project: { findUnique: (args: { where: { id: string } }) => Promise<Project | null> };
  },
): Promise<{ batch: ImportBatch; project: Project } | null> {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return null;
  const project = await prisma.project.findUnique({ where: { id: batch.projectId } });
  if (!project) return null;
  if (project.ownerId !== userId) return null;
  return { batch, project };
}

// ─── Workbook loading ────────────────────────────────────────────────────

/**
 * Load the Excel workbook for a given ImportBatch id.
 *
 * Throws if the temp file doesn't exist (the upload route didn't run, or the
 * file was swept). Callers should catch and return a 422.
 */
export async function loadWorkbook(
  batchId: string,
): Promise<ExcelJS.Workbook> {
  const filePath = importBatchFilePath(batchId);
  let buffer: ArrayBuffer;
  try {
    // Read as ArrayBuffer to avoid Buffer generic type mismatch with
    // ExcelJS's expected type (which is `Buffer` from the older @types/node).
    const raw = await fs.readFile(filePath);
    buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  } catch {
    throw new Error(
      `Uploaded Excel file not found for batch ${batchId}. The temp file may have been swept — please re-upload.`,
    );
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

// ─── Column reference resolution ─────────────────────────────────────────

/**
 * Convert a spreadsheet column letter (e.g. "A", "Z", "AA") to a 0-indexed
 * column number. Returns null if `ref` is not a column letter.
 */
function letterToColumnIndex(letter: string): number | null {
  if (!/^[A-Za-z]+$/.test(letter)) return null;
  const upper = letter.toUpperCase();
  let col = 0;
  for (let i = 0; i < upper.length; i++) {
    col = col * 26 + (upper.charCodeAt(i) - "A".charCodeAt(0) + 1);
  }
  return col - 1; // 0-indexed
}

/**
 * Resolve a column reference (column letter OR header name) to a 0-indexed
 * column number on the given worksheet.
 *
 * Resolution order:
 *   1. If the ref looks like a column letter (e.g. "A", "AA"), use it directly.
 *   2. Otherwise, treat it as a header name — scan row 1 for a matching cell
 *      (case-insensitive exact match).
 *
 * Returns null if the column cannot be resolved. Callers should skip rows
 * where a required column can't be resolved (or fail loudly).
 *
 * The header row is assumed to be row 1 (ExcelJS rowNumber=1). Callers that
 * want a different header row should adjust `headerRow` (1-indexed per
 * ExcelJS convention).
 */
export function resolveColumnIndex(
  ws: ExcelJS.Worksheet,
  ref: string,
  headerRow: number = 1,
): number | null {
  if (!ref) return null;

  // Try column-letter interpretation first.
  const letterIdx = letterToColumnIndex(ref.trim());
  if (letterIdx !== null) return letterIdx;

  // Otherwise scan the header row for a matching cell value.
  const target = ref.trim().toLowerCase();
  const row = ws.getRow(headerRow);
  let foundIdx: number | null = null;
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (foundIdx !== null) return;
    const val = cell.value;
    const strVal =
      typeof val === "string"
        ? val
        : val !== null && typeof val === "object" && "text" in val
          ? String((val as { text: string }).text)
          : val !== null && val !== undefined
            ? String(val)
            : "";
    if (strVal.trim().toLowerCase() === target) {
      foundIdx = colNumber - 1; // convert 1-indexed to 0-indexed
    }
  });
  return foundIdx;
}

/**
 * Read a cell value as a string (for BoQ item fields). ExcelJS returns
 * numbers, Dates, strings, or rich-text objects; we coerce to a plain
 * string. Money/qty values are preserved verbatim (no float coercion per BR-1).
 */
export function cellToString(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  colIndex: number,
): string {
  if (colIndex < 0) return "";
  // ExcelJS uses 1-indexed row/column numbers.
  const cell = ws.getCell(rowNumber, colIndex + 1);
  const val = cell.value;
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return val.toISOString();
  // ExcelJS rich-text + hyperlink objects have a `text` field.
  if (typeof val === "object" && "text" in val) {
    return String((val as { text: string }).text).trim();
  }
  // Formula objects have a `result` field.
  if (typeof val === "object" && "result" in val) {
    const r = (val as { result: unknown }).result;
    if (r === null || r === undefined) return "";
    if (typeof r === "string") return r.trim();
    if (typeof r === "number") return String(r);
    return String(r).trim();
  }
  return String(val).trim();
}
