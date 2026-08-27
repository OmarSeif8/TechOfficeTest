/**
 * GT-DXF-1 — Parse Fixture A (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §5 Part 3B:
 *   Parse Fixture A (4 LINEs, rectangle)
 *   Expected: 4 LINE entities; extents min (0,0), max (1000,750)
 *
 * Fixture A is a 1000×750 rectangle drawn as 4 LINE entities in the DXF
 * ENTITIES section. The fixture is generated in-code as an ASCII string
 * (DXF is a text format — no binary files in the repo).
 *
 * This test exercises:
 *   - `parseDxf(dxfText)` parses the DXF text without throwing.
 *   - `extractEntities(parsed)` returns exactly 4 LINE entities.
 *   - Each LINE entity has the expected start/end points.
 *   - `calculateExtents(entities)` returns { minX: 0, minY: 0, maxX: 1000,
 *     maxY: 750 } — pure function, no DOM (BR-DW2).
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import {
  parseDxf,
  extractEntities,
  calculateExtents,
} from "@domain/drawing/dxf-parser";
import type { DxfEntity } from "@shared/schemas/drawing/dxf";

// ─── Fixture A: 1000×750 rectangle as 4 LINE entities ─────────────────────
//
// The DXF format is line-delimited "tuples" of (group code, value) pairs.
// For a LINE entity:
//   0  LINE      — entity type marker
//   8  <name>    — layer name (group code 8)
//   10 <x>       — start X (group code 10)
//   20 <y>       — start Y (group code 20)
//   11 <x>       — end X   (group code 11)
//   21 <y>       — end Y   (group code 21)
//
// We place all 4 lines on the default layer "0".
function generateRectangleDxf(): string {
  const lines = [
    { start: [0, 0], end: [1000, 0] },
    { start: [1000, 0], end: [1000, 750] },
    { start: [1000, 750], end: [0, 750] },
    { start: [0, 750], end: [0, 0] },
  ];

  let dxf = "";
  dxf += "0\nSECTION\n2\nENTITIES\n";
  for (const line of lines) {
    dxf += "0\nLINE\n8\n0\n";
    dxf += `10\n${line.start[0]}\n20\n${line.start[1]}\n`;
    dxf += `11\n${line.end[0]}\n21\n${line.end[1]}\n`;
  }
  dxf += "0\nENDSEC\n0\nEOF\n";
  return dxf;
}

describe("GT-DXF-1 — Parse Fixture A (rectangle, 4 LINEs)", () => {
  const dxfText = generateRectangleDxf();
  const parsed = parseDxf(dxfText);
  const entities = extractEntities(parsed);

  it("parses Fixture A as an ASCII string without throwing", () => {
    expect(dxfText).toContain("SECTION");
    expect(dxfText).toContain("ENTITIES");
    expect(dxfText).toContain("EOF");
    // The fixture is byte-deterministic — same input → same output.
    expect(generateRectangleDxf()).toBe(dxfText);
  });

  it("extracts exactly 4 LINE entities (no other types)", () => {
    expect(entities).toHaveLength(4);
    for (const e of entities) {
      expect(e.type).toBe("LINE");
    }
  });

  it("each LINE has the expected start/end coordinates", () => {
    // Sort by start X to make assertions order-independent.
    const sorted = [...entities].sort(
      (a, b) =>
        (a as Extract<DxfEntity, { type: "LINE" }>).start.x -
        (b as Extract<DxfEntity, { type: "LINE" }>).start.x,
    );

    // Expected segments (sorted by start.x, then start.y):
    //   (0,0) → (1000,0)        bottom edge
    //   (0,750) → (0,0)         left edge (descending Y)
    //   (1000,0) → (1000,750)   right edge
    //   (1000,750) → (0,750)    top edge
    const expected = [
      { start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
      { start: { x: 0, y: 750 }, end: { x: 0, y: 0 } },
      { start: { x: 1000, y: 0 }, end: { x: 1000, y: 750 } },
      { start: { x: 1000, y: 750 }, end: { x: 0, y: 750 } },
    ];

    for (let i = 0; i < 4; i++) {
      const line = sorted[i] as Extract<DxfEntity, { type: "LINE" }>;
      expect(line.start.x).toBeCloseTo(expected[i].start.x, 10);
      expect(line.start.y).toBeCloseTo(expected[i].start.y, 10);
      expect(line.end.x).toBeCloseTo(expected[i].end.x, 10);
      expect(line.end.y).toBeCloseTo(expected[i].end.y, 10);
    }
  });

  it("all 4 LINEs are on the default layer '0'", () => {
    for (const e of entities) {
      expect(e.layer).toBe("0");
    }
  });

  it("calculateExtents returns min (0,0) max (1000,750) (BR-DW2 pure function)", () => {
    const extents = calculateExtents(entities);
    expect(extents.minX).toBe(0);
    expect(extents.minY).toBe(0);
    expect(extents.maxX).toBe(1000);
    expect(extents.maxY).toBe(750);
  });

  it("parser is pure / deterministic — same input → byte-identical output", () => {
    const parsed2 = parseDxf(generateRectangleDxf());
    const entities2 = extractEntities(parsed2);
    expect(entities2).toEqual(entities);
    expect(calculateExtents(entities2)).toEqual(calculateExtents(entities));
  });

  it("calculateExtents is pure on empty input (degenerate box at origin)", () => {
    const extents = calculateExtents([]);
    expect(extents).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
