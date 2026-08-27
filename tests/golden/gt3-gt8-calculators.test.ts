/**
 * GT-3..GT-8 — Calculators Golden Tests
 *
 * From SPEC_PHASE1_BOQ_WEB.md §6:
 *   GT-3: Concrete: column 0.30×0.30×3.00 m, ×12 nos
 *        → 0.27 m³ each → 3.24 m³ total
 *   GT-4: Formwork: same columns, 4 faces × 0.30 × 3.00
 *        → 3.60 m² each → 43.20 m² total
 *   GT-5: Rebar: Ø12, cutting length 11.25 m, 85 bars
 *        → 0.888 × 11.25 × 85 = 849.15 kg = 0.849 ton
 *   GT-6: Masonry: wall 6.00×3.00 m, two 1.2×1.5 m openings, 0.25 m thick
 *        → (18 − 3.60) × 0.25 = 3.60 m³
 *   GT-7: Plaster: wall 20×3 m, one 2×1.5 m door, both faces,
 *        deduct openings >1 m², no jambs
 *        → (60 − 3) × 2 = 114.00 m²
 *   GT-8: Paint: GT-7's wall, 2 coats
 *        → 228.00 m²
 *
 * This test file is the AUTHORITATIVE source of truth. If any test fails, the code
 * is wrong. Per the Constitution: golden tests are law. NEVER edit expected values
 * to make a test pass — if you believe the GT is wrong, STOP and report.
 */

import { describe, it, expect } from "vitest";
import { computeConcrete } from "@domain/calculators/concrete";
import { computeFormwork } from "@domain/calculators/formwork";
import { computeRebar } from "@domain/calculators/rebar";
import { computeMasonry } from "@domain/calculators/masonry";
import { computePlaster } from "@domain/calculators/plaster";
import { computePaint } from "@domain/calculators/paint";

// ─── GT-3: Concrete ───────────────────────────────────────────────────────

describe("GT-3 — Concrete Volume (authoritative)", () => {
  // Column 0.30 × 0.30 × 3.00 m, × 12 nos
  const input = {
    length: "0.30",
    width: "0.30",
    height: "3.00",
    count: "12",
  };

  it("per-item volume = length × width × height = 0.27 m³", () => {
    const result = computeConcrete(input);
    // 0.30 × 0.30 × 3.00 = 0.27
    expect(result.volumePerItem).toBe("0.27");
    expect(result.unit).toBe("m3");
  });

  it("total volume = per-item × count = 3.24 m³", () => {
    const result = computeConcrete(input);
    // 0.27 × 12 = 3.24
    expect(result.totalVolume).toBe("3.24");
  });

  it("GT-3: full authoritative case (all values reproduced exactly)", () => {
    const result = computeConcrete(input);
    expect(result.volumePerItem).toBe("0.27");
    expect(result.totalVolume).toBe("3.24");
    expect(result.unit).toBe("m3");
  });
});

// ─── GT-4: Formwork ───────────────────────────────────────────────────────

describe("GT-4 — Formwork Area (authoritative)", () => {
  // Same columns as GT-3, 4 faces × 0.30 × 3.00
  const input = {
    length: "0.30",
    width: "0.30",
    height: "3.00",
    count: "12",
    faces: "4",
  };

  it("per-item area = faces × width × height = 3.60 m²", () => {
    const result = computeFormwork(input);
    // 4 × 0.30 × 3.00 = 3.60
    expect(result.areaPerItem).toBe("3.60");
    expect(result.unit).toBe("m2");
  });

  it("total area = per-item × count = 43.20 m²", () => {
    const result = computeFormwork(input);
    // 3.60 × 12 = 43.20
    expect(result.totalArea).toBe("43.20");
  });

  it("GT-4: full authoritative case (all values reproduced exactly)", () => {
    const result = computeFormwork(input);
    expect(result.areaPerItem).toBe("3.60");
    expect(result.totalArea).toBe("43.20");
    expect(result.unit).toBe("m2");
  });
});

// ─── GT-5: Rebar ─────────────────────────────────────────────────────────

describe("GT-5 — Rebar Weight (authoritative)", () => {
  // Ø12, cutting length 11.25 m, 85 bars
  const input = {
    diameterMm: 12,
    cuttingLength: "11.25",
    count: 85,
  };

  it("BR-11: Ø12 unit weight = 0.888 kg/m (from REBAR_WEIGHTS_KG_PER_M table)", () => {
    // Implicit: if the table is wrong, the weight calculation below will fail.
    // Tested explicitly in src/shared/rebar-weights.ts (lookup function).
    // Here we verify the downstream effect.
    const result = computeRebar(input);
    // 11.25 × 85 = 956.25 ; 956.25 × 0.888 = 849.15
    expect(result.totalLength).toBe("956.25");
    expect(result.totalWeightKg).toBe("849.15");
    expect(result.unit).toBe("kg");
  });

  it("BR-12: total weight = cuttingLength × count × unitWeight = 849.15 kg", () => {
    const result = computeRebar(input);
    expect(result.totalWeightKg).toBe("849.15");
  });

  it("BR-6: tonnage = kg / 1000, 3dp = 0.849 ton", () => {
    const result = computeRebar(input);
    // 849.15 / 1000 = 0.84915 → 3dp HALF_UP = 0.849
    expect(result.totalWeightTon).toBe("0.849");
  });

  it("GT-5: full authoritative case (all values reproduced exactly)", () => {
    const result = computeRebar(input);
    expect(result.totalLength).toBe("956.25");
    expect(result.totalWeightKg).toBe("849.15");
    expect(result.totalWeightTon).toBe("0.849");
    expect(result.unit).toBe("kg");
  });
});

// ─── GT-6: Masonry ────────────────────────────────────────────────────────

describe("GT-6 — Masonry Volume (authoritative)", () => {
  // Wall 6.00 × 3.00 m, two 1.2 × 1.5 m openings, 0.25 m thick
  const input = {
    wallLength: "6.00",
    wallHeight: "3.00",
    wallThickness: "0.25",
    openings: [
      { width: "1.2", height: "1.5" },
      { width: "1.2", height: "1.5" },
    ],
  };

  it("gross area = wallLength × wallHeight = 18.00 m²", () => {
    const result = computeMasonry(input);
    // 6.00 × 3.00 = 18.00
    expect(result.grossArea).toBe("18.00");
    expect(result.unit).toBe("m3");
  });

  it("openings area = 2 × (1.2 × 1.5) = 3.60 m²", () => {
    const result = computeMasonry(input);
    // 2 × (1.2 × 1.5) = 2 × 1.80 = 3.60
    expect(result.openingsArea).toBe("3.60");
  });

  it("net area = gross − openings = 14.40 m²", () => {
    const result = computeMasonry(input);
    // 18.00 − 3.60 = 14.40
    expect(result.netArea).toBe("14.40");
  });

  it("volume = netArea × thickness = 3.60 m³", () => {
    const result = computeMasonry(input);
    // 14.40 × 0.25 = 3.60
    expect(result.volume).toBe("3.60");
  });

  it("GT-6: full authoritative case (all values reproduced exactly)", () => {
    const result = computeMasonry(input);
    expect(result.grossArea).toBe("18.00");
    expect(result.openingsArea).toBe("3.60");
    expect(result.netArea).toBe("14.40");
    expect(result.volume).toBe("3.60");
    expect(result.unit).toBe("m3");
  });
});

// ─── GT-7: Plaster ────────────────────────────────────────────────────────

describe("GT-7 — Plaster Area (authoritative)", () => {
  // Wall 20 × 3 m, one 2 × 1.5 m door, both faces, deduct openings > 1 m²
  const input = {
    wallLength: "20",
    wallHeight: "3",
    faces: "2",
    openings: [{ width: "2", height: "1.5" }],
    deductThreshold: "1",
  };

  it("gross area per face = wallLength × wallHeight = 60.00 m²", () => {
    const result = computePlaster(input);
    // 20 × 3 = 60.00
    expect(result.grossArea).toBe("60.00");
    expect(result.unit).toBe("m2");
  });

  it("deductions per face = 2 × 1.5 = 3.00 m² (door > 1 m² threshold → deducted)", () => {
    const result = computePlaster(input);
    // Door area = 2 × 1.5 = 3.00 > 1.00 threshold → deducted
    expect(result.deductionsArea).toBe("3.00");
  });

  it("net area (both faces) = (60 − 3) × 2 = 114.00 m²", () => {
    const result = computePlaster(input);
    // (60 − 3) × 2 = 57 × 2 = 114.00
    expect(result.netArea).toBe("114.00");
  });

  it("GT-7: full authoritative case (all values reproduced exactly)", () => {
    const result = computePlaster(input);
    expect(result.grossArea).toBe("60.00");
    expect(result.deductionsArea).toBe("3.00");
    expect(result.netArea).toBe("114.00");
    expect(result.unit).toBe("m2");
  });
});

// ─── GT-8: Paint ──────────────────────────────────────────────────────────

describe("GT-8 — Paint Area (authoritative)", () => {
  // GT-7's wall (114 m²) × 2 coats
  const input = {
    surfaceArea: "114",
    coats: 2,
  };

  it("area = surfaceArea = 114.00 m² (echoed, formatted)", () => {
    const result = computePaint(input);
    expect(result.area).toBe("114.00");
    expect(result.coats).toBe(2);
    expect(result.unit).toBe("m2");
  });

  it("totalCoatArea = area × coats = 228.00 m²", () => {
    const result = computePaint(input);
    // 114 × 2 = 228.00
    expect(result.totalCoatArea).toBe("228.00");
  });

  it("GT-8: full authoritative case (all values reproduced exactly)", () => {
    const result = computePaint(input);
    expect(result.area).toBe("114.00");
    expect(result.coats).toBe(2);
    expect(result.totalCoatArea).toBe("228.00");
    expect(result.unit).toBe("m2");
  });
});

// ─── BR-11: Rebar weight table (golden-adjacent) ─────────────────────────

describe("BR-11 — Rebar weight table (golden-adjacent)", () => {
  it("Ø8 → 0.395 kg/m, Ø16 → 1.58 kg/m, Ø20 → 2.47 kg/m, Ø25 → 3.85 kg/m, Ø32 → 6.31 kg/m", () => {
    // Spot-check a few rows of the table by computing weight with a 1m × 1 bar
    // configuration — the result.totalWeightKg should equal the unit weight.
    const d8 = computeRebar({ diameterMm: 8, cuttingLength: "1", count: 1 });
    expect(d8.totalWeightKg).toBe("0.40"); // 0.395 → 2dp = 0.40 (HALF_UP)

    const d16 = computeRebar({ diameterMm: 16, cuttingLength: "1", count: 1 });
    expect(d16.totalWeightKg).toBe("1.58");

    const d20 = computeRebar({ diameterMm: 20, cuttingLength: "1", count: 1 });
    expect(d20.totalWeightKg).toBe("2.47");

    const d25 = computeRebar({ diameterMm: 25, cuttingLength: "1", count: 1 });
    expect(d25.totalWeightKg).toBe("3.85");

    const d32 = computeRebar({ diameterMm: 32, cuttingLength: "1", count: 1 });
    expect(d32.totalWeightKg).toBe("6.31");
  });

  it("unknown diameter throws", () => {
    expect(() =>
      computeRebar({ diameterMm: 7, cuttingLength: "1", count: 1 }),
    ).toThrow(/Unknown rebar diameter/);
  });
});

// ─── Edge cases (golden-adjacent) ─────────────────────────────────────────

describe("Calculator edge cases (golden-adjacent)", () => {
  it("concrete: count default 1 → total = per-item", () => {
    const result = computeConcrete({
      length: "1",
      width: "1",
      height: "1",
      count: "1",
    });
    expect(result.volumePerItem).toBe("1.00");
    expect(result.totalVolume).toBe("1.00");
  });

  it("formwork: faces default 4 → standard column", () => {
    const result = computeFormwork({
      length: "0.30",
      width: "0.30",
      height: "3.00",
      count: "1",
      faces: "4",
    });
    // 4 × 0.30 × 3.00 = 3.60
    expect(result.areaPerItem).toBe("3.60");
    expect(result.totalArea).toBe("3.60");
  });

  it("masonry: no openings → volume = gross × thickness", () => {
    const result = computeMasonry({
      wallLength: "10",
      wallHeight: "3",
      wallThickness: "0.20",
      openings: [],
    });
    // 10 × 3 × 0.20 = 6.00 m³
    expect(result.grossArea).toBe("30.00");
    expect(result.openingsArea).toBe("0.00");
    expect(result.netArea).toBe("30.00");
    expect(result.volume).toBe("6.00");
  });

  it("plaster: small opening (< threshold) is NOT deducted", () => {
    const result = computePlaster({
      wallLength: "10",
      wallHeight: "3",
      faces: "2",
      openings: [{ width: "0.5", height: "0.5" }], // 0.25 m² — below 1 m² threshold
      deductThreshold: "1",
    });
    // gross = 30 ; deductions = 0 (opening too small) ; net = (30 − 0) × 2 = 60.00
    expect(result.grossArea).toBe("30.00");
    expect(result.deductionsArea).toBe("0.00");
    expect(result.netArea).toBe("60.00");
  });

  it("plaster: opening exactly at threshold (1 m²) is NOT deducted (strict >)", () => {
    const result = computePlaster({
      wallLength: "10",
      wallHeight: "3",
      faces: "1",
      openings: [{ width: "1", height: "1" }], // exactly 1 m² — not strictly greater
      deductThreshold: "1",
    });
    // gross = 30 ; deductions = 0 (1 is NOT > 1) ; net = 30 × 1 = 30.00
    expect(result.grossArea).toBe("30.00");
    expect(result.deductionsArea).toBe("0.00");
    expect(result.netArea).toBe("30.00");
  });

  it("plaster: opening 1.01 m² IS deducted (strict >)", () => {
    const result = computePlaster({
      wallLength: "10",
      wallHeight: "3",
      faces: "1",
      openings: [{ width: "1", height: "1.01" }], // 1.01 m² — strictly greater than 1
      deductThreshold: "1",
    });
    // gross = 30 ; deductions = 1.01 ; net = (30 − 1.01) × 1 = 28.99
    expect(result.grossArea).toBe("30.00");
    expect(result.deductionsArea).toBe("1.01");
    expect(result.netArea).toBe("28.99");
  });

  it("paint: 3 coats on 100 m² = 300.00 m²", () => {
    const result = computePaint({
      surfaceArea: "100",
      coats: 3,
    });
    expect(result.area).toBe("100.00");
    expect(result.coats).toBe(3);
    expect(result.totalCoatArea).toBe("300.00");
  });
});
