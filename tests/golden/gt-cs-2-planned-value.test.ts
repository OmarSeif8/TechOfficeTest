/**
 * GT-CS-2 — Planned Value distribution (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE4_WEB.md §4:
 *   Network: A(d5) → B(d5), FS lag 0, calendar Mon-Fri, projectStart 2026-01-05.
 *     A: ES Jan 5,  EF Jan 9   (5 working days, cost 10,000 → 2,000/day)
 *     B: ES Jan 12, EF Jan 16  (5 working days, cost 5,000 → 1,000/day)
 *
 *   PV cum at Jan 7 = 6,000  (3 days × 2,000)
 *   PV cum at Jan 9 = 10,000 (A done)
 *   PV cum at Jan 14 = 13,000 (A done + 3 days of B)
 *   PV cum at Jan 16 = 15,000 (A + B done = BAC)
 *
 *   Period buckets: P1 (Jan 5-9) = 10,000, P2 (Jan 12-16) = 5,000
 *
 * Verifies BR-CS2 (linear distribution across working days) and BR-CS3
 * (full-precision internal, 2dp at output for cumulative / buckets).
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeDailyPlannedValue,
  computeCumulativePV,
  computePeriodBuckets,
} from "@domain/payments/planned-value";
import type { Calendar } from "@shared/schemas/scheduling/calendar";

const monFri: Calendar = {
  mask: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  },
  exceptions: [],
};

describe("GT-CS-2 — Planned Value distribution (authoritative)", () => {
  const activityPlannedCost: Record<string, string> = {
    A: "10000",
    B: "5000",
  };
  // Pre-computed from CPM (or hand-derived from the calendar — see test header).
  const es: Record<string, string> = {
    A: "2026-01-05", // Mon
    B: "2026-01-12", // Mon (FS after A → ES = A.EF + 1 working day = Jan 12)
  };
  const ef: Record<string, string> = {
    A: "2026-01-09",  // Fri (5 working days: Jan 5,6,7,8,9)
    B: "2026-01-16",  // Fri (5 working days: Jan 12,13,14,15,16)
  };
  const projectStart = "2026-01-05";

  const dailyValues = computeDailyPlannedValue(
    activityPlannedCost,
    es,
    ef,
    monFri,
    projectStart,
  );

  it("emits 10 daily values (5 per activity, 2 activities)", () => {
    expect(dailyValues.length).toBe(10);
  });

  it("activity A has 5 daily values, each = 2,000 (full precision)", () => {
    const aValues = dailyValues.filter((dv) => dv.activityId === "A");
    expect(aValues.length).toBe(5);
    const dates = aValues.map((dv) => dv.date);
    expect(dates).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
    ]);
    for (const dv of aValues) {
      // 10,000 / 5 = 2,000 (exact)
      expect(new Decimal(dv.value).toDecimalPlaces(2).toFixed(2)).toBe("2000.00");
    }
  });

  it("activity B has 5 daily values, each = 1,000 (full precision)", () => {
    const bValues = dailyValues.filter((dv) => dv.activityId === "B");
    expect(bValues.length).toBe(5);
    const dates = bValues.map((dv) => dv.date);
    expect(dates).toEqual([
      "2026-01-12",
      "2026-01-13",
      "2026-01-14",
      "2026-01-15",
      "2026-01-16",
    ]);
    for (const dv of bValues) {
      expect(new Decimal(dv.value).toDecimalPlaces(2).toFixed(2)).toBe("1000.00");
    }
  });

  it("weekend (Jan 10, 11) emits NO daily values (working-day-only)", () => {
    const weekendValues = dailyValues.filter((dv) =>
      dv.date === "2026-01-10" || dv.date === "2026-01-11",
    );
    expect(weekendValues.length).toBe(0);
  });

  // ─── Cumulative PV (BR-CS3 output rounding) ─────────────────────────

  it("PV cum at Jan 7 = 6,000.00 (3 days × 2,000)", () => {
    expect(computeCumulativePV(dailyValues, "2026-01-07")).toBe("6000.00");
  });

  it("PV cum at Jan 9 = 10,000.00 (A complete)", () => {
    expect(computeCumulativePV(dailyValues, "2026-01-09")).toBe("10000.00");
  });

  it("PV cum at Jan 10 (Sat) = 10,000.00 (no work on weekends — PV flat)", () => {
    expect(computeCumulativePV(dailyValues, "2026-01-10")).toBe("10000.00");
  });

  it("PV cum at Jan 11 (Sun) = 10,000.00 (still flat)", () => {
    expect(computeCumulativePV(dailyValues, "2026-01-11")).toBe("10000.00");
  });

  it("PV cum at Jan 12 (B starts) = 11,000.00", () => {
    expect(computeCumulativePV(dailyValues, "2026-01-12")).toBe("11000.00");
  });

  it("PV cum at Jan 14 = 13,000.00 (A done + 3 days of B)", () => {
    expect(computeCumulativePV(dailyValues, "2026-01-14")).toBe("13000.00");
  });

  it("PV cum at Jan 16 = 15,000.00 (B complete → BAC reached)", () => {
    expect(computeCumulativePV(dailyValues, "2026-01-16")).toBe("15000.00");
  });

  it("PV cum BEFORE project start = 0.00", () => {
    expect(computeCumulativePV(dailyValues, "2026-01-04")).toBe("0.00");
  });

  // ─── Period buckets (BR-CS3 output rounding) ────────────────────────

  it("Period P1 (Jan 5-9) = 10,000.00", () => {
    const buckets = computePeriodBuckets(dailyValues, [
      { start: "2026-01-05", end: "2026-01-09" },
    ]);
    expect(buckets[0].value).toBe("10000.00");
  });

  it("Period P2 (Jan 12-16) = 5,000.00", () => {
    const buckets = computePeriodBuckets(dailyValues, [
      { start: "2026-01-12", end: "2026-01-16" },
    ]);
    expect(buckets[0].value).toBe("5000.00");
  });

  it("Two periods together = 15,000.00 (BAC reached)", () => {
    const buckets = computePeriodBuckets(dailyValues, [
      { start: "2026-01-05", end: "2026-01-09" },
      { start: "2026-01-12", end: "2026-01-16" },
    ]);
    expect(buckets[0].value).toBe("10000.00");
    expect(buckets[1].value).toBe("5000.00");
    const total = new Decimal(buckets[0].value).plus(new Decimal(buckets[1].value));
    expect(total.toFixed(2)).toBe("15000.00");
  });

  it("Period spanning weekend (Jan 7-13) = 6,000 + 2,000 = 8,000.00 (skips weekend)", () => {
    const buckets = computePeriodBuckets(dailyValues, [
      { start: "2026-01-07", end: "2026-01-13" },
    ]);
    // Jan 7 (2,000) + Jan 8 (2,000) + Jan 9 (2,000) + Jan 12 (1,000) + Jan 13 (1,000) = 8,000
    expect(buckets[0].value).toBe("8000.00");
  });
});
