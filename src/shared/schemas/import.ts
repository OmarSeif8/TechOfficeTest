/**
 * Import wizard — shared zod schemas (platform-agnostic — pure TypeScript + zod).
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types + zod.
 * Used by: src/app/api/imports/* (request body validation), and potentially
 * the import wizard UI on the client.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react,
 * prisma, fs, etc. It defines the wire shape of the import-wizard API contract.
 *
 * Workflow (4-step wizard):
 *   1. POST /api/imports/upload        → returns { importBatchId, fileName, sheetNames }
 *   2. GET  /api/imports/[id]/sheets   → returns { sheetName, firstRows: string[][] }[]
 *   3. POST /api/imports/[id]/mapping  → body: { sheetName, mapping, skipRows } → returns preview rows
 *   4. POST /api/imports/[id]/commit   → body: ImportCommitSchema → creates Document + Sections + Items
 *
 * Mapping semantics:
 *   Each value in `ImportMappingSchema` is a column reference — either a
 *   spreadsheet column letter (e.g. "A", "B", "AA") or a column header name
 *   (e.g. "Description", "Qty"). The commit route resolves the column ref
 *   against the sheet's header row.
 */

import { z } from "zod";

/**
 * Maps Excel columns to BoQ item fields. Each value is a column reference
 * (column letter OR header name) — interpreted by the commit route.
 *
 * Required fields: descriptionEn, quantity, rate.
 * Optional fields: code, descriptionAr, unit.
 *
 * BR-1: money/qty fields are strings (preserved verbatim from the Excel cell).
 */
export const ImportMappingSchema = z.object({
  /** Column ref for the BoQ item code (e.g. "A" or "Item Code"). Optional. */
  code: z.string().trim().optional(),
  /** Column ref for English description (required). */
  descriptionEn: z.string().trim().min(1, "descriptionEn mapping is required"),
  /** Column ref for Arabic description (optional). */
  descriptionAr: z.string().trim().optional(),
  /** Column ref for unit code/id (optional). */
  unit: z.string().trim().optional(),
  /** Column ref for quantity (required — money/qty as string per BR-1). */
  quantity: z.string().trim().min(1, "quantity mapping is required"),
  /** Column ref for unit rate (required — money/qty as string per BR-1). */
  rate: z.string().trim().min(1, "rate mapping is required"),
});

export type ImportMapping = z.infer<typeof ImportMappingSchema>;

/**
 * Body for POST /api/imports/[id]/commit — executes the import.
 *
 * - `documentName`: name for the new BoQDocument (created in the same
 *   transaction as the items).
 * - `sectionCode` / `sectionTitle`: optional — if both omitted, all imported
 *   items go into a single default section. If provided, items go into a
 *   section with the given code/title.
 * - `mapping`: column-to-field mapping (required).
 * - `skipRows`: 0-indexed row numbers within the sheet to skip during import
 *   (typically used to skip header rows, summary rows, or rows the user
 *   marked as invalid during the mapping preview).
 */
export const ImportCommitSchema = z.object({
  documentName: z.string().trim().min(1, "documentName is required"),
  sectionCode: z.string().trim().optional(),
  sectionTitle: z.string().trim().optional(),
  mapping: ImportMappingSchema,
  skipRows: z.array(z.number().int().nonnegative()).default([]),
});

export type ImportCommit = z.infer<typeof ImportCommitSchema>;

/**
 * Body for POST /api/imports/[id]/mapping — stores the mapping + returns
 * a preview of the first 5 rows mapped to BoQ item shapes (so the user can
 * verify before committing).
 *
 * - `sheetName`: which sheet in the workbook to import from.
 * - `mapping`: column-to-field mapping.
 * - `skipRows`: rows to skip during commit (carried through to preview).
 */
export const ImportMappingRequestSchema = z.object({
  sheetName: z.string().trim().min(1, "sheetName is required"),
  mapping: ImportMappingSchema,
  skipRows: z.array(z.number().int().nonnegative()).default([]),
});

export type ImportMappingRequest = z.infer<typeof ImportMappingRequestSchema>;

/**
 * Body for POST /api/imports/upload — multipart form, so no JSON body.
 * The `projectId` is provided as a query parameter or form field.
 */
export const UploadQuerySchema = z.object({
  projectId: z.string().trim().min(1, "projectId is required"),
});

export type UploadQuery = z.infer<typeof UploadQuerySchema>;
