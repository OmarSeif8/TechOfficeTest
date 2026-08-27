/**
 * Planned Value (PV) domain — distribute activity planned cost across working days.
 *
 * Implements BR-CS2 and BR-CS3 from SPEC_PHASE4_WEB.md §2.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (calendar), decimal.js, and stdlib.
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are the authoritative source of truth — tests/golden/gt-cs-2-planned-value.test.ts):
 *   - BR-CS2: Activity planned cost distributes LINEARLY across its working days
 *             (CPM ES..EF, inclusive). Milestones (dur 0) carry no spread.
 *   - BR-CS3: Daily planned values full-precision internally; period buckets +
 *             cumulative round HALF_UP to 2dp at output.
 *
 * Working-day model:
 *   - The engine consumes the Phase 2 calendar (@domain/scheduling/calendar) to determine
 *     which dates between ES and EF are working days.
 *   - Daily values are emitted ONLY for working days; non-working days contribute nothing.
 *
 * Example (GT-CS-2):
 *   A: ES Jan 5, EF Jan 9 (5 working days), cost 10,000 → 2,000/day on Jan 5, 6, 7, 8, 9.
 *   B: ES Jan 12, EF Jan 16 (5 working days), cost 5,000 → 1,000/day on Jan 12, 13, 14, 15, 16.
 *   PV cum at Jan 7 = 2,000 × 3 = 6,000.00.
 */

import Decimal from "decimal.js";
import type { Calendar } from "@shared/schemas/scheduling/calendar";
import {
  formatIsoDate,
  isWorking,
  parseIsoDate,
} from "@domain/scheduling/calendar";

// ─── decimal.js configuration ─────────────────────────────────────────────
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/**
 * One daily planned-value entry.
 *
 * `value` is stored as the Decimal.toString() representation of the FULL-PRECISION
 * daily value (BR-CS3: "Daily planned values full-precision internally"). When summed
 * into cumulative / period-bucket outputs, the result is rounded to 2dp HALF_UP.
 *
 * For exact divisions (e.g. 10,000 / 5 = 2,000) the value string is just "2000"
 * (no decimal point). For non-exact divisions, the value string carries many digits
 * (up to decimal.js precision = 28). This is intentional — full-precision internal
 * representation prevents drift when summing.
 */
export interface DailyValue {
  /** ISO yyyy-MM-dd (always a working day per the project calendar). */
  date: string;
  activityId: string;
  /** Full-precision Decimal.toString() — round at output (cumulative/buckets). */
  value: string;
}

/**
 * One period bucket — sum of daily planned values within [periodStart, periodEnd].
 */
export interface PeriodBucket {
  periodStart: string; // ISO yyyy-MM-dd
  periodEnd: string;    // ISO yyyy-MM-dd
  /** Sum of daily values in this period, rounded HALF_UP to 2dp (BR-CS3). */
  value: string;
}

/**
 * A period definition used by `computePeriodBuckets`.
 */
export interface PeriodDefinition {
  start: string; // ISO yyyy-MM-dd (inclusive)
  end: string;   // ISO yyyy-MM-dd (inclusive)
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Format a Decimal as a money string with exactly 2 decimal places.
 * @internal
 */
function money(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

/**
 * Enumerate the working-day ISO dates in [esDate, efDate] (inclusive of both),
 * using the project calendar to filter working days.
 *
 * Returns the dates in chronological order.
 *
 * If esDate > efDate, returns an empty array (milestone with no span — BR-CS2).
 *
 * @internal
 */
function workingDaysBetween(
  calendar: Calendar,
  esDate: string,
  efDate: string,
): string[] {
  const startZ = parseIsoDate(esDate);
  const endZ = parseIsoDate(efDate);
  if (endZ < startZ) return [];

  const out: string[] = [];
  for (let z = startZ; z <= endZ; z++) {
    const iso = formatIsoDate(z);
    if (isWorking(calendar, iso)) {
      out.push(iso);
    }
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Distribute each activity's planned cost linearly across its working days (BR-CS2).
 *
 * For each activity in `activityPlannedCost`:
 *   1. Look up ES and EF dates in the provided maps.
 *   2. Walk dates from ES to EF (inclusive); keep the working days.
 *   3. If 0 working days (milestone, dur 0, or holiday-only range) → emit nothing.
 *      Per BR-CS2: milestones carry no spread.
 *   4. Otherwise: daily_value = planned_cost / num_working_days (full precision,
 *      not rounded — BR-CS3).
 *   5. Emit one DailyValue per working day.
 *
 * @param activityPlannedCost  map activityId → planned cost (money string).
 * @param es                   map activityId → ES ISO date (from computeSchedule).
 * @param ef                   map activityId → EF ISO date (from computeSchedule).
 * @param calendar             project calendar (working-day mask + exceptions).
 * @param _projectStart        project start ISO date (reserved — currently unused;
 *                             calendar does its own date math via parseIsoDate).
 * @returns DailyValue[] — one entry per (activity, working day).
 */
export function computeDailyPlannedValue(
  activityPlannedCost: Record<string, string>,
  es: Record<string, string>,
  ef: Record<string, string>,
  calendar: Calendar,
  _projectStart: string,
): DailyValue[] {
  const out: DailyValue[] = [];

  for (const activityId of Object.keys(activityPlannedCost)) {
    const plannedCostStr = activityPlannedCost[activityId];
    const esDate = es[activityId];
    const efDate = ef[activityId];
    if (!esDate || !efDate) continue;

    const days = workingDaysBetween(calendar, esDate, efDate);
    if (days.length === 0) continue; // milestone / no working days

    const plannedCost = new Decimal(plannedCostStr);
    const dailyValue = plannedCost.dividedBy(days.length); // full precision (BR-CS3)

    for (const date of days) {
      out.push({
        date,
        activityId,
        value: dailyValue.toString(),
      });
    }
  }

  return out;
}

/**
 * Cumulative Planned Value at `asOfDate` (BR-CS3 output rounding).
 *
 * Sum of all daily values whose date ≤ asOfDate, rounded HALF_UP to 2dp.
 *
 * Non-working days between the project start and `asOfDate` naturally contribute
 * nothing (no daily values are emitted for them), so PV stays flat across weekends
 * and holidays — exactly the expected S-curve behaviour.
 *
 * If `asOfDate` precedes the first daily value, returns "0.00".
 */
export function computeCumulativePV(dailyValues: DailyValue[], asOfDate: string): string {
  const asOfZ = parseIsoDate(asOfDate);
  let sum = new Decimal(0);
  for (const dv of dailyValues) {
    if (parseIsoDate(dv.date) <= asOfZ) {
      sum = sum.plus(new Decimal(dv.value));
    }
  }
  return money(sum);
}

/**
 * Bucket daily values into periods (BR-CS3 output rounding).
 *
 * For each period [start, end] (both inclusive), sum the daily values whose date
 * falls within. Round HALF_UP to 2dp.
 *
 * Daily values whose date is outside all defined periods are simply not counted
 * in any bucket (they still appear in the source array).
 *
 * @returns one PeriodBucket per input period, in input order.
 */
export function computePeriodBuckets(
  dailyValues: DailyValue[],
  periods: PeriodDefinition[],
): PeriodBucket[] {
  // Pre-compute day-numbers for daily values to avoid re-parsing inside the loop.
  const parsed = dailyValues.map((dv) => ({
    z: parseIsoDate(dv.date),
    value: new Decimal(dv.value),
  }));

  return periods.map((p) => {
    const startZ = parseIsoDate(p.start);
    const endZ = parseIsoDate(p.end);
    let sum = new Decimal(0);
    for (const entry of parsed) {
      if (entry.z >= startZ && entry.z <= endZ) {
        sum = sum.plus(entry.value);
      }
    }
    return {
      periodStart: p.start,
      periodEnd: p.end,
      value: money(sum),
    };
  });
}

// Re-export shared types so consumers can import everything from this module.
export type { Calendar } from "@shared/schemas/scheduling/calendar";
