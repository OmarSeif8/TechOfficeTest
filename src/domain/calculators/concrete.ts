/**
 * Concrete Volume Calculator — pure domain calculation (platform-agnostic).
 *
 * Implements the concrete volume formula referenced in GT-3 (SPEC_PHASE1_BOQ_WEB.md §6):
 *   volumePerItem = length × width × height
 *   totalVolume  = volumePerItem × count
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* and decimal.js.
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Per BR-1 — all qty math uses decimal.js. Inputs are strings (parsed by decimal.js
 * to avoid float imprecision). Outputs are strings formatted to engineering
 * convention (2dp for volume — matches GT-3 expected "3.24").
 *
 * GT-3 (must reproduce exactly):
 *   Input:  length=0.30, width=0.30, height=3.00, count=12
 *   Expected: 0.27 m³ each → 3.24 m³ total
 *     (0.30 × 0.30 × 3.00 = 0.27 ; 0.27 × 12 = 3.24)
 */

import Decimal from "decimal.js";
import type { ConcreteCalculatorInput } from "@shared/schemas/calculator";

// ─── decimal.js configuration ─────────────────────────────────────────────
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Types ────────────────────────────────────────────────────────────────

export interface ConcreteResult {
  /** Volume of a single element, formatted to 2dp (m³). */
  volumePerItem: string;
  /** Total volume across all `count` elements, formatted to 2dp (m³). */
  totalVolume: string;
  /** The unit this calculator produces. */
  unit: "m3";
}

// ─── Pure domain functions ────────────────────────────────────────────────

/**
 * Compute concrete volume per GT-3.
 *
 * Formula: V = L × W × H × count.
 *
 * @throws Error if any input cannot be parsed as a decimal.
 */
export function computeConcrete(input: ConcreteCalculatorInput): ConcreteResult {
  const length = new Decimal(input.length ?? "0");
  const width = new Decimal(input.width ?? "0");
  const height = new Decimal(input.height ?? "0");
  const count = new Decimal(input.count ?? "1");

  // Per-item volume: L × W × H
  const volumePerItem = length.times(width).times(height);

  // Total: per-item × count
  const totalVolume = volumePerItem.times(count);

  return {
    volumePerItem: formatVolume(volumePerItem),
    totalVolume: formatVolume(totalVolume),
    unit: "m3",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Decimal as a volume string with exactly 2 decimal places (HALF_UP).
 *
 * Volume outputs match the GT-3 expected values (e.g., "3.24", "0.27") —
 * engineering convention is 2dp for concrete volume, NOT the 3dp default in
 * UNITS_REGISTRY (which is for display rounding of user-entered values, not
 * the calculator output). The golden test is authoritative.
 *
 * @internal
 */
function formatVolume(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}
