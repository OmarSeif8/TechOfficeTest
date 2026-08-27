/**
 * GT-DXF-5 — Unit Parsing (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §5 Part 3B:
 *   $INSUNITS=4 → unit mm
 *   Header absent → null (UI prompts)
 *
 * This test exercises BR-DW1 (unit resolution from the DXF $INSUNITS header):
 *   - `unitFromInsUnits(insUnits)`  — the pure lookup table (units.ts)
 *   - `unitFromHeader(header)`     — the parser-side adapter (dxf-parser.ts)
 *
 * Both are pure functions. The lookup table is exhaustive over the common
 * engineering units; unknown / unspecified values fall back to `null`
 * (UI prompts the user — never a silent default).
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import { unitFromInsUnits } from "@domain/drawing/units";
import { unitFromHeader } from "@domain/drawing/dxf-parser";
import type { DxfHeader } from "@shared/schemas/drawing/dxf";

// ─── Fixture: DXF headers with various $INSUNITS values ───────────────────
//
// We don't generate full DXF text here — the unit lookup is a pure function
// over the *parsed* header shape, so we construct DxfHeader values directly.

function headerWith(insUnits: number | null): DxfHeader {
  return {
    insUnits,
    extents: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

describe("GT-DXF-5 — $INSUNITS → unit label; absent → null (BR-DW1)", () => {
  // ─── Spec mandates ───────────────────────────────────────────────────
  it("$INSUNITS = 4 → 'mm' (the canonical civil/structural default)", () => {
    expect(unitFromInsUnits(4)).toBe("mm");
    expect(unitFromHeader(headerWith(4))).toBe("mm");
  });

  it("$INSUNITS absent (null) → null (UI prompts the user)", () => {
    expect(unitFromInsUnits(null)).toBeNull();
    expect(unitFromHeader(headerWith(null))).toBeNull();
  });

  it("$INSUNITS absent (undefined) → null (also treated as absent)", () => {
    expect(unitFromInsUnits(undefined)).toBeNull();
  });

  // ─── Other common engineering units (per the AutoCAD DXF Reference) ─
  it("$INSUNITS = 6 → 'm' (meters — site plans / survey)", () => {
    expect(unitFromInsUnits(6)).toBe("m");
  });

  it("$INSUNITS = 5 → 'cm' (centimeters)", () => {
    expect(unitFromInsUnits(5)).toBe("cm");
  });

  it("$INSUNITS = 7 → 'km' (kilometers)", () => {
    expect(unitFromInsUnits(7)).toBe("km");
  });

  it("$INSUNITS = 1 → 'in' (inches)", () => {
    expect(unitFromInsUnits(1)).toBe("in");
  });

  it("$INSUNITS = 2 → 'ft' (international feet)", () => {
    expect(unitFromInsUnits(2)).toBe("ft");
  });

  it("$INSUNITS = 3 → 'mi' (miles)", () => {
    expect(unitFromInsUnits(3)).toBe("mi");
  });

  it("$INSUNITS = 11 → 'yd' (yards)", () => {
    expect(unitFromInsUnits(11)).toBe("yd");
  });

  it("$INSUNITS = 22 → 'ft-us' (US survey feet — distinct from international)", () => {
    expect(unitFromInsUnits(22)).toBe("ft-us");
  });

  // ─── Defensive cases (per BR-DW1: absent / unknown → null) ───────────
  it("$INSUNITS = 0 (DXF 'Unspecified') → null (same as absent)", () => {
    expect(unitFromInsUnits(0)).toBeNull();
    expect(unitFromHeader(headerWith(0))).toBeNull();
  });

  it("$INSUNITS = 99 (unknown code) → null (no silent default)", () => {
    expect(unitFromInsUnits(99)).toBeNull();
  });

  it("$INSUNITS = NaN / Infinity → null (defensive against malformed parse)", () => {
    expect(unitFromInsUnits(NaN)).toBeNull();
    expect(unitFromInsUnits(Number.POSITIVE_INFINITY)).toBeNull();
    expect(unitFromInsUnits(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  // ─── Integration with dxf-parser (parse a full DXF + check header) ─
  it("parseDrawing extracts the $INSUNITS value from a real DXF HEADER section", async () => {
    // Dynamically import to keep this test's import list focused.
    const { parseDrawing } = await import("@domain/drawing/dxf-parser");

    const dxfWithMm = [
      "0\nSECTION\n2\nHEADER\n",
      "9\n$INSUNITS\n70\n4\n",
      "0\nENDSEC\n",
      "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n",
    ].join("");

    const drawing = parseDrawing(dxfWithMm);
    expect(drawing.header.insUnits).toBe(4);
    expect(unitFromHeader(drawing.header)).toBe("mm");
  });

  it("parseDrawing returns null insUnits when the HEADER section is absent", async () => {
    const { parseDrawing } = await import("@domain/drawing/dxf-parser");

    // No HEADER section at all — just ENTITIES.
    const dxfNoHeader =
      "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";

    const drawing = parseDrawing(dxfNoHeader);
    expect(drawing.header.insUnits).toBeNull();
    expect(unitFromHeader(drawing.header)).toBeNull();
  });

  it("unitFromInsUnits is pure / deterministic — same input → identical output", () => {
    expect(unitFromInsUnits(4)).toBe(unitFromInsUnits(4));
    expect(unitFromInsUnits(null)).toBe(unitFromInsUnits(null));
  });
});
