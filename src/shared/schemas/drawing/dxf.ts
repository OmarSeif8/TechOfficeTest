/**
 * DXF — zod schemas for parsed DXF entities + drawing aggregate.
 *
 * Lives in src/shared/schemas/drawing/ (lowest layer).
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma,
 * fs, path, electron, etc. Only `zod` and other `@shared/*` self-references.
 *
 * This is the **typed** shape of the data that the DXF domain layer exposes to
 * the rest of the application (UI, API routes, infrastructure). It mirrors the
 * loosely-typed output of the upstream `dxf` npm package
 * (https://www.npmjs.com/package/dxf — bjnortier, MIT) — see
 * `src/domain/drawing/dxf-parser.ts` for the adapter that converts the
 * upstream `{ type, start, end, layer, ... }` shape into the discriminated
 * union declared here.
 *
 * Per SPEC_PHASE3_WEB.md Part 3B §2 (Entity Support Matrix):
 *   - Must render:   LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE,
 *                    TEXT, POINT, INSERT + BLOCK definitions
 *   - Best-effort:   MTEXT, DIMENSION, SPLINE
 *   - Graceful skip: HATCH, 3DSOLID, custom/proxy entities (not in this union)
 *
 * Per BR-DW1: $INSUNITS → unit label (4=mm, 6=m, etc.); absent → null
 *             (UI prompts the user).
 * Per BR-DW2: Screen↔model transforms are pure functions — see transforms.ts.
 * Per BR-DW3: Layer visibility filtering is a pure function — see layers.ts.
 *
 * Golden tests are authoritative — see tests/golden/gt-dxf-*.test.ts.
 */

import { z } from "zod";

// ─── Shared primitives ───────────────────────────────────────────────────

/**
 * A 2D point in model space. The DXF spec defines points as triples (X, Y, Z)
 * — but every entity we render in the viewer is planar (Z=0 is the model plane).
 * The domain layer therefore works in 2D to keep the math simple and the
 * browser viewport agnostic.
 *
 * `x` and `y` are model-space coordinates in the drawing's units (e.g. mm, m).
 * They are plain `number` values — no string / Decimal wrapper is needed here
 * because no money math is performed on coordinates (cf. boq/totals.ts BR-1).
 */
export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Point = z.infer<typeof PointSchema>;

/**
 * Bounding box in model space — the min/max X/Y across a set of entities.
 * Used by `fitToView` to compute the initial zoom + pan that frames the drawing.
 *
 * An empty drawing (no entities, or all entities have no geometry) yields
 * `minX = minY = maxX = maxY = 0` — a degenerate "single point" box that
 * `fitToView` treats as a single-pixel target.
 */
export const ExtentsSchema = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
});
export type Extents = z.infer<typeof ExtentsSchema>;

// ─── Entity schemas (discriminated union by `type`) ──────────────────────
//
// Each entity carries a `type` discriminant and a `layer` string (DXF group
// code 8). The shape of the geometry is type-specific — e.g. LINE has
// `start` + `end`, CIRCLE has `center` + `radius`, etc.
//
// These schemas describe ONLY the geometry the viewer consumes — they do not
// model every DXF group code. Fields not relevant to rendering (extrusion
// direction, plot style, etc.) are dropped by the parser.

/** LINE — straight segment from `start` to `end` (DXF codes 10/20 → 11/21). */
export const DxfLineEntitySchema = z.object({
  type: z.literal("LINE"),
  layer: z.string(),
  start: PointSchema,
  end: PointSchema,
});

/** CIRCLE — full circle (DXF codes 10/20 → center, 40 → radius). */
export const DxfCircleEntitySchema = z.object({
  type: z.literal("CIRCLE"),
  layer: z.string(),
  center: PointSchema,
  radius: z.number().nonnegative(),
});

/**
 * ARC — partial circle (DXF codes 10/20 → center, 40 → radius,
 * 50 → startAngle, 51 → endAngle).
 *
 * Angles are stored in **radians** (the `dxf` upstream package converts DXF's
 * degree-valued group codes 50/51 into radians on parse — see arc.js handler).
 * 0 rad = +X axis, sweep counter-clockwise.
 */
export const DxfArcEntitySchema = z.object({
  type: z.literal("ARC"),
  layer: z.string(),
  center: PointSchema,
  radius: z.number().nonnegative(),
  startAngle: z.number(),
  endAngle: z.number(),
});

/**
 * LWPOLYLINE — lightweight polyline (a single entity with N vertices).
 *
 * `vertices` is the ordered list of (x, y) points. `closed` is true iff the
 * DXF group code 70 has bit 1 set (e.g. 70=1 means closed).
 *
 * `bulge` (DXF code 42) is optional per-vertex arc bulge: 0 = straight segment
 * to next vertex; non-zero = arc with the given bulge factor. Stored as
 * optional per-vertex for fidelity; rendering flattens to line segments.
 */
export const DxfVertexSchema = z.object({
  x: z.number(),
  y: z.number(),
  bulge: z.number().optional(),
});
export const DxfLwpolylineEntitySchema = z.object({
  type: z.literal("LWPOLYLINE"),
  layer: z.string(),
  vertices: z.array(DxfVertexSchema),
  closed: z.boolean(),
});

/**
 * POLYLINE (legacy) — a header entity followed by VERTEX sub-entities. The
 * `dxf` upstream package flattens these into the same `vertices` shape as
 * LWPOLYLINE; we model them identically here so the renderer can treat both
 * kinds uniformly.
 */
export const DxfPolylineEntitySchema = z.object({
  type: z.literal("POLYLINE"),
  layer: z.string(),
  vertices: z.array(DxfVertexSchema),
  closed: z.boolean(),
});

/** TEXT — single-line text (DXF codes 10/20 → insertion point, 1 → string,
 *         40 → height, 50 → rotation in radians). */
export const DxfTextEntitySchema = z.object({
  type: z.literal("TEXT"),
  layer: z.string(),
  position: PointSchema,
  text: z.string(),
  height: z.number(),
  rotation: z.number().default(0),
});

/** POINT — a single point (DXF codes 10/20). */
export const DxfPointEntitySchema = z.object({
  type: z.literal("POINT"),
  layer: z.string(),
  position: PointSchema,
});

/**
 * INSERT — a block reference (DXF codes 2 → block name, 10/20 → insertion
 * point, 41/42 → X/Y scale, 50 → rotation in radians).
 *
 * The block definition itself lives in the `blocks` section of the parsed DXF
 * and is rendered separately by the viewer. The INSERT entity just places
 * one occurrence at `position` with the given scale + rotation.
 */
export const DxfInsertEntitySchema = z.object({
  type: z.literal("INSERT"),
  layer: z.string(),
  block: z.string(),
  position: PointSchema,
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
  rotation: z.number().default(0),
});

/** ELLIPSE — DXF codes 10/20 → center, 11/21 → major axis endpoint, 40 →
 *  minor/major ratio, 41 → start angle, 42 → end angle (both radians). */
export const DxfEllipseEntitySchema = z.object({
  type: z.literal("ELLIPSE"),
  layer: z.string(),
  center: PointSchema,
  majorAxisEnd: PointSchema,
  ratio: z.number(),
  startAngle: z.number().default(0),
  endAngle: z.number().default(2 * Math.PI),
});

/** SPLINE — NURBS curve (best-effort — vertices + degree + knots). */
export const DxfSplineEntitySchema = z.object({
  type: z.literal("SPLINE"),
  layer: z.string(),
  controlPoints: z.array(PointSchema),
  degree: z.number().int().nonnegative().default(3),
  knots: z.array(z.number()).default([]),
  closed: z.boolean().default(false),
});

/** MTEXT — multi-line text (best-effort — same shape as TEXT). */
export const DxfMtextEntitySchema = z.object({
  type: z.literal("MTEXT"),
  layer: z.string(),
  position: PointSchema,
  text: z.string(),
  height: z.number(),
  rotation: z.number().default(0),
});

/** DIMENSION — best-effort: only the dimension's defining points + text. */
export const DxfDimensionEntitySchema = z.object({
  type: z.literal("DIMENSION"),
  layer: z.string(),
  start: PointSchema,
  end: PointSchema,
  position: PointSchema,
  text: z.string().default(""),
});

/**
 * DxfEntity — discriminated union of every entity the viewer supports.
 *
 * The `type` field is the discriminant — TypeScript narrows on it, so a
 * `switch (entity.type) { case "LINE": ... }` is exhaustive.
 *
 * Per SPEC_PHASE3_WEB.md §2: HATCH, 3DSOLID, and other "graceful skip"
 * entities are NOT in this union — the parser silently drops them (BR-DW2
 * pure function — graceful, no throw).
 */
export const DxfEntitySchema = z.discriminatedUnion("type", [
  DxfLineEntitySchema,
  DxfCircleEntitySchema,
  DxfArcEntitySchema,
  DxfLwpolylineEntitySchema,
  DxfPolylineEntitySchema,
  DxfTextEntitySchema,
  DxfPointEntitySchema,
  DxfInsertEntitySchema,
  DxfEllipseEntitySchema,
  DxfSplineEntitySchema,
  DxfMtextEntitySchema,
  DxfDimensionEntitySchema,
]);
export type DxfEntity = z.infer<typeof DxfEntitySchema>;

// ─── Layer + header schemas ──────────────────────────────────────────────

/**
 * DxfLayer — one row from the DXF TABLES/LAYER section.
 *
 * `color` is the DXF color number (group code 62). The conventional mapping
 * is: 1=red, 2=yellow, 3=green, 4=cyan, 5=blue, 6=magenta, 7=white/black,
 * 256=BYLAYER. Negative = layer is OFF (DXF convention).
 *
 * `visible` is derived from `color` (≥ 0) and the layer's `flags` (bit 1 =
 * frozen — also treated as not visible). When the LAYER TABLE is absent
 * entirely, the default layer "0" is assumed visible with color 7.
 */
export const DxfLayerSchema = z.object({
  name: z.string(),
  color: z.number().int(),
  visible: z.boolean(),
});
export type DxfLayer = z.infer<typeof DxfLayerSchema>;

/**
 * DxfHeader — drawing-wide metadata from the HEADER section.
 *
 * `insUnits` is the DXF $INSUNITS value (group code 70 inside $INSUNITS):
 *   - 1 = inches; 2 = feet; 4 = millimeters; 5 = centimeters;
 *     6 = meters; 13 = kilometers; 14 = microinches; etc.
 * Per BR-DW1: absent header → `null` → UI prompts the user for units.
 *
 * `extents` is the drawing's bounding box — either from the $EXTMIN/$EXTMAX
 * header variables (when present and trustworthy) OR computed from the actual
 * entity geometry by `calculateExtents` in dxf-parser.ts. The parser
 * recomputes extents by default to avoid trusting stale header metadata.
 */
export const DxfHeaderSchema = z.object({
  insUnits: z.number().int().nullable(),
  extents: ExtentsSchema,
});
export type DxfHeader = z.infer<typeof DxfHeaderSchema>;

/**
 * DxfDrawing — the top-level aggregate consumed by the viewer.
 *
 *   entities: every supported entity, in source order
 *   layers:   every layer declared in the TABLES/LAYER section
 *   header:   drawing-wide metadata (units + extents)
 *
 * The viewer renders `entities` (after layer filtering — BR-DW3) and uses
 * `header.extents` to compute the initial zoom + pan (BR-DW2 `fitToView`).
 */
export const DxfDrawingSchema = z.object({
  entities: z.array(DxfEntitySchema),
  layers: z.array(DxfLayerSchema),
  header: DxfHeaderSchema,
});
export type DxfDrawing = z.infer<typeof DxfDrawingSchema>;
