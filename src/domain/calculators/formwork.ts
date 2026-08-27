/**
 * Formwork Area Calculator — pure domain calculation (platform-agnostic).
 *
 * Implements the formwork contact-area formula referenced in GT-4
 * (SPEC_PHASE1_BOQ_WEB.md §6):
 *   areaPerItem = faces × width × height
 *   totalArea   = areaPerItem × count
 *
 * For a standalone column with rectangular section, `faces`=4 means all four
 * vertical faces are formed; each face is `width × height` (e.g., for a
 * 0.30×0.30×3.00 m column: 4 × 0.30 × 3.00 = 3.60 m² per column).
 *
 * `length` is captured in the input schema for UI consistency (rectangular
 * sections where length ≠ width are common) but the Phase-1 formwork formula
 * uses `width` as the per-face horizontal dimension. A more general
 * `faces × max(width,length)` or perimeter-based formula can be added in a
 * later phase without breaking the GT-4 contract.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic.
 * Per BR-1 — decimal.js for all math; strings in / strings out.
 *
 * GT-4 (must reproduce exactly):
 *   Input:  length=0.30, width=0.30, height=3.00, count=12, faces=4
 *   Expected: 3.60 m² each → 43.20 m² total
 *     (4 × 0.30 × 3.00 = 3.60 ; 3.60 × 12 = 43.20)
 */

import Decimal from "decimal.js";
import type { FormworkCalculatorInput } from "@shared/schemas/calculator";

// ─── decimal.js configuration ─────────────────────────────────────────────
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Types ────────────────────────────────────────────────────────────────

export interface FormworkResult {
  /** Contact area of a single element, formatted to 2dp (m²). */
  areaPerItem: string;
  /** Total contact area across all `count` elements, formatted to 2dp (m²). */
  totalArea: string;
  /** The unit this calculator produces. */
  unit: "m2";
}

// ─── Pure domain functions ────────────────────────────────────────────────

/**
 * Compute formwork contact area per GT-4.
 *
 * Formula: A = faces × width × height × count.
 *
 * @throws Error if any input cannot be parsed as a decimal.
 */
export function computeFormwork(input: FormworkCalculatorInput): FormworkResult {
  const width = new Decimal(input.width ?? "0");
  const height = new Decimal(input.height ?? "0");
  const faces = new Decimal(input.faces ?? "4");
  const count = new Decimal(input.count ?? "1");

  // Per-item area: faces × width × height
  const areaPerItem = faces.times(width).times(height);

  // Total: per-item × count
  const totalArea = areaPerItem.times(count);

  return {
    areaPerItem: formatArea(areaPerItem),
    totalArea: formatArea(totalArea),
    unit: "m2",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Decimal as an area string with exactly 2 decimal places (HALF_UP).
 * Matches GT-4 expected "3.60" / "43.20" (m² convention is 2dp).
 *
 * @internal
 */
function formatArea(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}
