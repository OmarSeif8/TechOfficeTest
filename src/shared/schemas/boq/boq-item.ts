/**
 * BoQ Item — shared zod schema (platform-agnostic — pure TypeScript + zod).
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types + zod.
 * Used by: src/domain/boq/ (calculation), src/services/ (validation),
 *          src/infrastructure/ (Prisma mapping), src/app/api/ (request validation).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma, fs, etc.
 * Per BR-1 — all money/qty values are strings (decimal.js on the consuming side).
 */

import { z } from "zod";

/**
 * Item type enum (mirrors Prisma `BoQItem.itemType`).
 * - RATE_BASED: qty × rate = amount (default).
 * - LUMP_SUM:   qty locked = 1; amount = rate (BR-5).
 * - PROVISIONAL_SUM: included in totals, flagged (excluded from analysis).
 * - DAYWORK:    rate-only, excluded from analysis features (BR-5).
 * - UNIT_ONLY:  no qty — for future/pricing lists.
 */
export const ItemTypeSchema = z.enum([
  "RATE_BASED",
  "LUMP_SUM",
  "PROVISIONAL_SUM",
  "DAYWORK",
  "UNIT_ONLY",
]);

export type ItemType = z.infer<typeof ItemTypeSchema>;

/**
 * BoQItem input — the shape consumed by the domain `computeBoqTotals` function.
 * All money/qty fields are strings (decimal.js-parsed on the domain side).
 */
export const BoqItemInputSchema = z.object({
  id: z.string().optional(),
  itemType: ItemTypeSchema.default("RATE_BASED"),
  quantity: z.string().default("0"),
  rate: z.string().default("0"),
  // Per BR-6: display precision comes from the unit, but the domain function
  // doesn't need it — rounding is always HALF_UP to 2dp for money (BR-2).
});

export type BoqItemInput = z.infer<typeof BoqItemInputSchema>;

/**
 * BoQSection input — sections contain items and produce a subtotal.
 */
export const BoqSectionInputSchema = z.object({
  id: z.string().optional(),
  code: z.string().optional(),
  titleEn: z.string().optional(),
  titleAr: z.string().optional(),
  items: z.array(BoqItemInputSchema).default([]),
});

export type BoqSectionInput = z.infer<typeof BoqSectionInputSchema>;

/**
 * BoQDocument input — the top-level aggregate for totals computation.
 * VAT percentage is optional (BR-4 — VAT shown as separate line if enabled).
 */
export const BoqDocumentInputSchema = z.object({
  id: z.string().optional(),
  nameEn: z.string().optional(),
  nameAr: z.string().optional(),
  vatPercentage: z.string().optional(), // e.g. "14" for 14%
  sections: z.array(BoqSectionInputSchema).default([]),
});

export type BoqDocumentInput = z.infer<typeof BoqDocumentInputSchema>;
