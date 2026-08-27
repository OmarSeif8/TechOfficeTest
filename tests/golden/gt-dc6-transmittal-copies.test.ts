/**
 * GT-DC6 — Transmittal Copies (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §4:
 *   Transmittal, 3 lines with copies 2/3/1
 *   Expected: Total copies = 6 on form
 *
 * This test exercises:
 *   - `calculateTotalCopies(lines) === 6` for lines with copies 2, 3, 1.
 *   - The result is what appears on the transmittal PDF form footer (BR-DC10).
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import {
  calculateTotalCopies,
  validateTransmittal,
} from "@domain/doccontrol/transmittal";
import type { TransmittalLineInput } from "@shared/schemas/doccontrol/entities";

describe("GT-DC6 — Transmittal copies (authoritative)", () => {
  // Setup: one transmittal (Correspondence row with type=TRANSMITTAL),
  // three lines with copies 2, 3, 1.
  const lines: TransmittalLineInput[] = [
    {
      transmittalId: "correspondence-T-001",
      docRef: "DWG-100",
      descriptionEn: "Architectural floor plan — rev B",
      copies: 2,
      sortOrder: 0,
    },
    {
      transmittalId: "correspondence-T-001",
      docRef: "DWG-200",
      descriptionEn: "Structural slab plan — rev A",
      copies: 3,
      sortOrder: 1,
    },
    {
      transmittalId: "correspondence-T-001",
      docRef: "SPEC-001",
      descriptionEn: "Concrete specification",
      copies: 1,
      sortOrder: 2,
    },
  ];

  it("total copies = 6 (2 + 3 + 1)", () => {
    expect(calculateTotalCopies(lines)).toBe(6);
  });

  it("lines pass validation (BR-DC10 — N lines, unique sortOrder, non-empty docRef/desc, copies ≥ 0)", () => {
    expect(validateTransmittal(lines)).toEqual([]);
  });

  // Edge cases — also verify the form invariant holds under common variations.
  it("empty line list → 0 copies + validation error", () => {
    expect(calculateTotalCopies([])).toBe(0);
    const errors = validateTransmittal([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/at least one line/);
  });

  it("single line — total = that line's copies", () => {
    const single: TransmittalLineInput[] = [
      {
        transmittalId: "T",
        docRef: "X",
        descriptionEn: "Y",
        copies: 5,
        sortOrder: 0,
      },
    ];
    expect(calculateTotalCopies(single)).toBe(5);
  });

  it("large transmittal — 10 lines × 4 copies = 40", () => {
    const many: TransmittalLineInput[] = Array.from({ length: 10 }, (_, i) => ({
      transmittalId: "T",
      docRef: `X-${i}`,
      descriptionEn: `Y-${i}`,
      copies: 4,
      sortOrder: i,
    }));
    expect(calculateTotalCopies(many)).toBe(40);
  });
});
