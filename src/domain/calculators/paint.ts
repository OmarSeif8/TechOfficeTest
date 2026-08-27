/**
 * Paint Area Calculator — pure domain calculation (platform-agnostic).
 *
 * Implements the paint area formula referenced in GT-8
 * (SPEC_PHASE1_BOQ_WEB.md §6):
 *   area            = surfaceArea
 *   totalCoatArea   = area × coats
 *
 * The input `surfaceArea` is the precomputed paintable area (typically the
 * plaster net area from GT-7's wall). `coats` is the number of paint coats
 * to apply (default 2 — primer + finish, or two finish coats).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic.
 * Per BR-1 — decimal.js for all math; strings in / strings out.
 *
 * GT-8 (must reproduce exactly):
 *   Input:  surfaceArea="114", coats=2
 *   Expected:
 *     area           = 114.00 m² (the input surface area, formatted to 2dp)
 *     totalCoatArea  = 114 × 2 = 228.00 m²
 *   ⇒ 228.00 m²
 */

import Decimal from "decimal.js";
import type { PaintCalculatorInput } from "@shared/schemas/calculator";

// ─── decimal.js configuration ─────────────────────────────────────────────
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Types ────────────────────────────────────────────────────────────────

export interface PaintResult {
  /** The surface area (input, formatted to 2dp for consistency). */
  area: string;
  /** Number of coats (echoed from input). */
  coats: number;
  /** Total paintable area across all coats (m²), formatted to 2dp. */
  totalCoatArea: string;
  /** The unit this calculator produces. */
  unit: "m2";
}

// ─── Pure domain functions ────────────────────────────────────────────────

/**
 * Compute paint total area per GT-8.
 *
 * @throws Error if `surfaceArea` cannot be parsed as a decimal.
 */
export function computePaint(input: PaintCalculatorInput): PaintResult {
  const surfaceArea = new Decimal(input.surfaceArea ?? "0");
  const coats = input.coats ?? 2;

  const totalCoatArea = surfaceArea.times(coats);

  return {
    area: formatArea(surfaceArea),
    coats,
    totalCoatArea: formatArea(totalCoatArea),
    unit: "m2",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Decimal as an area string with exactly 2 decimal places (HALF_UP).
 * Matches GT-8 expected "114.00" / "228.00" (m² convention is 2dp).
 *
 * @internal
 */
function formatArea(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}
