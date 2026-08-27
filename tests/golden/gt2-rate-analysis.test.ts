/**
 * GT-2 — Rate Analysis Golden Test
 *
 * From SPEC_PHASE1_BOQ_WEB.md §6:
 *   Rate analysis (per 1 m³):
 *     Materials (Σ 602.30):
 *       - cement 0.35 t @ 1,000 → 350.00 (consumption 0.35, no waste)
 *       - sand   0.45 m³ @ 150 → 67.50
 *       - agg    0.85 m³ @ 180 → 153.00
 *       - water  0.18 @ 10     → 1.80 (consumption 0.18, rate 10 → 1.80)
 *       - admix  1 @ 30        → 30.00 (lump, 30.00)
 *     Labor crew 4,000/day ÷ 40 m³/day = 100.00 (CREW mode)
 *     Equipment 60.00
 *     OH 10%, profit 15%
 *
 *   Expected:
 *     Direct 762.30 → +OH (×1.10) → 838.53 → +Profit (×1.15) → 964.31
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 * Per the Constitution: golden tests are law. NEVER edit expected values to make
 * a test pass — if you believe the GT is wrong, STOP and report.
 */

import { describe, it, expect } from "vitest";
import { computeRate } from "@domain/estimating/rate-analysis";

describe("GT-2 — Rate Analysis (authoritative)", () => {
  // The authoritative GT-2 input — per the spec, this is "per 1 m³" (outputQuantity="1"),
  // with labor computed in CREW mode (crew cost 4,000/day ÷ 40 m³/day = 100 per m³).
  const input = {
    laborMode: "CREW" as const,
    outputQuantity: "40", // 40 m³/day crew output
    overheadPct: "10",
    profitPct: "15",
    lines: [
      // Materials — BR-8: consumption × (1 + waste%) × unit cost
      {
        lineType: "MATERIAL" as const,
        descriptionEn: "Cement",
        quantity: "0.35", // t per m³ of concrete
        unitPrice: "1000",
        wastePct: "0",
      },
      {
        lineType: "MATERIAL" as const,
        descriptionEn: "Sand",
        quantity: "0.45", // m³ per m³ of concrete
        unitPrice: "150",
        wastePct: "0",
      },
      {
        lineType: "MATERIAL" as const,
        descriptionEn: "Aggregate",
        quantity: "0.85", // m³ per m³ of concrete
        unitPrice: "180",
        wastePct: "0",
      },
      {
        lineType: "MATERIAL" as const,
        descriptionEn: "Water",
        quantity: "0.18", // m³ per m³ of concrete
        unitPrice: "10",
        wastePct: "0",
      },
      {
        lineType: "MATERIAL" as const,
        descriptionEn: "Admixture (lump)",
        quantity: "1", // lump
        unitPrice: "30",
        wastePct: "0",
      },
      // Labor — CREW mode: unitPrice = crew cost per day (4,000) ÷ outputQuantity (40) = 100.00
      {
        lineType: "LABOR" as const,
        descriptionEn: "Crew (per day)",
        quantity: "1", // 1 crew-day
        unitPrice: "4000", // 4,000/day
        wastePct: "0",
      },
      // Equipment — standard qty × unitPrice
      {
        lineType: "EQUIPMENT" as const,
        descriptionEn: "Equipment (per m³)",
        quantity: "1",
        unitPrice: "60",
        wastePct: "0",
      },
    ],
  };

  it("BR-8: material line costs = consumption × (1 + waste%) × unit cost", () => {
    const result = computeRate(input);

    // Cement: 0.35 × 1.00 × 1000 = 350.00
    expect(result.lines[0].lineCost).toBe("350.00");

    // Sand: 0.45 × 1.00 × 150 = 67.50
    expect(result.lines[1].lineCost).toBe("67.50");

    // Aggregate: 0.85 × 1.00 × 180 = 153.00
    expect(result.lines[2].lineCost).toBe("153.00");

    // Water: 0.18 × 1.00 × 10 = 1.80
    expect(result.lines[3].lineCost).toBe("1.80");

    // Admixture (lump): 1 × 1.00 × 30 = 30.00
    expect(result.lines[4].lineCost).toBe("30.00");
  });

  it("BR-9 CREW mode: labor cost = unitPrice / outputQuantity = 4000 / 40 = 100.00", () => {
    const result = computeRate(input);
    // Labor crew: 1 × 4000 / 40 = 100.00
    expect(result.lines[5].lineCost).toBe("100.00");
  });

  it("equipment line cost = quantity × unitPrice = 1 × 60 = 60.00", () => {
    const result = computeRate(input);
    expect(result.lines[6].lineCost).toBe("60.00");
  });

  it("BR-9: direct cost = Σ materials + Σ labor + Σ equipment = 762.30", () => {
    const result = computeRate(input);
    // 350.00 + 67.50 + 153.00 + 1.80 + 30.00 + 100.00 + 60.00 = 762.30
    expect(result.directCost).toBe("762.30");
  });

  it("BR-10: overhead amount = direct × OH% = 762.30 × 0.10 = 76.23", () => {
    const result = computeRate(input);
    expect(result.overheadAmount).toBe("76.23");
  });

  it("BR-10: profit amount = (direct × 1.10) × Profit% = 838.53 × 0.15 = 125.78", () => {
    const result = computeRate(input);
    // 762.30 × 1.10 = 838.53 ; 838.53 × 0.15 = 125.7795 → 125.78
    expect(result.profitAmount).toBe("125.78");
  });

  it("GT-2: final rate = round((direct × 1.10) × 1.15, 2) = 964.31", () => {
    const result = computeRate(input);
    // 762.30 × 1.10 = 838.53 ; 838.53 × 1.15 = 964.3095 → 964.31
    expect(result.rate).toBe("964.31");
  });

  it("GT-2: full authoritative case (all values reproduced exactly)", () => {
    const result = computeRate(input);

    // All line costs
    expect(result.lines[0].lineCost).toBe("350.00"); // cement
    expect(result.lines[1].lineCost).toBe("67.50"); // sand
    expect(result.lines[2].lineCost).toBe("153.00"); // agg
    expect(result.lines[3].lineCost).toBe("1.80"); // water
    expect(result.lines[4].lineCost).toBe("30.00"); // admix
    expect(result.lines[5].lineCost).toBe("100.00"); // labor (crew)
    expect(result.lines[6].lineCost).toBe("60.00"); // equipment

    // Aggregates
    expect(result.directCost).toBe("762.30");
    expect(result.overheadAmount).toBe("76.23");
    expect(result.profitAmount).toBe("125.78");
    expect(result.rate).toBe("964.31");
  });
});

describe("BR-8 — Material waste factor (golden-adjacent)", () => {
  it("5% waste on 100 unit cost × 1 consumption = 105.00", () => {
    const result = computeRate({
      laborMode: "CONSUMPTION",
      outputQuantity: "1",
      overheadPct: "0",
      profitPct: "0",
      lines: [
        {
          lineType: "MATERIAL",
          descriptionEn: "Test material with waste",
          quantity: "1",
          unitPrice: "100",
          wastePct: "5",
        },
      ],
    });
    // 1 × (1 + 0.05) × 100 = 105.00
    expect(result.lines[0].lineCost).toBe("105.00");
    expect(result.directCost).toBe("105.00");
    expect(result.rate).toBe("105.00"); // 0% OH, 0% profit → rate = direct
  });

  it("12.5% waste on 80 @ 0.4 consumption = 36.00", () => {
    const result = computeRate({
      laborMode: "CONSUMPTION",
      outputQuantity: "1",
      overheadPct: "0",
      profitPct: "0",
      lines: [
        {
          lineType: "MATERIAL",
          descriptionEn: "Test material",
          quantity: "0.4",
          unitPrice: "80",
          wastePct: "12.5",
        },
      ],
    });
    // 0.4 × 1.125 × 80 = 36.00
    expect(result.lines[0].lineCost).toBe("36.00");
  });
});

describe("BR-9 — Labor CONSUMPTION mode (golden-adjacent)", () => {
  it("CONSUMPTION: 8 hrs × 25 $/hr = 200.00", () => {
    const result = computeRate({
      laborMode: "CONSUMPTION",
      outputQuantity: "1",
      overheadPct: "0",
      profitPct: "0",
      lines: [
        {
          lineType: "LABOR",
          descriptionEn: "Labor hours",
          quantity: "8",
          unitPrice: "25",
          wastePct: "0",
        },
      ],
    });
    expect(result.lines[0].lineCost).toBe("200.00");
    expect(result.directCost).toBe("200.00");
  });

  it("CREW mode throws if outputQuantity is zero", () => {
    expect(() =>
      computeRate({
        laborMode: "CREW",
        outputQuantity: "0",
        overheadPct: "0",
        profitPct: "0",
        lines: [
          {
            lineType: "LABOR",
            descriptionEn: "Crew",
            quantity: "1",
            unitPrice: "4000",
            wastePct: "0",
          },
        ],
      }),
    ).toThrow(/outputQuantity/);
  });
});

describe("BR-10 — Compounding order (golden-adjacent)", () => {
  it("OH first, then profit (compounding) — verify ordering matters", () => {
    // direct=100, OH=10%, profit=10%
    // OH-first:  100 × 1.10 = 110 ; 110 × 1.10 = 121.00
    // Profit-first: 100 × 1.10 = 110 ; 110 × 1.10 = 121.00
    // (Symmetric for equal percentages — but the rule still applies asymmetrically.)
    const symmetric = computeRate({
      laborMode: "CONSUMPTION",
      outputQuantity: "1",
      overheadPct: "10",
      profitPct: "10",
      lines: [
        {
          lineType: "MATERIAL",
          descriptionEn: "Symmetric test",
          quantity: "1",
          unitPrice: "100",
          wastePct: "0",
        },
      ],
    });
    expect(symmetric.rate).toBe("121.00");

    // Asymmetric: OH=10%, profit=20%.
    // OH-first:  100 × 1.10 = 110 ; 110 × 1.20 = 132.00
    // Profit-first: 100 × 1.20 = 120 ; 120 × 1.10 = 132.00
    // Mathematically identical for compounding (multiplication is commutative) —
    // so this test is mostly defensive to confirm the formula is fixed and
    // reproduces the spec-mandated value.
    const asymmetric = computeRate({
      laborMode: "CONSUMPTION",
      outputQuantity: "1",
      overheadPct: "10",
      profitPct: "20",
      lines: [
        {
          lineType: "MATERIAL",
          descriptionEn: "Asymmetric test",
          quantity: "1",
          unitPrice: "100",
          wastePct: "0",
        },
      ],
    });
    expect(asymmetric.rate).toBe("132.00");
    expect(asymmetric.overheadAmount).toBe("10.00");
    expect(asymmetric.profitAmount).toBe("22.00"); // 110 × 0.20 = 22.00
  });

  it("0% OH + 0% profit → rate = direct (no compounding)", () => {
    const result = computeRate({
      laborMode: "CONSUMPTION",
      outputQuantity: "1",
      overheadPct: "0",
      profitPct: "0",
      lines: [
        {
          lineType: "MATERIAL",
          descriptionEn: "Zero overhead/profit",
          quantity: "5",
          unitPrice: "20",
          wastePct: "0",
        },
      ],
    });
    expect(result.directCost).toBe("100.00");
    expect(result.overheadAmount).toBe("0.00");
    expect(result.profitAmount).toBe("0.00");
    expect(result.rate).toBe("100.00");
  });

  it("HALF_UP rounding: 762.30 × 1.10 × 1.15 = 964.3095 → 964.31", () => {
    // Direct re-check of GT-2's rate rounding — explicit HALF_UP case.
    const result = computeRate({
      laborMode: "CONSUMPTION",
      outputQuantity: "1",
      overheadPct: "10",
      profitPct: "15",
      lines: [
        {
          lineType: "MATERIAL",
          descriptionEn: "Synthetic direct=762.30",
          quantity: "762.30",
          unitPrice: "1",
          wastePct: "0",
        },
      ],
    });
    // 762.30 × 1.10 = 838.53 ; 838.53 × 1.15 = 964.3095 → HALF_UP → 964.31
    expect(result.directCost).toBe("762.30");
    expect(result.rate).toBe("964.31");
  });

  it("Empty rate analysis (no lines) → zero rate", () => {
    const result = computeRate({
      laborMode: "CONSUMPTION",
      outputQuantity: "1",
      overheadPct: "10",
      profitPct: "15",
      lines: [],
    });
    expect(result.directCost).toBe("0.00");
    expect(result.overheadAmount).toBe("0.00");
    expect(result.profitAmount).toBe("0.00");
    expect(result.rate).toBe("0.00");
    expect(result.lines).toEqual([]);
  });
});
