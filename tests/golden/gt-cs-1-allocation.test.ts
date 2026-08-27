/**
 * GT-CS-1 — Cost loading allocation (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE4_WEB.md §4:
 *   BoQ item 38,572.40, linked 60% to X, 40% to Y
 *     → X = 23,143.44, Y = 15,428.96, Σ = 38,572.40
 *   60/50 split (sum 110%) → validation error (≠100%)
 *
 * Verifies BR-CS1 (allocations sum to exactly 100%, decimal-exact) and the
 * round-then-sum distribution (BR-2 pattern, HALF_UP).
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import {
  validateAllocations,
  computeActivityPlannedCost,
  computeCoverage,
} from "@domain/payments/cost-loading";
import type { AllocationInput, BoqItemAmount } from "@shared/schemas/payments/cost-loading";
import Decimal from "decimal.js";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

describe("GT-CS-1 — Cost loading allocation (authoritative)", () => {
  const boqItems: BoqItemAmount[] = [
    { id: "I1", amount: "38572.40" },
  ];

  describe("BR-CS1 — 60/40 split sums to exactly 100%", () => {
    const allocations: AllocationInput[] = [
      { boqItemId: "I1", activityId: "X", allocationPct: "60" },
      { boqItemId: "I1", activityId: "Y", allocationPct: "40" },
    ];

    it("validateAllocations returns no errors", () => {
      const errors = validateAllocations(allocations);
      expect(errors).toEqual([]);
    });

    it("computeActivityPlannedCost — X = round(38,572.40 × 60 / 100, 2) = 23,143.44", () => {
      const result = computeActivityPlannedCost(allocations, boqItems);
      expect(result["X"]).toBe("23143.44");
    });

    it("computeActivityPlannedCost — Y = round(38,572.40 × 40 / 100, 2) = 15,428.96", () => {
      const result = computeActivityPlannedCost(allocations, boqItems);
      expect(result["Y"]).toBe("15428.96");
    });

    it("Σ X + Y = 38,572.40 (no drift — round-then-sum)", () => {
      const result = computeActivityPlannedCost(allocations, boqItems);
      const sum = new Decimal(result["X"]).plus(new Decimal(result["Y"]));
      expect(sum.toFixed(2)).toBe("38572.40");
    });
  });

  describe("BR-CS1 — 60/50 split (sum 110%) fails validation", () => {
    const badAllocations: AllocationInput[] = [
      { boqItemId: "I1", activityId: "X", allocationPct: "60" },
      { boqItemId: "I1", activityId: "Y", allocationPct: "50" },
    ];

    it("validateAllocations returns ≥1 error", () => {
      const errors = validateAllocations(badAllocations);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("validateAllocations error message mentions BoQ item I1 and 110%", () => {
      const errors = validateAllocations(badAllocations);
      expect(errors.join(" ")).toContain("I1");
      expect(errors.join(" ")).toContain("110");
    });
  });

  describe("BR-CS1 — decimal-exact (12.5 + 87.5 = 100 exactly, no float drift)", () => {
    const allocations: AllocationInput[] = [
      { boqItemId: "I1", activityId: "X", allocationPct: "12.5" },
      { boqItemId: "I1", activityId: "Y", allocationPct: "87.5" },
    ];

    it("validateAllocations returns no errors (decimal-exact equality)", () => {
      const errors = validateAllocations(allocations);
      expect(errors).toEqual([]);
    });

    it("computeActivityPlannedCost distributes correctly", () => {
      const result = computeActivityPlannedCost(allocations, boqItems);
      // X = round(38,572.40 × 12.5 / 100, 2) = round(4,821.55, 2) = 4,821.55
      expect(result["X"]).toBe("4821.55");
      // Y = round(38,572.40 × 87.5 / 100, 2) = round(33,750.85, 2) = 33,750.85
      expect(result["Y"]).toBe("33750.85");
      // Σ = 38,572.40 (no drift)
      const sum = new Decimal(result["X"]).plus(new Decimal(result["Y"]));
      expect(sum.toFixed(2)).toBe("38572.40");
    });
  });

  describe("BR-CS1 — unlinked BoQ item (no allocations) is NOT a validation error", () => {
    const allocations: AllocationInput[] = [
      { boqItemId: "I1", activityId: "X", allocationPct: "100" },
    ];
    const twoBoqItems: BoqItemAmount[] = [
      { id: "I1", amount: "38572.40" },
      { id: "I2", amount: "10000.00" }, // unlinked — no allocations
    ];

    it("validateAllocations returns no errors (I2 is unlinked but that's a warning, not error)", () => {
      const errors = validateAllocations(allocations);
      expect(errors).toEqual([]);
    });
  });

  describe("BR-CS4 — coverage = linked / total × 100", () => {
    it("100% coverage when all linked", () => {
      expect(computeCoverage("38572.40", "38572.40")).toBe("100.00");
    });

    it("50% coverage when half linked", () => {
      expect(computeCoverage("5000.00", "10000.00")).toBe("50.00");
    });

    it("0% coverage when nothing linked", () => {
      expect(computeCoverage("0.00", "10000.00")).toBe("0.00");
    });

    it("0.00 coverage when total is zero (defensive)", () => {
      expect(computeCoverage("0.00", "0.00")).toBe("0.00");
    });

    it("66.67% coverage on non-round ratio", () => {
      // 10,000 / 15,000 = 0.66666... → 66.67%
      expect(computeCoverage("10000.00", "15000.00")).toBe("66.67");
    });
  });
});
