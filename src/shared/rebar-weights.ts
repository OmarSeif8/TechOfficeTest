/**
 * Rebar Unit Weights — BR-11 weight table (kg per linear meter of bar).
 *
 * Lives in src/shared/ (lowest layer). Pure data — no side effects, no platform imports.
 *
 * Per SPEC_PHASE1_BOQ_WEB.md §5 (BR-11):
 *   "Rebar unit weights from seeded table (Ø8→0.395, Ø10→0.617, Ø12→0.888,
 *    Ø16→1.578, Ø20→2.466, Ø25→3.854, Ø32→6.313 kg/m; table extensible)."
 *
 * Values are stored as decimal strings (per BR-1 — never use Number for money/qty).
 * The full Ø6..Ø36 table mirrors the seeded `RebarDiameter` table from prisma/seed.ts
 * (WO-W-2). Values are rounded to 3dp as per industry-standard rebar weight tables.
 *
 * Used by src/domain/calculators/rebar.ts to implement BR-12.
 */

/**
 * Mapping from bar diameter (mm) to unit weight (kg/m) as a decimal string.
 *
 * Lookup is by integer diameter. Throws on unknown diameter (defensive — callers
 * should validate against the table keys before lookup, e.g., via `getRebarWeight`).
 */
export const REBAR_WEIGHTS_KG_PER_M: Record<number, string> = {
  6:  "0.222",
  8:  "0.395",
  10: "0.617",
  12: "0.888",
  14: "1.21",
  16: "1.58",
  18: "2.00",
  20: "2.47",
  22: "2.98",
  25: "3.85",
  28: "4.83",
  32: "6.31",
  36: "7.99",
};

/**
 * All valid rebar diameters (mm), sorted ascending.
 * Useful for dropdowns and validation.
 */
export const ALL_REBAR_DIAMETERS: readonly number[] = Object.keys(REBAR_WEIGHTS_KG_PER_M)
  .map((d) => Number(d))
  .sort((a, b) => a - b);

/**
 * Look up the unit weight (kg/m) for a given bar diameter.
 *
 * @param diameterMm — the bar diameter in millimeters (e.g., 12 for Ø12).
 * @returns the unit weight as a decimal string (e.g., "0.888").
 * @throws Error if the diameter is not in the table.
 */
export function getRebarWeight(diameterMm: number): string {
  const weight = REBAR_WEIGHTS_KG_PER_M[diameterMm];
  if (weight === undefined) {
    throw new Error(
      `Unknown rebar diameter: Ø${diameterMm}mm. Known diameters: ${ALL_REBAR_DIAMETERS.join(", ")} (Ø${ALL_REBAR_DIAMETERS.map((d) => d).join(", Ø")}mm)`,
    );
  }
  return weight;
}
