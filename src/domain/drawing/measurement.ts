/**
 * Drawing Measurement — pure measurement functions (BR-DW2).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (pure TypeScript, no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * These are the measurement tools the viewer exposes to the user (the
 * "measure distance" / "measure area" / "measure perimeter" buttons in
 * the toolbar). They take model-space points (already converted from
 * screen-space by `screenToModel` in transforms.ts) and return a number in
 * the drawing's units (mm, m, etc. — BR-DW1).
 *
 *   - `distance(p1, p2)`      — Euclidean distance between two points.
 *   - `polygonArea(points)`   — polygon area via the shoelace formula.
 *   - `perimeter(points)`     — sum of edge lengths (closed polygon).
 *
 * The shoelace formula (Gauss's area formula) gives the signed area of a
 * simple polygon:
 *
 *     A = 1/2 × |Σ (x_i × y_{i+1} − x_{i+1} × y_i)|
 *
 * For a counter-clockwise polygon the sum is positive; for clockwise it is
 * negative — we return the absolute value so the user always sees a
 * positive area regardless of drawing orientation.
 *
 * For `perimeter`, the polygon is treated as CLOSED — the last point
 * connects back to the first. (Callers measuring an open polyline should
 * subtract the closing edge length themselves, or call `polylineLength`
 * which is the same function with closure disabled.)
 *
 * Law (golden tests are authoritative — tests/golden/gt-dxf-2-measurements.test.ts):
 *   - Fixture A (the 1000×750 rectangle from GT-DXF-1):
 *     - Distance (0,0)→(1000,0) = 1000.000
 *     - Polygon area           = 750,000.00  (1000 × 750)
 *     - Perimeter              = 3500.000    (2 × 1000 + 2 × 750)
 */

import type { Point } from "@shared/schemas/drawing/dxf";

// ─── Pure measurement functions ──────────────────────────────────────────

/**
 * Euclidean distance between two points in 2D model space.
 *
 *   d = √((x2−x1)² + (y2−y1)²)
 *
 * @returns The distance, in the drawing's units (mm, m, etc.).
 *          Always non-negative.
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Polygon area via the shoelace (Gauss) formula.
 *
 *   A = 1/2 × |Σ (x_i × y_{i+1} − x_{i+1} × y_i)|
 *
 * The polygon is treated as CLOSED — the last vertex connects back to the
 * first automatically. Callers do NOT need to repeat the first point.
 *
 * Edge cases:
 *   - Fewer than 3 points → area = 0 (a polygon needs 3+ vertices).
 *   - Collinear / self-intersecting polygons: the formula still computes a
 *     signed area, but the geometric meaning is undefined for self-
 *     intersecting inputs. The absolute value is returned regardless.
 *
 * @param points Ordered polygon vertices (CCW or CW — returns absolute area).
 * @returns The polygon's area, in the drawing's units squared (mm², m²).
 *          Always non-negative.
 */
export function polygonArea(points: Point[]): number {
  const n = points.length;
  if (n < 3) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; // Wrap-around — closes the polygon.
    sum += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Perimeter (closed polygon) — the sum of edge lengths INCLUDING the closing
 * edge from the last vertex back to the first.
 *
 *   P = Σ |p_{i+1} − p_i|  for i = 0..n-1 (with p_n = p_0)
 *
 * For an OPEN polyline (no closing edge), call `polylineLength` instead.
 *
 * @param points Polygon vertices (treated as closed — closing edge included).
 * @returns The perimeter, in the drawing's units.
 */
export function perimeter(points: Point[]): number {
  const n = points.length;
  if (n < 2) return 0;

  let total = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; // Wrap-around — includes the closing edge.
    total += distance(points[i], points[j]);
  }
  return total;
}

/**
 * Polyline length (open polyline) — the sum of edge lengths from first to
 * last vertex, WITHOUT a closing edge.
 *
 *   L = Σ |p_{i+1} − p_i|  for i = 0..n-2
 *
 * Useful when measuring an open path (e.g. a single wall segment chain that
 * doesn't close back on itself). For a closed polygon's perimeter, use
 * `perimeter(points)` instead.
 *
 * @param points Polyline vertices (open — no closing edge).
 * @returns The polyline's length, in the drawing's units.
 */
export function polylineLength(points: Point[]): number {
  const n = points.length;
  if (n < 2) return 0;

  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    total += distance(points[i], points[i + 1]);
  }
  return total;
}
