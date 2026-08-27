/**
 * Payments — Cost-Loading schemas (BoQ ↔ schedule link).
 *
 * Pure zod schemas for the cost-loading domain (BoQ items ↔ activities).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only zod + stdlib.
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Per BR-1 — all money/percent values are strings (decimal.js on the domain side).
 *
 * Law (SPEC_PHASE4_WEB.md §2 — BR-CS1, BR-CS4):
 *   - BR-CS1: Allocations per BoQ item must sum to exactly 100% (decimal-exact).
 *             An item may be unlinked (warning only — not error).
 *   - BR-CS4: Coverage = linked BoQ value ÷ total BoQ value.
 */

import { z } from "zod";

/**
 * Allocation input — one (BoQ item, activity) link with an allocation percentage.
 *
 * `allocationPct` is a string in 0..100 (e.g. "60" for 60%). Multiple allocations
 * per BoQ item are legal, but their percentages must sum to exactly 100 (BR-CS1).
 */
export const AllocationInputSchema = z.object({
  boqItemId: z.string(),
  activityId: z.string(),
  allocationPct: z.string(),
});
export type AllocationInput = z.infer<typeof AllocationInputSchema>;

/**
 * BoQ item with an "amount" — the pre-computed total for that item
 * (qty × rate, already rounded to 2dp). Used by computeActivityPlannedCost
 * to distribute item value across activities.
 */
export const BoqItemAmountSchema = z.object({
  id: z.string(),
  amount: z.string(),
});
export type BoqItemAmount = z.infer<typeof BoqItemAmountSchema>;

/**
 * Cost-loading input — the top-level aggregate.
 *
 *   - `allocations`: list of (boqItemId, activityId, allocationPct) triples.
 *   - `boqItems`:    list of BoQ items with their pre-computed amounts.
 */
export const CostLoadingInputSchema = z.object({
  allocations: z.array(AllocationInputSchema),
  boqItems: z.array(BoqItemAmountSchema),
});
export type CostLoadingInput = z.infer<typeof CostLoadingInputSchema>;
