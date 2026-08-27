/**
 * Rate Analysis — shared zod schemas (platform-agnostic — pure TypeScript + zod).
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types + zod.
 * Used by: src/domain/estimating/ (calculation), src/services/ (validation),
 *          src/infrastructure/ (Prisma mapping), src/app/api/ (request validation).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma, fs, etc.
 * Per BR-1 — all money/qty values are strings (decimal.js on the consuming side).
 *
 * Implements schemas for business rules BR-8, BR-9, BR-10 (see SPEC_PHASE1_BOQ_WEB §5):
 *   - BR-8: Material line cost = consumption × (1 + waste%) × unit cost.
 *   - BR-9: Direct cost = Σ materials (incl. waste) + Σ labor + Σ equipment + Σ subcontract,
 *           per output unit.
 *   - BR-10: Rate = round((Direct × (1+OH%)) × (1+Profit%), 2). Order fixed: OH then profit.
 *
 * Labor mode (BR-9): XOR between CONSUMPTION and CREW — enum mechanically enforces
 * "only one mode set". Default is CONSUMPTION when not specified.
 *   - CONSUMPTION: labor line cost = quantity × unitPrice (e.g., 8 hrs × 25 $/hr = 200).
 *   - CREW:        labor line cost = unitPrice / outputQuantity
 *                  (unitPrice = crew cost per day, outputQuantity = m³/day or similar).
 */

import { z } from "zod";

/**
 * Labor entry mode for rate analysis (BR-9).
 *
 * - CONSUMPTION: labor cost computed as quantity × unitPrice (the default).
 * - CREW:        labor cost computed as unitPrice ÷ outputQuantity, where unitPrice
 *                is the daily crew cost and outputQuantity is the day's output
 *                (e.g., 4,000/day ÷ 40 m³/day = 100.00 per m³).
 *
 * The two modes are mutually exclusive (XOR) — zod enum mechanically enforces
 * only one value; default is CONSUMPTION if omitted.
 */
export const RateAnalysisLaborModeSchema = z.enum(["CONSUMPTION", "CREW"]);
export type RateAnalysisLaborMode = z.infer<typeof RateAnalysisLaborModeSchema>;

/**
 * Line type enum for rate analysis lines.
 * Mirrors Prisma `RateAnalysisLine.lineType`.
 *
 * - MATERIAL:    applies waste factor (BR-8).
 * - LABOR:       cost depends on laborMode (BR-9).
 * - EQUIPMENT:   qty × unitPrice (no waste).
 * - SUBCONTRACT: qty × unitPrice (no waste).
 */
export const RateAnalysisLineTypeSchema = z.enum([
  "MATERIAL",
  "LABOR",
  "EQUIPMENT",
  "SUBCONTRACT",
]);
export type RateAnalysisLineType = z.infer<typeof RateAnalysisLineTypeSchema>;

/**
 * A single rate-analysis line input.
 *
 * All money/qty fields are strings — parsed by decimal.js in the domain function.
 * `wastePct` applies only to MATERIAL lines (BR-8); ignored otherwise.
 * `total` is computed by the domain function — optional in input (ignored if provided).
 */
export const RateAnalysisLineInputSchema = z.object({
  lineType: RateAnalysisLineTypeSchema,
  descriptionEn: z.string(),
  descriptionAr: z.string().optional(),
  quantity: z.string().default("0"),
  unitId: z.string().optional(),
  unitPrice: z.string().default("0"),
  wastePct: z.string().default("0"),
  total: z.string().optional(), // computed by domain; ignored on input
  sortOrder: z.number().optional(),
});

export type RateAnalysisLineInput = z.infer<typeof RateAnalysisLineInputSchema>;

/**
 * Top-level rate-analysis input.
 *
 * - `lines`: the cost component lines (materials, labor, equipment, subcontract).
 * - `overheadPct` / `profitPct`: applied per BR-10 (OH first, then profit, compounding).
 * - `laborMode`: CONSUMPTION (default) or CREW — controls how LABOR lines compute.
 * - `outputQuantity`: per-day's output (e.g. "40" for 40 m³/day); used in CREW mode
 *                     and as the per-output-unit normalizer (e.g. "1" for per-m³ analysis).
 */
export const RateAnalysisInputSchema = z.object({
  lines: z.array(RateAnalysisLineInputSchema).default([]),
  overheadPct: z.string().default("0"),
  profitPct: z.string().default("0"),
  laborMode: RateAnalysisLaborModeSchema.default("CONSUMPTION"),
  outputQuantity: z.string().default("1"),
});

export type RateAnalysisInput = z.infer<typeof RateAnalysisInputSchema>;
