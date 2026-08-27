/**
 * GT-EV-1 — Earned Value + SPI + progress % (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE4_WEB.md §4:
 *   Same network as GT-CS-2, BAC = 15,000.
 *   Data date = end of Jan 9.
 *   A: 100% complete, B: 20% complete.
 *
 *   Expected:
 *     EV = 10,000 + 1,000 = 11,000
 *     PV(DD) = 10,000
 *     SPI = 1.10
 *     Planned progress = 66.67%
 *     Actual progress = 73.33%
 *
 * Verifies BR-CS5 (EV = % × planned cost) and BR-CS6 (SPI = EV/PV; progress %).
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeDailyPlannedValue,
  computeCumulativePV,
} from "@domain/payments/planned-value";
import {
  computeEarnedValue,
  computeSPI,
  computeProgressPercent,
} from "@domain/payments/earned-value";
import type { ActivityProgress } from "@domain/payments/earned-value";
import type { Calendar } from "@shared/schemas/scheduling/calendar";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

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

describe("GT-EV-1 — Earned Value + SPI + progress (authoritative)", () => {
  // Same network as GT-CS-2.
  const activityPlannedCost: Record<string, string> = {
    A: "10000",
    B: "5000",
  };
  const es: Record<string, string> = {
    A: "2026-01-05",
    B: "2026-01-12",
  };
  const ef: Record<string, string> = {
    A: "2026-01-09",
    B: "2026-01-16",
  };
  const projectStart = "2026-01-05";

  const dailyValues = computeDailyPlannedValue(
    activityPlannedCost,
    es,
    ef,
    monFri,
    projectStart,
  );

  const bac = "15000";
  const dataDate = "2026-01-09"; // end of Jan 9 — A complete, B in progress.

  // At the data date:
  //   A is 100% complete (executed all 5 working days).
  //   B is 20% complete (1 of 5 working days executed, despite B's ES being Jan 12 —
  //                       the engineer has declared 20% physical progress early).
  const activityProgress: ActivityProgress[] = [
    { activityId: "A", percentComplete: "100", plannedCost: "10000" },
    { activityId: "B", percentComplete: "20", plannedCost: "5000" },
  ];

  // ─── Earned Value (BR-CS5) ───────────────────────────────────────────

  describe("BR-CS5 — Earned Value", () => {
    const evResult = computeEarnedValue(activityProgress, dataDate, dailyValues);

    it("per-activity EV: A = round(10000 × 100 / 100, 2) = 10,000.00", () => {
      const a = evResult.byActivity.find((e) => e.activityId === "A")!;
      expect(a.earnedValue).toBe("10000.00");
    });

    it("per-activity EV: B = round(5000 × 20 / 100, 2) = 1,000.00", () => {
      const b = evResult.byActivity.find((e) => e.activityId === "B")!;
      expect(b.earnedValue).toBe("1000.00");
    });

    it("total EV = 10,000 + 1,000 = 11,000.00 (sum of rounded per-activity values)", () => {
      expect(evResult.earnedValue).toBe("11000.00");
    });
  });

  // ─── PV at data date (BR-CS3 output) ────────────────────────────────

  describe("PV at data date", () => {
    it("PV(DD=Jan 9) = 10,000.00 (A's full planned value)", () => {
      const pvDD = computeCumulativePV(dailyValues, dataDate);
      expect(pvDD).toBe("10000.00");
    });
  });

  // ─── SPI (BR-CS6) ────────────────────────────────────────────────────

  describe("BR-CS6 — SPI", () => {
    it("SPI = EV / PV = 11,000 / 10,000 = 1.10 (2dp)", () => {
      const ev = "11000.00";
      const pv = "10000.00";
      expect(computeSPI(ev, pv)).toBe("1.10");
    });

    it("SPI = 1.00 when EV = PV (on-schedule)", () => {
      expect(computeSPI("10000.00", "10000.00")).toBe("1.00");
    });

    it("SPI = 0.50 when EV is half of PV (behind schedule)", () => {
      expect(computeSPI("5000.00", "10000.00")).toBe("0.50");
    });

    it("SPI = 0.00 when PV is zero (defensive — no planned work yet)", () => {
      expect(computeSPI("0.00", "0.00")).toBe("0.00");
    });
  });

  // ─── Project progress % (BR-CS6) ─────────────────────────────────────

  describe("BR-CS6 — Project progress %", () => {
    it("planned progress = PV / BAC × 100 = 10,000 / 15,000 × 100 = 66.67%", () => {
      const result = computeProgressPercent("11000.00", "10000.00", bac);
      expect(result.planned).toBe("66.67");
    });

    it("actual progress = EV / BAC × 100 = 11,000 / 15,000 × 100 = 73.33%", () => {
      const result = computeProgressPercent("11000.00", "10000.00", bac);
      expect(result.actual).toBe("73.33");
    });

    it("both progress values together (planned < actual → ahead of schedule)", () => {
      const result = computeProgressPercent("11000.00", "10000.00", bac);
      expect(result.planned).toBe("66.67");
      expect(result.actual).toBe("73.33");
      // 73.33 > 66.67 → ahead of schedule (consistent with SPI > 1).
      expect(new Decimal(result.actual).gt(new Decimal(result.planned))).toBe(true);
    });

    it("returns 0.00 / 0.00 when BAC is zero (defensive)", () => {
      const result = computeProgressPercent("1000.00", "500.00", "0");
      expect(result.planned).toBe("0.00");
      expect(result.actual).toBe("0.00");
    });
  });

  // ─── End-to-end (GT-EV-1 in one block) ───────────────────────────────

  describe("end-to-end GT-EV-1", () => {
    const evResult = computeEarnedValue(activityProgress, dataDate, dailyValues);
    const pvDD = computeCumulativePV(dailyValues, dataDate);
    const spi = computeSPI(evResult.earnedValue, pvDD);
    const progress = computeProgressPercent(evResult.earnedValue, pvDD, bac);

    it("EV = 11,000.00", () => {
      expect(evResult.earnedValue).toBe("11000.00");
    });

    it("PV(DD) = 10,000.00", () => {
      expect(pvDD).toBe("10000.00");
    });

    it("SPI = 1.10", () => {
      expect(spi).toBe("1.10");
    });

    it("Planned progress = 66.67%", () => {
      expect(progress.planned).toBe("66.67");
    });

    it("Actual progress = 73.33%", () => {
      expect(progress.actual).toBe("73.33");
    });
  });
});
