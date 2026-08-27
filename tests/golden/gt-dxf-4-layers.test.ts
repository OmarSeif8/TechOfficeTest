/**
 * GT-DXF-4 — Layer Filter on Fixture B (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §5 Part 3B:
 *   Layer toggle on Fixture B
 *   Filter with layer B hidden → excludes B's entities
 *
 * Fixture B is a CIRCLE on layer A (center 500,500 r=250) plus entities on
 * two layers (A and B). The fixture is generated in-code as an ASCII string
 * (DXF is a text format — no binary files in the repo).
 *
 * This test exercises the pure layer filter (BR-DW3):
 *   - `filterEntities(entities, visibleLayers)`  — pure function, no DOM
 *   - `getLayerNames(entities)`                  — unique layer names
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import {
  parseDxf,
  extractEntities,
  extractLayers,
} from "@domain/drawing/dxf-parser";
import {
  filterEntities,
  getLayerNames,
} from "@domain/drawing/layers";
import type { DxfEntity } from "@shared/schemas/drawing/dxf";

// ─── Fixture B: CIRCLE + LINEs on layers A and B ─────────────────────────
//
// Fixture B layout (per the spec):
//   - CIRCLE: center (500, 500), radius 250, on layer A
//   - LINE A1: on layer A (so layer A has 2 entities)
//   - LINE B1: on layer B
//
// The TABLES section declares layers A (color 1, visible) and B (color 5,
// visible). The visibility of layers as declared in the DXF is NOT what this
// test exercises — that is the *declared* visibility. What `filterEntities`
// does is apply the *user-selected* visible set (a Set<string> of layer names
// the user has ticked on in the layers panel).
function generateFixtureB(): string {
  let dxf = "";
  // HEADER + TABLES to declare two layers (A and B).
  dxf += "0\nSECTION\n2\nHEADER\n";
  dxf += "9\n$INSUNITS\n70\n4\n"; // millimeters
  dxf += "0\nENDSEC\n";
  dxf += "0\nSECTION\n2\nTABLES\n";
  dxf += "0\nTABLE\n2\nLAYER\n70\n2\n";
  // Layer A: red (color 1), visible (flag 0)
  dxf += "0\nLAYER\n2\nA\n62\n1\n70\n0\n";
  // Layer B: blue (color 5), visible (flag 0)
  dxf += "0\nLAYER\n2\nB\n62\n5\n70\n0\n";
  dxf += "0\nENDTAB\n0\nENDSEC\n";
  // ENTITIES section.
  dxf += "0\nSECTION\n2\nENTITIES\n";
  // CIRCLE on layer A: center (500, 500), radius 250
  dxf += "0\nCIRCLE\n8\nA\n10\n500\n20\n500\n40\n250\n";
  // LINE on layer A: (0,0) → (100,0)
  dxf += "0\nLINE\n8\nA\n10\n0\n20\n0\n11\n100\n21\n0\n";
  // LINE on layer B: (200,200) → (300,300)
  dxf += "0\nLINE\n8\nB\n10\n200\n20\n200\n11\n300\n21\n300\n";
  dxf += "0\nENDSEC\n0\nEOF\n";
  return dxf;
}

describe("GT-DXF-4 — Layer filter on Fixture B (CIRCLE + LINEs on A and B)", () => {
  const dxfText = generateFixtureB();
  const parsed = parseDxf(dxfText);
  const entities = extractEntities(parsed);
  const layers = extractLayers(parsed);

  it("Fixture B parses to 3 entities (1 CIRCLE + 2 LINEs)", () => {
    expect(entities).toHaveLength(3);
    const types = entities.map((e) => e.type).sort();
    expect(types).toEqual(["CIRCLE", "LINE", "LINE"]);
  });

  it("Fixture B declares layers A and B (plus default '0')", () => {
    const names = layers.map((l) => l.name).sort();
    // Layer "0" is always present (synthesized when missing from TABLES).
    // Layers "A" and "B" are declared in the TABLES section.
    expect(names).toEqual(["0", "A", "B"]);
  });

  it("getLayerNames returns unique, sorted layer names actually used by entities", () => {
    const names = getLayerNames(entities);
    expect(names).toEqual(["A", "B"]); // Layer "0" is unused in Fixture B
  });

  it("filterEntities with both A and B visible → returns all 3 entities (no filter)", () => {
    const visible = new Set<string>(["A", "B"]);
    const filtered = filterEntities(entities, visible);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((e) => e.type).sort()).toEqual(["CIRCLE", "LINE", "LINE"]);
  });

  it("filterEntities with layer B hidden → excludes B's LINE, includes A's entities", () => {
    // Per spec: "Filter with layer B hidden → excludes B's entities, includes A's"
    const visible = new Set<string>(["A"]);
    const filtered = filterEntities(entities, visible);
    expect(filtered).toHaveLength(2);
    // The CIRCLE (on A) and the LINE on A survive; the LINE on B is dropped.
    const types = filtered.map((e) => e.type).sort();
    expect(types).toEqual(["CIRCLE", "LINE"]);
    // Every surviving entity must be on layer A.
    for (const e of filtered) {
      expect(e.layer).toBe("A");
    }
  });

  it("filterEntities with layer A hidden → excludes A's entities, leaves only B's LINE", () => {
    const visible = new Set<string>(["B"]);
    const filtered = filterEntities(entities, visible);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("LINE");
    expect(filtered[0].layer).toBe("B");
  });

  it("filterEntities with no layers visible → returns empty array", () => {
    const visible = new Set<string>();
    const filtered = filterEntities(entities, visible);
    expect(filtered).toEqual([]);
  });

  it("filterEntities preserves source order of the surviving entities", () => {
    const visible = new Set<string>(["A", "B"]);
    const filtered = filterEntities(entities, visible);
    // Source order: CIRCLE(A), LINE(A), LINE(B)
    expect(filtered[0].type).toBe("CIRCLE");
    expect(filtered[1].type).toBe("LINE");
    expect(filtered[1].layer).toBe("A");
    expect(filtered[2].type).toBe("LINE");
    expect(filtered[2].layer).toBe("B");
  });

  it("filterEntities is pure / deterministic — same input → identical output", () => {
    const visible = new Set<string>(["A"]);
    const a = filterEntities(entities, visible);
    const b = filterEntities(entities, visible);
    expect(a).toEqual(b);
  });

  it("filterEntities does NOT mutate its input (referential transparency)", () => {
    const visible = new Set<string>(["A"]);
    const originalLength = entities.length;
    const snapshot = entities.map((e) => ({ ...e }));
    filterEntities(entities, visible);
    expect(entities.length).toBe(originalLength);
    expect(entities).toEqual(snapshot);
  });
});
