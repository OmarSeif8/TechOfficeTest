/**
 * Units Registry — the 9 canonical units with default precision (per BR-6).
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types.
 *
 * Per SPEC_PHASE1_BOQ_WEB.md §5 (BR-6):
 *   "Display precision defaults (configurable in project settings):
 *    m³/m²/m → 2dp; kg → 2dp; ton → 3dp; no. → 0dp; LS → qty 0dp."
 *
 * This registry is the app-wide default for *display rounding*. Project settings
 * (per BR-6 + S10) can override per-project. The pure domain calculator functions
 * format their outputs to match the GT expected values, which (for engineering
 * convention) round m³/m²/m/kg to 2dp and ton to 3dp.
 *
 * NOTE: This file is pure data — no side effects, no platform imports.
 * Mirrors the seeded `Unit` table from prisma/seed.ts (WO-W-2).
 */

export interface UnitDefinition {
  /** Default display precision (decimal places). Per BR-6. */
  readonly precision: number;
  /** Human-readable label (English). */
  readonly label: string;
}

/**
 * The 9 canonical units. Keys are stable identifiers (lowercase, no diacritics).
 * Mirrors the seeded `Unit` table.
 *
 * `sum` is the "Lump Sum" unit (qty 0dp, value = a single fixed amount).
 */
export const UNITS_REGISTRY = {
  "m":   { precision: 2, label: "Meter" },
  "m2":  { precision: 2, label: "Square Meter" },
  "m3":  { precision: 3, label: "Cubic Meter" },
  "ton": { precision: 3, label: "Ton" },
  "kg":  { precision: 2, label: "Kilogram" },
  "no":  { precision: 0, label: "Number" },
  "lot": { precision: 0, label: "Lot" },
  "hr":  { precision: 1, label: "Hour" },
  "sum": { precision: 0, label: "Lump Sum" },
} as const;

export type UnitCode = keyof typeof UNITS_REGISTRY;

/**
 * Look up a unit's definition by code. Throws if not found (defensive —
 * callers should validate against the registry before lookup).
 */
export function getUnitDefinition(code: string): UnitDefinition {
  const def = (UNITS_REGISTRY as Record<string, UnitDefinition>)[code];
  if (!def) {
    throw new Error(`Unknown unit code: "${code}". Known units: ${Object.keys(UNITS_REGISTRY).join(", ")}`);
  }
  return def;
}

/**
 * List of all valid unit codes (for validation / dropdowns).
 */
export const ALL_UNIT_CODES: readonly UnitCode[] = Object.keys(UNITS_REGISTRY) as UnitCode[];
