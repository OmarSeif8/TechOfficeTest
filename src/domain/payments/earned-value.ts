/**
 * Earned Value (EV) domain — EV, SPI, project progress %.
 *
 * Implements BR-CS5 and BR-CS6 from SPEC_PHASE4_WEB.md §2.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* and decimal.js.
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are the authoritative source of truth — tests/golden/gt-ev-1-earned-value.test.ts):
 *   - BR-CS5: Progress: at a data date, activity % complete × planned cost = earned value.
 *             EV sums per period identically to PV.
 *   - BR-CS6: Project progress %: planned = PV(data date) / BAC; actual = EV / BAC
 *             (BAC = total linked value). SPI = EV ÷ PV at data date, 2dp.
 *
 * Per-activity EV is rounded HALF_UP to 2dp BEFORE summing into the total EV
 * (mirrors the cumulative method's "round-then-sum" pattern from BR-IP2 — prevents
 * drift between displayed per-activity values and the project total).
 */

import Decimal from "decimal.js";
import type { DailyValue } from "@domain/payments/planned-value";

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

/**
 * One activity's progress at the data date.
 *
 *   - `percentComplete`: 0..100 (string; e.g. "100", "20", "12.5").
 *   - `plannedCost`:    the activity's planned cost (money string, from
 *                       computeActivityPlannedCost).
 */
export interface ActivityProgress {
  activityId: string;
  percentComplete: string;
  plannedCost: string;
}

/**
 * Per-activity earned value.
 */
export interface ActivityEarnedValue {
  activityId: string;
  /** EV_activity = round(plannedCost × percentComplete / 100, 2). */
  earnedValue: string;
}

/**
 * Earned value computation result.
 */
export interface EarnedValueResult {
  /** Total EV = Σ activity EV (sum of rounded per-activity values). */
  earnedValue: string;
  /** Per-activity breakdown for UI display. */
  byActivity: ActivityEarnedValue[];
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compute earned value at a data date (BR-CS5).
 *
 * For each activity:
 *   EV_activity = round(plannedCost × percentComplete / 100, 2)
 *
 * Total EV = Σ EV_activity (sum of ROUNDED per-activity values, per the
 * cumulative-method pattern that prevents drift).
 *
 * @param activityProgress  per-activity progress (id + % + planned cost).
 * @param _asOfDate          ISO yyyy-MM-dd data date. Currently informational —
 *                           EV math doesn't depend on the date directly (the
 *                           caller is expected to filter progress to activities
 *                           in-flight at the data date upstream). Kept for API
 *                           symmetry with PV.
 * @param _dailyValues       PV daily values. Currently informational — the SPI
 *                           computation consumes PV as a scalar string from the
 *                           caller (who runs `computeCumulativePV` upstream).
 *                           Kept for API symmetry with the spec signature.
 * @returns EarnedValueResult.
 */
export function computeEarnedValue(
  activityProgress: ActivityProgress[],
  _asOfDate: string,
  _dailyValues: DailyValue[],
): EarnedValueResult {
  const byActivity: ActivityEarnedValue[] = [];
  let total = new Decimal(0);

  for (const ap of activityProgress) {
    const plannedCost = new Decimal(ap.plannedCost);
    const pct = new Decimal(ap.percentComplete).dividedBy(ONE_HUNDRED);
    const ev = plannedCost.times(pct).toDecimalPlaces(2); // BR-CS5 + BR-IP1 rounding
    byActivity.push({
      activityId: ap.activityId,
      earnedValue: money(ev),
    });
    total = total.plus(ev);
  }

  return {
    earnedValue: money(total),
    byActivity,
  };
}

/**
 * Schedule Performance Index — SPI = EV ÷ PV at data date, 2dp (BR-CS6).
 *
 * If PV is zero, returns "0.00" (no planned work yet — SPI undefined; we
 * return zero rather than throwing, so dashboards degrade gracefully).
 */
export function computeSPI(ev: string, pv: string): string {
  const pvDec = new Decimal(pv);
  if (pvDec.isZero()) return "0.00";
  const ratio = new Decimal(ev).dividedBy(pvDec);
  return ratio.toDecimalPlaces(2).toFixed(2);
}

/**
 * Project progress percentages (BR-CS6).
 *
 *   - planned = PV / BAC × 100     [what SHOULD have been done by the data date]
 *   - actual  = EV / BAC × 100     [what HAS been done by the data date]
 *
 * Both returned as 0..100 strings with 2dp.
 *
 * If BAC is zero, returns "0.00" for both — dashboard degrades gracefully.
 *
 * @returns `{ planned, actual }` — each a percentage string (e.g. "66.67", "73.33").
 */
export function computeProgressPercent(
  ev: string,
  pv: string,
  bac: string,
): { planned: string; actual: string } {
  const bacDec = new Decimal(bac);
  if (bacDec.isZero()) return { planned: "0.00", actual: "0.00" };
  const planned = new Decimal(pv)
    .dividedBy(bacDec)
    .times(ONE_HUNDRED)
    .toDecimalPlaces(2)
    .toFixed(2);
  const actual = new Decimal(ev)
    .dividedBy(bacDec)
    .times(ONE_HUNDRED)
    .toDecimalPlaces(2)
    .toFixed(2);
  return { planned, actual };
}

// Re-export shared types so consumers can import everything from this module.
export type { DailyValue } from "@domain/payments/planned-value";
