/**
 * GT-DXF-2 — Measurements on Fixture A (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §5 Part 3B:
 *   Measurements on Fixture A
 *   Expected:
 *     - Distance (0,0)→(1000,0) = 1000.000
 *     - Polygon area = 750,000.00  (1000 × 750)
 *     - Perimeter    = 3500.000   (2 × 1000 + 2 × 750)
 *
 * This test exercises the pure measurement functions (BR-DW2):
 *   - `distance(p1, p2)`      — Euclidean distance
 *   - `polygonArea(points)`   — shoelace formula (Gauss)
 *   - `perimeter(points)`     — sum of edge lengths (closed polygon)
 *
 * All three functions are pure: input = points, output = number. No DOM,
 * no Date.now(), no Math.random(). Same input → byte-identical output.
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import {
  distance,
  polygonArea,
  perimeter,
  polylineLength,
} from "@domain/drawing/measurement";
import type { Point } from "@shared/schemas/drawing/dxf";

// ─── Fixture A: the 1000×750 rectangle's 4 corners ──────────────────────
//
// These are the same coordinates as GT-DXF-1's Fixture A (4 LINEs forming
// a rectangle). Here we measure the rectangle directly via its corner
// points — no DXF parsing involved (the parser is exercised in GT-DXF-1).

const CORNERS_CCW: Point[] = [
  { x: 0, y: 0 }, // bottom-left
  { x: 1000, y: 0 }, // bottom-right
  { x: 1000, y: 750 }, // top-right
  { x: 0, y: 750 }, // top-left
];

describe("GT-DXF-2 — Measurements on Fixture A (1000×750 rectangle)", () => {
  it("distance (0,0) → (1000,0) = 1000.000", () => {
    const d = distance(CORNERS_CCW[0], CORNERS_CCW[1]);
    expect(d).toBeCloseTo(1000, 3);
    expect(d).toBe(1000); // Exact for axis-aligned edges with integer coords.
  });

  it("polygon area = 750,000.00 (1000 × 750)", () => {
    const area = polygonArea(CORNERS_CCW);
    // 1,000 × 750 = 750,000
    expect(area).toBeCloseTo(750_000, 2);
    expect(area).toBe(750_000); // Exact for an axis-aligned rectangle.
  });

  it("perimeter = 3500.000 (2×1000 + 2×750)", () => {
    const p = perimeter(CORNERS_CCW);
    // 2 × 1000 + 2 × 750 = 2000 + 1500 = 3500
    expect(p).toBeCloseTo(3500, 3);
    expect(p).toBe(3500); // Exact for axis-aligned edges with integer coords.
  });

  it("polygonArea is orientation-agnostic (CW polygon returns same area)", () => {
    // Same rectangle, vertices in reverse (clockwise) order — the shoelace
    // formula returns a signed sum; we take the absolute value.
    const cw = [...CORNERS_CCW].reverse();
    expect(polygonArea(cw)).toBeCloseTo(750_000, 2);
  });

  it("perimeter treats the polygon as closed (closing edge included)", () => {
    // perimeter([A,B,C,D]) includes the edge D→A.
    // polylineLength([A,B,C,D]) does NOT (open polyline).
    const closed = perimeter(CORNERS_CCW); // 3500
    const open = polylineLength(CORNERS_CCW); // 3500 − 750 = 2750
    expect(closed).toBeCloseTo(3500, 3);
    expect(open).toBeCloseTo(2750, 3);
    expect(closed - open).toBeCloseTo(750, 3); // length of the closing edge
  });

  it("degenerate cases (fewer than 3 points → area = 0; fewer than 2 → perimeter = 0)", () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([CORNERS_CCW[0]])).toBe(0);
    expect(polygonArea([CORNERS_CCW[0], CORNERS_CCW[1]])).toBe(0); // 2 pts = line
    expect(perimeter([])).toBe(0);
    expect(perimeter([CORNERS_CCW[0]])).toBe(0);
    // 2-point "polygon" degenerates to a line measured twice (there and back)
    // → perimeter = 2 × distance.
    expect(perimeter([CORNERS_CCW[0], CORNERS_CCW[1]])).toBeCloseTo(2000, 3);
  });

  it("measurement functions are pure / deterministic", () => {
    // Same input → byte-identical output. No Date.now(), no Math.random().
    expect(distance(CORNERS_CCW[0], CORNERS_CCW[1])).toBe(
      distance(CORNERS_CCW[0], CORNERS_CCW[1]),
    );
    expect(polygonArea(CORNERS_CCW)).toBe(polygonArea(CORNERS_CCW));
    expect(perimeter(CORNERS_CCW)).toBe(perimeter(CORNERS_CCW));
  });
});
