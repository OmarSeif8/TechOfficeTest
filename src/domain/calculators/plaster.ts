/**
 * Plaster Area Calculator — pure domain calculation (platform-agnostic).
 *
 * Implements the plaster net-area formula referenced in GT-7
 * (SPEC_PHASE1_BOQ_WEB.md §6):
 *   grossArea (per face)       = wallLength × wallHeight
 *   deductionsArea (per face)  = Σ openings where (w × h) > deductThreshold
 *   netArea (total, both faces) = (grossArea − deductionsArea) × faces
 *
 * Per S6 spec: openings deduction rule is configurable, default deduct > 1.0 m²
 * (smaller openings like access panels are plastered around, not deducted).
 * Jambs/soffits toggle is deferred to a later phase.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic.
 * Per BR-1 — decimal.js for all math; strings in / strings out.
 *
 * GT-7 (must reproduce exactly):
 *   Input:  wallLength=20, wallHeight=3, faces=2,
 *           openings=[{2, 1.5}], deductThreshold="1"
 *   Expected:
 *     grossArea (per face)      = 20 × 3 = 60.00 m²
 *     deductionsArea (per face) = 2 × 1.5 = 3.00 m² (> 1 m² threshold → deducted)
 *     netArea (total)          = (60 − 3) × 2 = 114.00 m²
 *   ⇒ (60 − 3) × 2 = 114.00 m²
 */

import Decimal from "decimal.js";
import type { PlasterCalculatorInput } from "@shared/schemas/calculator";

// ─── decimal.js configuration ─────────────────────────────────────────────
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Types ────────────────────────────────────────────────────────────────

export interface PlasterResult {
  /** Per-face gross wall area = wallLength × wallHeight (m²), formatted to 2dp. */
  grossArea: string;
  /** Per-face total deductions (only openings above the threshold) (m²), formatted to 2dp. */
  deductionsArea: string;
  /** Net plaster area across all faces (m²), formatted to 2dp. */
  netArea: string;
  /** The unit this calculator produces. */
  unit: "m2";
}

// ─── Pure domain functions ────────────────────────────────────────────────

/**
 * Compute plaster net area per GT-7.
 *
 * Deduction rule (S6 spec): an opening is deducted only if its area
 * (width × height) is strictly greater than `deductThreshold` (default "1" m²).
 *
 * @throws Error if any input cannot be parsed as a decimal.
 */
export function computePlaster(input: PlasterCalculatorInput): PlasterResult {
  const wallLength = new Decimal(input.wallLength ?? "0");
  const wallHeight = new Decimal(input.wallHeight ?? "0");
  const faces = new Decimal(input.faces ?? "2");
  const deductThreshold = new Decimal(input.deductThreshold ?? "1");

  // Per-face gross wall area.
  const grossAreaPerFace = wallLength.times(wallHeight);

  // Per-face deductions: only openings whose area strictly exceeds the threshold.
  const deductionsPerFace = (input.openings ?? []).reduce<Decimal>((sum, opening) => {
    const w = new Decimal(opening.width ?? "0");
    const h = new Decimal(opening.height ?? "0");
    const area = w.times(h);
    if (area.gt(deductThreshold)) {
      return sum.plus(area);
    }
    return sum;
  }, new Decimal(0));

  // Per-face net area.
  const netAreaPerFace = grossAreaPerFace.minus(deductionsPerFace);

  // Total net area across all faces.
  const netArea = netAreaPerFace.times(faces);

  return {
    grossArea: formatArea(grossAreaPerFace),
    deductionsArea: formatArea(deductionsPerFace),
    netArea: formatArea(netArea),
    unit: "m2",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Decimal as an area string with exactly 2 decimal places (HALF_UP).
 * Matches GT-7 expected "60.00" / "3.00" / "114.00" (m² convention is 2dp).
 *
 * @internal
 */
function formatArea(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}
