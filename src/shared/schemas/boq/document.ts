/**
 * BoQ Document/Section/Item — shared zod schemas for API request validation.
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types + zod +
 * ItemTypeSchema (also in @shared/). No next, react, prisma, fs imports.
 *
 * Used by: src/app/api/ (request body validation per BR-WEB-11).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - All money/qty fields are strings (decimal.js on the consuming side per BR-1).
 *   - All entity ids are strings (cuid/uuid in the DB).
 *
 * The schemas mirror the IBoQRepository input types declared in
 * @domain/repositories/boq-repository (which mirror the Prisma schema).
 */

import { z } from "zod";
import { ItemTypeSchema } from "@shared/schemas/boq/boq-item";

// ─── Document ──────────────────────────────────────────────────────────────

/**
 * POST /api/projects/[projectId]/documents body.
 * `projectId` is injected from the URL path by the route handler.
 */
export const BoQDocumentCreateSchema = z.object({
  projectId: z.string().min(1),
  nameEn: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional().nullable(),
});

/**
 * PATCH /api/documents/[id] body — all fields optional; `expectedVersion`
 * required for optimistic concurrency (BR-WEB-4).
 */
export const BoQDocumentUpdateSchema = z.object({
  nameEn: z.string().min(1).max(200).optional(),
  nameAr: z.string().max(200).nullable().optional(),
  status: z.enum(["DRAFT", "FINALIZED", "ARCHIVED"]).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

// ─── Section ───────────────────────────────────────────────────────────────

/**
 * POST /api/documents/[id]/sections body.
 * `documentId` is injected from the URL path. `projectId` is resolved from
 * the parent document by the route handler (sections denormalise projectId
 * for fast project-level queries per the schema).
 */
export const BoQSectionCreateSchema = z.object({
  documentId: z.string().min(1),
  code: z.string().min(1).max(50),
  titleEn: z.string().max(200).optional(),
  titleAr: z.string().max(200).optional().nullable(),
  sortOrder: z.number().int(),
});

/**
 * PATCH /api/sections/[id] body — all fields optional; `expectedVersion`
 * optional for optimistic concurrency.
 */
export const BoQSectionUpdateSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  titleEn: z.string().max(200).optional(),
  titleAr: z.string().max(200).nullable().optional(),
  sortOrder: z.number().int().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

// ─── Item ──────────────────────────────────────────────────────────────────

/**
 * POST /api/sections/[id]/items body.
 * `sectionId` comes from the URL. `documentId` and `projectId` are
 * denormalised on the BoQItem row per the Prisma schema — the route handler
 * resolves them from the parent section's document.
 */
export const BoQItemCreateSchema = z.object({
  sectionId: z.string().min(1),
  documentId: z.string().min(1),
  projectId: z.string().min(1),
  code: z.string().max(50).optional().nullable(),
  descriptionEn: z.string().min(1).max(500),
  descriptionAr: z.string().max(500).optional().nullable(),
  unitId: z.string().optional().nullable(),
  quantity: z.string().min(1),
  rate: z.string().min(1),
  itemType: ItemTypeSchema.optional(),
  libraryItemId: z.string().optional().nullable(),
  sortOrder: z.number().int(),
});

/**
 * PATCH /api/items/[id] body — all fields optional; `expectedVersion`
 * required for optimistic concurrency.
 *
 * NOTE: `sectionId`, `documentId`, `projectId` are NOT updatable here —
 * use POST /api/items/[id]/move for section changes.
 */
export const BoQItemUpdateSchema = z.object({
  code: z.string().max(50).optional().nullable(),
  descriptionEn: z.string().min(1).max(500).optional(),
  descriptionAr: z.string().max(500).nullable().optional(),
  unitId: z.string().nullable().optional(),
  quantity: z.string().min(1).optional(),
  rate: z.string().min(1).optional(),
  itemType: ItemTypeSchema.optional(),
  sortOrder: z.number().int().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

// ─── Item reorder & move ───────────────────────────────────────────────────

/**
 * POST /api/items/[id]/reorder body — the full ordered list of item ids
 * within the target section. The route handler re-writes sortOrder for each
 * based on array index. `itemId` in the URL path is the anchor item being
 * reordered (its section is the target section).
 */
export const BoQItemReorderSchema = z.object({
  orderedItemIds: z.array(z.string().min(1)).min(1),
});

/**
 * POST /api/items/[id]/move body — move an item to a different section and
 * position in one atomic operation. The repo's `moveItem` writes sectionId +
 * sortOrder atomically (and the destination section must belong to the same
 * document — verified by the route handler).
 */
export const BoQItemMoveSchema = z.object({
  toSectionId: z.string().min(1),
  newSortOrder: z.number().int(),
});

// ─── Inferred types ───────────────────────────────────────────────────────

export type BoQDocumentCreateInput = z.infer<typeof BoQDocumentCreateSchema>;
export type BoQDocumentUpdateInput = z.infer<typeof BoQDocumentUpdateSchema>;
export type BoQSectionCreateInput = z.infer<typeof BoQSectionCreateSchema>;
export type BoQSectionUpdateInput = z.infer<typeof BoQSectionUpdateSchema>;
export type BoQItemCreateInput = z.infer<typeof BoQItemCreateSchema>;
export type BoQItemUpdateInput = z.infer<typeof BoQItemUpdateSchema>;
export type BoQItemReorderInput = z.infer<typeof BoQItemReorderSchema>;
export type BoQItemMoveInput = z.infer<typeof BoQItemMoveSchema>;
