/**
 * Calculators — shared zod schemas (platform-agnostic — pure TypeScript + zod).
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types + zod.
 * Used by: src/domain/calculators/ (calculation), src/services/ (validation),
 *          src/infrastructure/ (Prisma mapping), src/app/api/ (request validation).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma, fs, etc.
 * Per BR-1 — all money/qty values are strings (decimal.js on the consuming side).
 *
 * Schemas back the 6 calculators in F5 (concrete, formwork, rebar, masonry, plaster, paint)
 * and the corresponding GT-3..GT-8 golden tests.
 */

import { z } from "zod";

/**
 * Calculator type enum — mirrors Prisma `CalculationRecord.calculatorType`.
 * Each value maps 1:1 to a domain function in src/domain/calculators/.
 */
export const CalculatorTypeSchema = z.enum([
  "CONCRETE",
  "FORMWORK",
  "REBAR",
  "MASONRY",
  "PLASTER",
  "PAINT",
]);
export type CalculatorType = z.infer<typeof CalculatorTypeSchema>;

/**
 * Generic opening (door/window) used by masonry & plaster calculators.
 * All dims in meters, expressed as decimal strings.
 */
export const OpeningInputSchema = z.object({
  width: z.string(),
  height: z.string(),
});
export type OpeningInput = z.infer<typeof OpeningInputSchema>;

/**
 * Concrete calculator input (GT-3).
 * Computes volume = length × width × height × count.
 * Result unit: m3.
 */
export const ConcreteCalculatorInputSchema = z.object({
  length: z.string(),
  width: z.string(),
  height: z.string(),
  count: z.string().default("1"),
});
export type ConcreteCalculatorInput = z.infer<typeof ConcreteCalculatorInputSchema>;

/**
 * Formwork calculator input (GT-4).
 * Computes contact area = faces × width × height × count.
 * `length` is captured for UI/general-purpose use (e.g., distinguishing rectangular
 * sections); the formwork formula uses `width` as the per-face width and `height`
 * as the vertical dimension (the standard column-form formula).
 * `faces` default = 4 (a standalone column has 4 vertical faces).
 * Result unit: m2.
 */
export const FormworkCalculatorInputSchema = z.object({
  length: z.string(),
  width: z.string(),
  height: z.string(),
  count: z.string().default("1"),
  faces: z.string().default("4"),
});
export type FormworkCalculatorInput = z.infer<typeof FormworkCalculatorInputSchema>;

/**
 * Rebar calculator input (GT-5).
 * diameterMm is a number (it's a discrete diameter from the table — Ø12, Ø16, etc.),
 * not a decimal-string quantity.
 * cuttingLength is a string (decimal.js-parsed).
 * count is a number (bar count is always integer).
 *
 * Implements BR-11 (rebar unit weights from seeded table) + BR-12 (weight =
 * Σ(cutting length × count × unit weight), kg; tonnage = kg/1000 displayed per BR-6).
 */
export const RebarCalculatorInputSchema = z.object({
  diameterMm: z.number().int().positive(),
  cuttingLength: z.string(),
  count: z.number().int().positive(),
});
export type RebarCalculatorInput = z.infer<typeof RebarCalculatorInputSchema>;

/**
 * Masonry calculator input (GT-6).
 * Computes wall gross area (L × H), deducts openings, multiplies by thickness
 * to get net volume.
 * Result unit: m3 (volume).
 */
export const MasonryCalculatorInputSchema = z.object({
  wallLength: z.string(),
  wallHeight: z.string(),
  wallThickness: z.string(),
  openings: z.array(OpeningInputSchema).default([]),
});
export type MasonryCalculatorInput = z.infer<typeof MasonryCalculatorInputSchema>;

/**
 * Plaster calculator input (GT-7).
 * Computes net plaster area = (gross per face − deductions per face) × faces.
 * Openings are deducted only if their area > deductThreshold (default 1 m² —
 * smaller openings like small access panels are plastered around, not deducted).
 * No jambs/soffits in Phase 1 (the configurable "add jambs/soffits" toggle is
 * deferred per S6 spec).
 * Result unit: m2.
 */
export const PlasterCalculatorInputSchema = z.object({
  wallLength: z.string(),
  wallHeight: z.string(),
  faces: z.string().default("2"),
  openings: z.array(OpeningInputSchema).default([]),
  deductThreshold: z.string().default("1"),
});
export type PlasterCalculatorInput = z.infer<typeof PlasterCalculatorInputSchema>;

/**
 * Paint calculator input (GT-8).
 * Takes a precomputed surface area (typically the plaster net area from GT-7)
 * and applies the number of coats.
 * Result unit: m2.
 */
export const PaintCalculatorInputSchema = z.object({
  surfaceArea: z.string(),
  coats: z.number().int().positive().default(2),
});
export type PaintCalculatorInput = z.infer<typeof PaintCalculatorInputSchema>;
