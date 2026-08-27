/**
 * Rate Analysis — pure domain calculation (platform-agnostic).
 *
 * Implements BR-8, BR-9, BR-10 from SPEC_PHASE1_BOQ_WEB.md §5.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* and decimal.js (a pure TypeScript library, no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *   - Same file compiles under Next.js server, Next.js client, Vitest, Electron main, Tauri, React Native.
 *
 * Law (golden tests are the authoritative source of truth — tests/golden/gt2-rate-analysis.test.ts):
 *   - BR-1: All money/qty math uses decimal.js. Floats never touch money.
 *   - BR-8: Material line cost = consumption × (1 + waste%) × unit cost.
 *   - BR-9: Direct cost = Σ materials (incl. waste) + Σ labor + Σ equipment + Σ subcontract,
 *           per output unit.
 *           Labor mode is XOR between CONSUMPTION and CREW (zod enum enforces):
 *             - CONSUMPTION: labor cost = quantity × unitPrice (default).
 *             - CREW:        labor cost = unitPrice / outputQuantity
 *                            (unitPrice = crew cost per day, outputQuantity = day's output).
 *   - BR-10: Rate = round((Direct × (1+OH%)) × (1+Profit%), 2).
 *           Order is FIXED in Phase 1: OH first, then Profit compounding (no intermediate
 *           rounding — only the final rate is rounded).
 *
 * GT-2 expected (must reproduce exactly):
 *   Materials (Σ 602.30):
 *     - cement 0.35 t @ 1,000 → 350.00 (consumption 0.35, no waste)
 *     - sand   0.45 m³ @ 150 → 67.50
 *     - agg    0.85 m³ @ 180 → 153.00
 *     - water  0.18 @ 10     → 1.80
 *     - admix  1 @ 30        → 30.00
 *   Labor crew 4,000/day ÷ 40 m³/day = 100.00 (CREW mode, outputQuantity="40")
 *   Equipment 60.00
 *   OH 10%, profit 15%
 *   Expected:
 *     Direct 762.30 → +OH (×1.10) = 838.53 → +Profit (×1.15) → 964.31
 */

import Decimal from "decimal.js";
import type {
  RateAnalysisInput,
  RateAnalysisLaborMode,
  RateAnalysisLineInput,
} from "@shared/schemas/rate-analysis";

// ─── decimal.js configuration ─────────────────────────────────────────────
// HALF_UP is the standard for money. precision: 28 (default) is plenty.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * A computed rate-analysis line — the original input echoed plus the
 * per-output-unit cost computed by the domain function.
 */
export interface ComputedLine {
  /** Line type (echoed from input). */
  lineType: RateAnalysisLineInput["lineType"];
  /** Bilingual description (echoed from input). */
  descriptionEn: string;
  descriptionAr?: string;
  /** Quantity (echoed from input; for CREW labor, this is informational only). */
  quantity: string;
  /** Unit id (echoed from input, if provided). */
  unitId?: string;
  /** Unit price (echoed from input). */
  unitPrice: string;
  /** Waste % (echoed from input; applies only to MATERIAL lines per BR-8). */
  wastePct: string;
  /**
   * Computed per-output-unit cost for this line, formatted to 2dp.
   * - MATERIAL:    consumption × (1 + waste%) × unitPrice  (BR-8)
   * - LABOR (CONSUMPTION): quantity × unitPrice
   * - LABOR (CREW):        unitPrice / outputQuantity
   * - EQUIPMENT / SUBCONTRACT: quantity × unitPrice
   */
  lineCost: string;
}

/**
 * Result of `computeRate`.
 * All money strings are HALF_UP rounded to 2 decimal places (money format).
 */
export interface RateResult {
  /** Σ of all line costs (BR-9 direct cost, per output unit). */
  directCost: string;
  /** overheadAmount = directCost × OH% (rounded to 2dp for display). */
  overheadAmount: string;
  /** profitAmount = (directCost × (1+OH%)) × Profit% (rounded to 2dp for display). */
  profitAmount: string;
  /** Final rate = round((directCost × (1+OH%)) × (1+Profit%), 2) (BR-10). */
  rate: string;
  /** Per-line breakdown (echoes input + adds computed `lineCost`). */
  lines: ComputedLine[];
}

// ─── Pure domain functions ────────────────────────────────────────────────

/**
 * Compute the per-output-unit cost for a single rate-analysis line.
 *
 * - MATERIAL (BR-8): consumption × (1 + waste%) × unit cost.
 * - LABOR (CONSUMPTION, BR-9 default): quantity × unitPrice.
 * - LABOR (CREW, BR-9): unitPrice / outputQuantity
 *                       (unitPrice = crew cost per day; outputQuantity = day's output).
 * - EQUIPMENT / SUBCONTRACT: quantity × unitPrice (no waste factor).
 *
 * @throws Error if the line values cannot be parsed as decimals.
 * @throws Error if laborMode is CREW and outputQuantity is zero or negative.
 */
export function computeLineCost(
  line: RateAnalysisLineInput,
  laborMode: RateAnalysisLaborMode,
  outputQuantity: Decimal,
): Decimal {
  const qty = new Decimal(line.quantity ?? "0");
  const unitPrice = new Decimal(line.unitPrice ?? "0");

  switch (line.lineType) {
    case "MATERIAL": {
      // BR-8: consumption × (1 + waste%) × unit cost
      const wastePct = new Decimal(line.wastePct ?? "0");
      const wasteFactor = new Decimal(1).plus(wastePct.dividedBy(100));
      return qty.times(wasteFactor).times(unitPrice);
    }
    case "LABOR": {
      if (laborMode === "CREW") {
        // BR-9 CREW mode: crew cost per day ÷ day's output = cost per output unit.
        // `unitPrice` carries the daily crew cost; `quantity` is the number of
        // crew-days (defaults to "1" — the per-day crew cost divided by the
        // per-day output yields the per-output-unit labor cost).
        if (outputQuantity.lte(0)) {
          throw new Error(
            "computeRate: laborMode is CREW but outputQuantity is ≤ 0. " +
              'Provide a positive outputQuantity (e.g., "40" for 40 m³/day).',
          );
        }
        return qty.times(unitPrice).dividedBy(outputQuantity);
      }
      // CONSUMPTION mode (default): quantity × unitPrice (e.g., hours × rate).
      return qty.times(unitPrice);
    }
    case "EQUIPMENT":
    case "SUBCONTRACT": {
      // Standard: qty × unitPrice (no waste factor).
      return qty.times(unitPrice);
    }
    default: {
      // Exhaustiveness check — TypeScript guarantees we never get here at compile
      // time, but runtime callers might bypass zod parsing with a stray string.
      const exhaustive: never = line.lineType;
      throw new Error(`computeRate: unknown lineType "${String(exhaustive)}"`);
    }
  }
}

/**
 * Compute the full rate-analysis result per BR-8, BR-9, BR-10.
 *
 * Order of operations (BR-10):
 *   1. Compute each line's per-output-unit cost (BR-8 for materials, BR-9 for labor).
 *   2. Direct cost = Σ all line costs (BR-9).
 *   3. Apply overhead:  direct × (1 + OH/100).  No intermediate rounding.
 *   4. Apply profit:    (step 3) × (1 + Profit/100).  No intermediate rounding.
 *   5. Round the final rate to 2dp (HALF_UP).
 *
 * The `overheadAmount` and `profitAmount` returned are rounded to 2dp for display
 * (computed from the unrounded intermediates so they always reconcile to the rate
 * within 0.01 — the typical accounting tolerance).
 *
 * Labor mode (BR-9): CONSUMPTION (default) or CREW. The zod enum mechanically
 * enforces only one mode is set; default CONSUMPTION when omitted.
 *
 * @throws Error on invalid inputs (non-parseable strings, CREW mode with zero output).
 */
export function computeRate(input: RateAnalysisInput): RateResult {
  const laborMode: RateAnalysisLaborMode = input.laborMode ?? "CONSUMPTION";
  const outputQuantity = new Decimal(input.outputQuantity ?? "1");

  // ── Step 1: compute each line's per-output-unit cost ──────────────────
  const lines: ComputedLine[] = (input.lines ?? []).map((line) => {
    const lineCost = computeLineCost(line, laborMode, outputQuantity);
    return {
      lineType: line.lineType,
      descriptionEn: line.descriptionEn,
      descriptionAr: line.descriptionAr,
      quantity: line.quantity ?? "0",
      unitId: line.unitId,
      unitPrice: line.unitPrice ?? "0",
      wastePct: line.wastePct ?? "0",
      lineCost: formatMoney(lineCost),
    };
  });

  // ── Step 2: BR-9 direct cost = Σ line costs ───────────────────────────
  const directCost = lines.reduce<Decimal>(
    (sum, line) => sum.plus(new Decimal(line.lineCost)),
    new Decimal(0),
  );

  // ── Step 3 & 4: BR-10 compounding (OH then profit, no intermediate rounding) ──
  const ohPct = new Decimal(input.overheadPct ?? "0");
  const profitPct = new Decimal(input.profitPct ?? "0");
  const ohFactor = new Decimal(1).plus(ohPct.dividedBy(100));
  const profitFactor = new Decimal(1).plus(profitPct.dividedBy(100));

  const afterOh = directCost.times(ohFactor);
  const afterProfit = afterOh.times(profitFactor);

  // Overhead/profit amounts computed from UNROUNDED intermediates (so they
  // reconcile to the rate within rounding tolerance).
  const overheadAmount = afterOh.minus(directCost);
  const profitAmount = afterProfit.minus(afterOh);

  // ── Step 5: round the final rate (BR-10) ──────────────────────────────
  const rate = afterProfit.toDecimalPlaces(2);

  return {
    directCost: formatMoney(directCost),
    overheadAmount: formatMoney(overheadAmount),
    profitAmount: formatMoney(profitAmount),
    rate: formatMoney(rate),
    lines,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Decimal as a money string with exactly 2 decimal places (HALF_UP).
 * Trailing zeros preserved: "1067.5" → "1067.50" (no thousand separators —
 * we keep raw number form; UIs may format with separators for display).
 *
 * @internal
 */
function formatMoney(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}
