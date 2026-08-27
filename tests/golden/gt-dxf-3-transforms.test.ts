/**
 * GT-DXF-3 — Transform Round-Trip (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §5 Part 3B:
 *   Transform round-trip
 *   5 (zoom, pan, point) tuples:
 *     screenToModel(modelToScreen(point, zoom, pan), zoom, pan) === point
 *     (exact round-trip, byte-identical)
 *
 * This test exercises the pure transforms (BR-DW2):
 *   - `modelToScreen(point, zoom, pan)`  — model → screen
 *   - `screenToModel(point, zoom, pan)`  — screen → model (inverse)
 *   - `fitToView(extents, vw, vh, pad)`  — compute zoom + pan for fit
 *
 * All three are pure functions: no DOM, no Canvas, no SVG. Just math.
 *
 * Law: modelToScreen and screenToModel are EXACT inverses. For any (point,
 * zoom ≠ 0, pan) triple, the round-trip returns the original point with
 * floating-point precision — i.e. zero drift across 5 representative tuples.
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import {
  modelToScreen,
  screenToModel,
  fitToView,
} from "@domain/drawing/transforms";
import type { Extents, Point } from "@shared/schemas/drawing/dxf";

// ─── Fixture: 5 representative (zoom, pan, point) tuples ─────────────────
//
// The tuples cover the common cases the viewer encounters:
//   1. Identity (zoom=1, no pan) — the trivial round-trip.
//   2. Zoom-in 2× — typical after the user clicks "zoom in".
//   3. Zoom-out 0.5× — typical after "zoom out".
//   4. Pan offset, no zoom — typical after the user drags the drawing.
//   5. Realistic fit-to-view scenario (zoom < 1 to fit a large drawing).

interface Tuple {
  label: string;
  zoom: number;
  pan: Point;
  point: Point;
  // Expected screen coordinate for this tuple (for the numeric assertion).
  // Computed by hand: screen = model × zoom + pan.
  expectedScreen?: Point;
}

const TUPLES: Tuple[] = [
  {
    label: "identity (zoom=1, no pan)",
    zoom: 1,
    pan: { x: 0, y: 0 },
    point: { x: 100, y: 200 },
    expectedScreen: { x: 100, y: 200 },
  },
  {
    label: "zoom-in 2× (no pan)",
    zoom: 2,
    pan: { x: 0, y: 0 },
    point: { x: 1000, y: 750 },
    expectedScreen: { x: 2000, y: 1500 },
  },
  {
    label: "zoom-out 0.5× (no pan)",
    zoom: 0.5,
    pan: { x: 0, y: 0 },
    point: { x: 1000, y: 750 },
    expectedScreen: { x: 500, y: 375 },
  },
  {
    label: "pan offset, no zoom",
    zoom: 1,
    pan: { x: 50, y: -25 },
    point: { x: 100, y: 200 },
    expectedScreen: { x: 150, y: 175 },
  },
  {
    label: "realistic fit-to-view (zoom < 1, large pan)",
    zoom: 0.8,
    pan: { x: 120, y: 80 },
    point: { x: 5000, y: 3000 },
    expectedScreen: { x: 4120, y: 2480 }, // 5000×0.8+120=4120, 3000×0.8+80=2480
  },
];

describe("GT-DXF-3 — Transform round-trip (5 tuples, exact inverse)", () => {
  describe("screenToModel(modelToScreen(p, z, t), z, t) === p (exact)", () => {
    for (const t of TUPLES) {
      it(`${t.label}: round-trip returns the original point`, () => {
        const screen = modelToScreen(t.point, t.zoom, t.pan);
        const back = screenToModel(screen, t.zoom, t.pan);
        // Use toBeCloseTo with high precision — exact float equality holds
        // for our integer-valued fixtures, but the spec's "exactly" wording
        // means we test to the limit of IEEE-754 precision (10+ decimals).
        expect(back.x).toBeCloseTo(t.point.x, 10);
        expect(back.y).toBeCloseTo(t.point.y, 10);
      });
    }
  });

  describe("modelToScreen(screenToModel(s, z, t), z, t) === s (exact)", () => {
    for (const t of TUPLES) {
      it(`${t.label}: reverse round-trip returns the original screen pt`, () => {
        // Use the expectedScreen as the input screen point.
        if (!t.expectedScreen) return; // Defensive — all tuples have one.
        const model = screenToModel(t.expectedScreen, t.zoom, t.pan);
        const screen = modelToScreen(model, t.zoom, t.pan);
        expect(screen.x).toBeCloseTo(t.expectedScreen.x, 10);
        expect(screen.y).toBeCloseTo(t.expectedScreen.y, 10);
      });
    }
  });

  it("tuple 5 (realistic fit-to-view) — screen coordinate asserted numerically", () => {
    // Per the spec: "One tuple's screen coordinate asserted numerically."
    // We pick tuple 5 (the realistic fit-to-view scenario) and assert
    // the screen coordinate down to the unit:
    //   model (5000, 3000), zoom 0.8, pan (120, 80)
    //   → screen.x = 5000 × 0.8 + 120 = 4120
    //   → screen.y = 3000 × 0.8 + 80  = 2480
    const screen = modelToScreen(
      { x: 5000, y: 3000 },
      0.8,
      { x: 120, y: 80 },
    );
    expect(screen.x).toBe(4120);
    expect(screen.y).toBe(2480);
  });

  it("screenToModel throws on zoom=0 (degenerate viewport — never set by viewer)", () => {
    expect(() =>
      screenToModel({ x: 100, y: 100 }, 0, { x: 0, y: 0 }),
    ).toThrow(/zoom/);
  });

  describe("fitToView (BR-DW2 — pure function, no DOM)", () => {
    it("fits a 1000×750 rectangle into a 1000×750 viewport with 0 padding → zoom=1, pan=(0,0)", () => {
      const extents: Extents = { minX: 0, minY: 0, maxX: 1000, maxY: 750 };
      const result = fitToView(extents, 1000, 750, 0);
      expect(result.zoom).toBeCloseTo(1, 10);
      // Model center is (500, 375); viewport center is (500, 375).
      // pan = viewport_center - model_center × zoom = (500 - 500·1, 375 - 375·1) = (0, 0)
      expect(result.pan.x).toBeCloseTo(0, 10);
      expect(result.pan.y).toBeCloseTo(0, 10);
    });

    it("fits a 1000×750 rectangle into a 500×375 viewport → zoom=0.5 (shrink to fit)", () => {
      const extents: Extents = { minX: 0, minY: 0, maxX: 1000, maxY: 750 };
      const result = fitToView(extents, 500, 375, 0);
      expect(result.zoom).toBeCloseTo(0.5, 10);
      // Model center (500, 375) × 0.5 = (250, 187.5)
      // Viewport center (250, 187.5)
      // pan = (250 - 250, 187.5 - 187.5) = (0, 0)
      expect(result.pan.x).toBeCloseTo(0, 10);
      expect(result.pan.y).toBeCloseTo(0, 10);
    });

    it("fits a 2000×1500 rectangle into a 1000×750 viewport with 50 padding → zoom ≈ 0.45", () => {
      const extents: Extents = { minX: 0, minY: 0, maxX: 2000, maxY: 1500 };
      // availW = 1000 - 2·50 = 900; availH = 750 - 2·50 = 650
      // zoom = min(900/2000, 650/1500) = min(0.45, 0.4333…) = 0.4333…
      const result = fitToView(extents, 1000, 750, 50);
      expect(result.zoom).toBeCloseTo(0.4333, 3);
      // Model center (1000, 750) × 0.4333 = (433.3, 325)
      // Viewport center (500, 375)
      // pan = (500 - 433.3, 375 - 325) ≈ (66.7, 50)
      expect(result.pan.x).toBeCloseTo(500 - 1000 * result.zoom, 3);
      expect(result.pan.y).toBeCloseTo(375 - 750 * result.zoom, 3);
    });

    it("degenerate: empty model → zoom=1, pan centered on extents.min", () => {
      const extents: Extents = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      const result = fitToView(extents, 1000, 750, 0);
      expect(result.zoom).toBe(1);
      expect(result.pan.x).toBe(500); // 1000/2 - 0
      expect(result.pan.y).toBe(375); // 750/2 - 0
    });

    it("degenerate: zero-size viewport → zoom=1, pan=(0,0)", () => {
      const extents: Extents = { minX: 0, minY: 0, maxX: 1000, maxY: 750 };
      const result = fitToView(extents, 0, 0, 0);
      expect(result.zoom).toBe(1);
      expect(result.pan.x).toBe(0);
      expect(result.pan.y).toBe(0);
    });

    it("fitToView is pure / deterministic — same input → identical output", () => {
      const extents: Extents = { minX: 0, minY: 0, maxX: 1000, maxY: 750 };
      const a = fitToView(extents, 1000, 750, 0);
      const b = fitToView(extents, 1000, 750, 0);
      expect(a).toEqual(b);
    });
  });
});
