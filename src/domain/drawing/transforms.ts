/**
 * Drawing Transforms — pure screen↔model coordinate transforms (BR-DW2).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (pure TypeScript, no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *   - MUST NOT import any DOM/Canvas/SVG APIs — just math.
 *
 * The viewer's zoom/pan state lives entirely in `{ zoom, pan }`. The
 * transform applied to a model-space point is:
 *
 *     screen = model × zoom + pan        (modelToScreen)
 *     model = (screen − pan) / zoom       (screenToModel)
 *
 * - `zoom` is a positive scale factor (1 = no zoom; 2 = 200%; 0.5 = 50%).
 * - `pan` is a SCREEN-space offset (in CSS pixels) that shifts where the
 *   model origin lands on the viewport.
 *
 * Both functions are exact inverses:
 *
 *     screenToModel(modelToScreen(p, z, t), z, t) === p
 *     modelToScreen(screenToModel(s, z, t), z, t) === s
 *
 * ...as long as `zoom ≠ 0`. (zoom === 0 is degenerate and never set by the
 * viewer — `fitToView` always produces a positive zoom.)
 *
 * `fitToView` computes the (zoom, pan) pair that frames a given model-space
 * bounding box inside a screen-space viewport of size `viewportWidth ×
 * viewportHeight`, with `padding` CSS pixels of breathing room on all sides.
 *
 * Law (golden tests are authoritative — tests/golden/gt-dxf-3-transforms.test.ts):
 *   - 5 (zoom, pan, point) tuples: round-trip returns the original exactly.
 *   - One tuple's screen coordinate asserted numerically.
 */

import type { Extents, Point } from "@shared/schemas/drawing/dxf";

// ─── Pure transforms ──────────────────────────────────────────────────────

/**
 * Transform a model-space point to screen-space (CSS pixels).
 *
 *   screen.x = model.x × zoom + pan.x
 *   screen.y = model.y × zoom + pan.y
 *
 * Note: in a typical SVG / Canvas setup the screen Y axis points DOWNWARD,
 * while the model Y axis in DXF points UPWARD. The renderer flips Y at the
 * SVG/Canvas level (via `transform` or a CSS `scaleY(-1)`) — these pure
 * transforms deliberately DO NOT do that flip, so the math stays linear and
 * the flip is the renderer's concern (the only place that touches the DOM).
 *
 * @param point Model-space point.
 * @param zoom  Positive scale factor.
 * @param pan   Screen-space offset in pixels.
 * @returns Screen-space point (CSS pixels).
 */
export function modelToScreen(point: Point, zoom: number, pan: Point): Point {
  return {
    x: point.x * zoom + pan.x,
    y: point.y * zoom + pan.y,
  };
}

/**
 * Transform a screen-space point back to model-space.
 *
 *   model.x = (screen.x − pan.x) / zoom
 *   model.y = (screen.y − pan.y) / zoom
 *
 * This is the inverse of `modelToScreen`. Used by click-to-measure / pick
 * interactions: the user clicks at screen (px, py), the viewer translates
 * that back to model coordinates so measurements display in drawing units.
 *
 * @param point Screen-space point (CSS pixels).
 * @param zoom  Positive scale factor (must be non-zero).
 * @param pan   Screen-space offset.
 * @returns Model-space point.
 * @throws {Error} if zoom is 0 (degenerate — viewer never sets this).
 */
export function screenToModel(point: Point, zoom: number, pan: Point): Point {
  if (zoom === 0) {
    throw new Error(
      "screenToModel: zoom must be non-zero (degenerate viewport state)",
    );
  }
  return {
    x: (point.x - pan.x) / zoom,
    y: (point.y - pan.y) / zoom,
  };
}

/**
 * Compute the (zoom, pan) that fits a model-space bounding box inside a
 * screen-space viewport.
 *
 * Algorithm:
 *   1. Compute the model-space width / height from `extents`.
 *      - Empty/degenerate box (width = height = 0) → zoom = 1, pan = center.
 *   2. Available viewport size = viewport size − 2 × padding on each axis.
 *   3. zoom = min(availW / modelW, availH / modelH) — the largest scale that
 *      keeps both axes inside the viewport.
 *   4. pan = viewport center − model center × zoom — centers the model in
 *      the viewport.
 *
 * Edge cases:
 *   - Degenerate viewport (width ≤ 0 OR height ≤ 0): zoom = 1, pan = (0, 0).
 *   - Negative padding is clamped to 0 (defensive — never trust the caller).
 *   - Model with zero width AND zero height (a single point): zoom = 1,
 *     pan = viewport center (the point sits at the center of the viewport).
 *
 * Pure function: no I/O, no DOM. The viewer calls this on every "fit" action
 * (initial load, fit-to-view button, reset).
 *
 * @param extents        Model-space bounding box.
 * @param viewportWidth  CSS pixel width of the viewport (≥ 0).
 * @param viewportHeight CSS pixel height of the viewport (≥ 0).
 * @param padding        CSS pixels of padding on each side (≥ 0).
 * @returns `{ zoom, pan }` ready to feed to modelToScreen / screenToModel.
 */
export function fitToView(
  extents: Extents,
  viewportWidth: number,
  viewportHeight: number,
  padding: number,
): { zoom: number; pan: Point } {
  const pad = Math.max(0, padding);
  const vw = Math.max(0, viewportWidth);
  const vh = Math.max(0, viewportHeight);

  const modelW = extents.maxX - extents.minX;
  const modelH = extents.maxY - extents.minY;

  const availW = Math.max(0, vw - 2 * pad);
  const availH = Math.max(0, vh - 2 * pad);

  // Degenerate viewport — return identity-ish.
  if (vw <= 0 || vh <= 0) {
    return { zoom: 1, pan: { x: 0, y: 0 } };
  }

  // Single-point or empty model — center the origin in the viewport.
  if (modelW === 0 && modelH === 0) {
    return {
      zoom: 1,
      pan: { x: vw / 2 - extents.minX, y: vh / 2 - extents.minY },
    };
  }

  // Avoid divide-by-zero when only one dimension is degenerate. We use the
  // non-zero dimension as the limit; the other axis is "free" (no constraint).
  let zoom: number;
  if (modelW <= 0) {
    zoom = availH / modelH;
  } else if (modelH <= 0) {
    zoom = availW / modelW;
  } else {
    zoom = Math.min(availW / modelW, availH / modelH);
  }

  // Guard against zero/negative zoom from extreme padding (availW/H = 0).
  if (!Number.isFinite(zoom) || zoom <= 0) {
    zoom = 1;
  }

  // Center the model's bounding box inside the viewport.
  const modelCenterX = extents.minX + modelW / 2;
  const modelCenterY = extents.minY + modelH / 2;
  const pan: Point = {
    x: vw / 2 - modelCenterX * zoom,
    y: vh / 2 - modelCenterY * zoom,
  };

  return { zoom, pan };
}
