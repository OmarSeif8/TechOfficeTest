/**
 * Rebar Weight Calculator — pure domain calculation (platform-agnostic).
 *
 * Implements BR-11 (rebar unit weights from seeded table) and BR-12 (rebar
 * weight = Σ(cutting length × count × unit weight), kg; tonnage = kg/1000
 * displayed per BR-6) from SPEC_PHASE1_BOQ_WEB.md §5.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic.
 * Per BR-1 — decimal.js for all math; strings in / strings out.
 *
 * GT-5 (must reproduce exactly):
 *   Input:  diameterMm=12, cuttingLength=11.25, count=85
 *   Ø12 unit weight from table = 0.888 kg/m
 *   totalLength = 11.25 × 85 = 956.25 m
 *   totalWeightKg = 956.25 × 0.888 = 849.15 kg
 *   totalWeightTon = 849.15 / 1000 = 0.84915 → 3dp (per BR-6 ton precision) = 0.849 ton
 */

import Decimal from "decimal.js";
import type { RebarCalculatorInput } from "@shared/schemas/calculator";
import { getRebarWeight } from "@shared/rebar-weights";

// ─── decimal.js configuration ─────────────────────────────────────────────
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Types ────────────────────────────────────────────────────────────────

export interface RebarResult {
  /** Total cutting length across all bars (m), formatted to 2dp. */
  totalLength: string;
  /** Total weight in kilograms, formatted to 2dp (per BR-6 kg precision). */
  totalWeightKg: string;
  /** Total weight in metric tons (= kg / 1000), formatted to 3dp (per BR-6 ton precision). */
  totalWeightTon: string;
  /** The unit this calculator's primary result uses (kg). Ton is a derived display value. */
  unit: "kg";
}

// ─── Pure domain functions ────────────────────────────────────────────────

/**
 * Compute rebar total length and weight per BR-11 + BR-12.
 *
 * Formula (BR-12):
 *   totalLength    = cuttingLength × count
 *   totalWeightKg  = totalLength × unitWeight(diameterMm)
 *   totalWeightTon = totalWeightKg / 1000
 *
 * The unit weight for the given diameter is looked up in REBAR_WEIGHTS_KG_PER_M
 * (BR-11) — defined in @shared/rebar-weights.ts.
 *
 * @throws Error if diameterMm is not in the rebar weight table.
 * @throws Error if cuttingLength cannot be parsed as a decimal.
 */
export function computeRebar(input: RebarCalculatorInput): RebarResult {
  const cuttingLength = new Decimal(input.cuttingLength ?? "0");
  const count = new Decimal(input.count ?? 0);

  // BR-11: look up the unit weight from the seeded table.
  const unitWeight = new Decimal(getRebarWeight(input.diameterMm));

  // BR-12: total length and weight.
  const totalLength = cuttingLength.times(count);
  const totalWeightKg = totalLength.times(unitWeight);
  const totalWeightTon = totalWeightKg.dividedBy(1000);

  return {
    totalLength: formatLength(totalLength),
    totalWeightKg: formatWeight(totalWeightKg),
    totalWeightTon: formatTon(totalWeightTon),
    unit: "kg",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Decimal as a length string with exactly 2 decimal places (HALF_UP).
 * Cutting length is typically expressed to 2dp (engineering convention).
 *
 * @internal
 */
function formatLength(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

/**
 * Format a Decimal as a weight string (kg) with exactly 2 decimal places (HALF_UP).
 * Per BR-6: kg → 2dp.
 *
 * @internal
 */
function formatWeight(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

/**
 * Format a Decimal as a tonnage string with exactly 3 decimal places (HALF_UP).
 * Per BR-6: ton → 3dp.
 *
 * @internal
 */
function formatTon(d: Decimal): string {
  return d.toDecimalPlaces(3).toFixed(3);
}
