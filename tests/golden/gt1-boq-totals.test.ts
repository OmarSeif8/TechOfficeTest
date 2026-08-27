/**
 * GT-1 — BoQ Totals Golden Test
 *
 * From SPEC_PHASE1_BOQ_WEB.md §6:
 *   BoQ: 2 sections; items (qty 12.5 × rate 85.40) and (qty 3 × rate 1,250.00)
 *   in S1; (qty 40 × rate 964.31) in S2; VAT 14%
 *
 *   Expected:
 *     Amounts: 1,067.50 · 3,750.00 · 38,572.40
 *     → subtotal 43,389.90
 *     → VAT 6,074.59
 *     → total 49,464.49
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 * Per the Constitution: golden tests are law. NEVER edit expected values to make
 * a test pass — if you believe the GT is wrong, STOP and report.
 */

import { describe, it, expect } from "vitest";
import { computeDocumentTotals, computeItemAmount, computeSectionSubtotal } from "@domain/boq/totals";

describe("GT-1 — BoQ Totals (authoritative)", () => {
  const document = {
    sections: [
      {
        code: "1",
        titleEn: "Section 1",
        items: [
          {
            id: "item-1",
            itemType: "RATE_BASED" as const,
            quantity: "12.5",
            rate: "85.40",
          },
          {
            id: "item-2",
            itemType: "RATE_BASED" as const,
            quantity: "3",
            rate: "1250.00",
          },
        ],
      },
      {
        code: "2",
        titleEn: "Section 2",
        items: [
          {
            id: "item-3",
            itemType: "RATE_BASED" as const,
            quantity: "40",
            rate: "964.31",
          },
        ],
      },
    ],
    vatPercentage: "14",
  };

  it("BR-2: item amounts are qty × rate rounded to 2dp", () => {
    const a1 = computeItemAmount(document.sections[0].items[0]);
    // 12.5 × 85.40 = 1,067.50
    expect(a1.amount).toBe("1067.50");

    const a2 = computeItemAmount(document.sections[0].items[1]);
    // 3 × 1250.00 = 3,750.00
    expect(a2.amount).toBe("3750.00");

    const a3 = computeItemAmount(document.sections[1].items[0]);
    // 40 × 964.31 = 38,572.40
    expect(a3.amount).toBe("38572.40");
  });

  it("BR-3: section subtotals = Σ of rounded item amounts", () => {
    const s1 = computeSectionSubtotal(document.sections[0]);
    // 1,067.50 + 3,750.00 = 4,817.50
    expect(s1.subtotal).toBe("4817.50");

    const s2 = computeSectionSubtotal(document.sections[1]);
    // 38,572.40
    expect(s2.subtotal).toBe("38572.40");
  });

  it("BR-3: document subtotal = Σ section subtotals", () => {
    const totals = computeDocumentTotals(document);
    // 4,817.50 + 38,572.40 = 43,389.90
    expect(totals.subtotal).toBe("43389.90");
  });

  it("BR-4: VAT = round(subtotal × vat%, 2)", () => {
    const totals = computeDocumentTotals(document);
    // 43,389.90 × 0.14 = 6,074.586 → rounded HALF_UP to 2dp = 6,074.59
    expect(totals.vatAmount).toBe("6074.59");
  });

  it("BR-4: total incl. VAT = subtotal + VAT", () => {
    const totals = computeDocumentTotals(document);
    // 43,389.90 + 6,074.59 = 49,464.49
    expect(totals.totalIncludingVat).toBe("49464.49");
  });

  it("GT-1: full authoritative case (all values reproduced exactly)", () => {
    const totals = computeDocumentTotals(document);

    // All three item amounts
    expect(totals.sections[0].items[0].amount).toBe("1067.50");
    expect(totals.sections[0].items[1].amount).toBe("3750.00");
    expect(totals.sections[1].items[0].amount).toBe("38572.40");

    // Subtotal
    expect(totals.subtotal).toBe("43389.90");

    // VAT
    expect(totals.vatAmount).toBe("6074.59");

    // Total incl. VAT
    expect(totals.totalIncludingVat).toBe("49464.49");

    // Item count
    expect(totals.itemCount).toBe(3);
  });
});

describe("BR-5 — Item type edge cases (golden-adjacent)", () => {
  it("LUMP_SUM forces qty=1; amount = round(rate, 2)", () => {
    const ls = computeItemAmount({
      itemType: "LUMP_SUM",
      quantity: "999", // ignored — forced to 1
      rate: "5000.005", // rounds to 5,000.01 (HALF_UP)
    });
    expect(ls.effectiveQuantity).toBe("1.00");
    expect(ls.amount).toBe("5000.01");
  });

  it("UNIT_ONLY is excluded from totals with amount 0", () => {
    const uo = computeItemAmount({
      itemType: "UNIT_ONLY",
      quantity: "10",
      rate: "100",
    });
    expect(uo.excludedFromTotals).toBe(true);
    expect(uo.amount).toBe("0.00");
  });

  it("PROVISIONAL_SUM is included in totals (qty × rate)", () => {
    const ps = computeItemAmount({
      itemType: "PROVISIONAL_SUM",
      quantity: "5",
      rate: "1000.00",
    });
    expect(ps.excludedFromTotals).toBe(false);
    expect(ps.amount).toBe("5000.00");
  });

  it("UNIT_ONLY does not contribute to section subtotal", () => {
    const section = {
      items: [
        { itemType: "RATE_BASED" as const, quantity: "10", rate: "100" }, // 1,000.00
        { itemType: "UNIT_ONLY" as const, quantity: "10", rate: "100" }, // excluded
      ],
    };
    const s = computeSectionSubtotal(section);
    expect(s.subtotal).toBe("1000.00");
  });
});

describe("BR-4 — VAT edge cases (golden-adjacent)", () => {
  it("no VAT percentage → vatAmount=0, total=subtotal", () => {
    const totals = computeDocumentTotals({
      sections: [
        { items: [{ itemType: "RATE_BASED", quantity: "10", rate: "100" }] },
      ],
    });
    expect(totals.vatPercentage).toBe("");
    expect(totals.vatAmount).toBe("0.00");
    expect(totals.totalIncludingVat).toBe(totals.subtotal);
    expect(totals.subtotal).toBe("1000.00");
  });

  it("0% VAT → vatAmount=0, total=subtotal", () => {
    const totals = computeDocumentTotals({
      sections: [
        { items: [{ itemType: "RATE_BASED", quantity: "10", rate: "100" }] },
      ],
      vatPercentage: "0",
    });
    expect(totals.vatAmount).toBe("0.00");
    expect(totals.totalIncludingVat).toBe("1000.00");
  });

  it("half-up rounding: 100 × 0.125 = 12.5 → exactly representable; 99.99 × 0.10 = 9.999 → 10.00", () => {
    const t1 = computeDocumentTotals({
      sections: [{ items: [{ itemType: "RATE_BASED", quantity: "1", rate: "100" }] }],
      vatPercentage: "12.5",
    });
    // 100.00 × 0.125 = 12.5 → 12.50
    expect(t1.vatAmount).toBe("12.50");

    const t2 = computeDocumentTotals({
      sections: [{ items: [{ itemType: "RATE_BASED", quantity: "1", rate: "99.99" }] }],
      vatPercentage: "10",
    });
    // 99.99 × 0.10 = 9.999 → HALF_UP → 10.00
    expect(t2.vatAmount).toBe("10.00");
  });

  it("empty document → all zeros", () => {
    const totals = computeDocumentTotals({ sections: [] });
    expect(totals.subtotal).toBe("0.00");
    expect(totals.vatAmount).toBe("0.00");
    expect(totals.totalIncludingVat).toBe("0.00");
    expect(totals.itemCount).toBe(0);
  });
});
