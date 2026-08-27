/**
 * Cost-Loading domain — BoQ ↔ schedule allocation logic.
 *
 * Implements BR-CS1 and BR-CS4 from SPEC_PHASE4_WEB.md §2.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* and decimal.js.
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are the authoritative source of truth — tests/golden/gt-cs-1-allocation.test.ts):
 *   - BR-CS1: Allocations per BoQ item must sum to exactly 100% (decimal-exact).
 *             An item may be unlinked (no allocations) — that is a warning, not an error.
 *   - BR-CS4: Coverage = linked BoQ value ÷ total BoQ value. (Returned as a 0–100 string.)
 *
 * Allocation percent representation:
 *   - `allocationPct` is a STRING in 0..100 (e.g. "60" for 60%, "12.5" for 12.5%).
 *   - The sum across all allocations for the SAME boqItemId must equal exactly 100 (BR-CS1).
 *   - Decimal-exact comparison via Decimal.equals — no float drift.
 */

import Decimal from "decimal.js";
import type {
  AllocationInput,
  BoqItemAmount,
} from "@shared/schemas/payments/cost-loading";

// ─── decimal.js configuration ─────────────────────────────────────────────
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

const ONE_HUNDRED = new Decimal(100);

/**
 * Format a Decimal as a money string with exactly 2 decimal places.
 * @internal
 */
function money(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

// ─── BR-CS1: validate allocations ───────────────────────────────────────

/**
 * Validate allocations per BR-CS1.
 *
 * For each BoQ item that has at least one allocation, the sum of its
 * `allocationPct` values must equal exactly 100 (decimal-exact).
 *
 * BoQ items with NO allocations are NOT flagged here — per BR-CS1, an unlinked
 * item is a warning (handled by the UI layer), not a validation error.
 *
 * @returns array of human-readable error strings. Empty array = valid.
 */
export function validateAllocations(allocations: AllocationInput[]): string[] {
  const errors: string[] = [];
  const sums = new Map<string, Decimal>();

  for (const a of allocations) {
    let pct: Decimal;
    try {
      pct = new Decimal(a.allocationPct);
      if (!pct.isFinite()) throw new Error("not finite");
    } catch {
      errors.push(
        `BoQ item "${a.boqItemId}": allocationPct is not a valid number (got "${a.allocationPct}").`,
      );
      continue;
    }
    const prev = sums.get(a.boqItemId) ?? new Decimal(0);
    sums.set(a.boqItemId, prev.plus(pct));
  }

  for (const [boqItemId, sum] of sums) {
    if (!sum.equals(ONE_HUNDRED)) {
      errors.push(
        `BoQ item "${boqItemId}" allocations sum to ${sum.toString()}% (must be exactly 100%).`,
      );
    }
  }

  return errors;
}

// ─── Activity planned cost ───────────────────────────────────────────────

/**
 * Compute planned cost per activity by distributing BoQ item amounts across
 * linked activities per their allocation percentages.
 *
 * For each allocation:
 *   contribution = round(item.amount × allocationPct / 100, 2)   [BR-2 pattern, HALF_UP]
 *
 * Activity planned cost = Σ contributions across all (boqItemId → activityId) allocations
 * pointing at that activity.
 *
 * @returns map of activityId → planned cost (money string, 2dp).
 */
export function computeActivityPlannedCost(
  allocations: AllocationInput[],
  boqItems: BoqItemAmount[],
): Record<string, string> {
  const amountById = new Map<string, string>(boqItems.map((b) => [b.id, b.amount] as const));
  const sums = new Map<string, Decimal>();

  for (const a of allocations) {
    const amountStr = amountById.get(a.boqItemId);
    if (amountStr === undefined) continue; // unknown BoQ item — silently skip
    const amount = new Decimal(amountStr);
    const pct = new Decimal(a.allocationPct);
    const contribution = amount.times(pct).dividedBy(ONE_HUNDRED).toDecimalPlaces(2);
    const prev = sums.get(a.activityId) ?? new Decimal(0);
    sums.set(a.activityId, prev.plus(contribution));
  }

  const result: Record<string, string> = {};
  for (const [activityId, total] of sums) {
    result[activityId] = money(total);
  }
  return result;
}

// ─── BR-CS4: coverage ─────────────────────────────────────────────────────

/**
 * Compute coverage % = linkedValue / totalBoQValue × 100 (BR-CS4).
 *
 * Returned as a 0..100 string with 2dp (e.g. "100.00", "75.50", "0.00").
 *
 * If totalBoQValue is 0, returns "0.00" (no coverage on an empty BoQ).
 */
export function computeCoverage(linkedValue: string, totalBoQValue: string): string {
  const total = new Decimal(totalBoQValue);
  if (total.isZero()) return "0.00";
  const pct = new Decimal(linkedValue).dividedBy(total).times(ONE_HUNDRED).toDecimalPlaces(2);
  return pct.toFixed(2);
}

// Re-export types so consumers can import everything from this module.
export type { AllocationInput, BoqItemAmount } from "@shared/schemas/payments/cost-loading";
