/**
 * Masonry Volume Calculator — pure domain calculation (platform-agnostic).
 *
 * Implements the masonry volume formula referenced in GT-6
 * (SPEC_PHASE1_BOQ_WEB.md §6):
 *   grossArea     = wallLength × wallHeight
 *   openingsArea = Σ (opening.width × opening.height)
 *   netArea      = grossArea − openingsArea
 *   volume       = netArea × wallThickness
 *
 * All openings are deducted (no threshold for masonry — every opening removes
 * a block of wall volume). The plaster calculator has the >1 m² threshold rule.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic.
 * Per BR-1 — decimal.js for all math; strings in / strings out.
 *
 * GT-6 (must reproduce exactly):
 *   Input:  wallLength=6.00, wallHeight=3.00, wallThickness=0.25,
 *           openings=[{1.2,1.5}, {1.2,1.5}]
 *   Expected:
 *     grossArea     = 6.00 × 3.00 = 18.00 m²
 *     openingsArea  = 2 × (1.2 × 1.5) = 3.60 m²
 *     netArea       = 18.00 − 3.60 = 14.40 m²
 *     volume        = 14.40 × 0.25 = 3.60 m³
 *   ⇒ (18 − 3.60) × 0.25 = 3.60 m³
 */

import Decimal from "decimal.js";
import type { MasonryCalculatorInput } from "@shared/schemas/calculator";

// ─── decimal.js configuration ─────────────────────────────────────────────
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Types ────────────────────────────────────────────────────────────────

export interface MasonryResult {
  /** Wall gross face area = wallLength × wallHeight (m²), formatted to 2dp. */
  grossArea: string;
  /** Sum of opening areas (m²), formatted to 2dp. */
  openingsArea: string;
  /** Net face area after deducting openings (m²), formatted to 2dp. */
  netArea: string;
  /** Wall volume = netArea × wallThickness (m³), formatted to 2dp. */
  volume: string;
  /** The unit this calculator's primary result uses (m³). */
  unit: "m3";
}

// ─── Pure domain functions ────────────────────────────────────────────────

/**
 * Compute masonry gross area, openings deduction, net area, and volume per GT-6.
 *
 * @throws Error if any input cannot be parsed as a decimal.
 */
export function computeMasonry(input: MasonryCalculatorInput): MasonryResult {
  const wallLength = new Decimal(input.wallLength ?? "0");
  const wallHeight = new Decimal(input.wallHeight ?? "0");
  const wallThickness = new Decimal(input.wallThickness ?? "0");

  const grossArea = wallLength.times(wallHeight);

  const openingsArea = (input.openings ?? []).reduce<Decimal>((sum, opening) => {
    const w = new Decimal(opening.width ?? "0");
    const h = new Decimal(opening.height ?? "0");
    return sum.plus(w.times(h));
  }, new Decimal(0));

  const netArea = grossArea.minus(openingsArea);
  const volume = netArea.times(wallThickness);

  return {
    grossArea: formatArea(grossArea),
    openingsArea: formatArea(openingsArea),
    netArea: formatArea(netArea),
    volume: formatVolume(volume),
    unit: "m3",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Decimal as an area string with exactly 2 decimal places (HALF_UP).
 *
 * @internal
 */
function formatArea(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

/**
 * Format a Decimal as a volume string with exactly 2 decimal places (HALF_UP).
 * Matches GT-6 expected "3.60" (engineering convention for masonry volume is 2dp).
 *
 * @internal
 */
function formatVolume(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}
