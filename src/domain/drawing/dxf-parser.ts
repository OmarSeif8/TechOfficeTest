/**
 * DXF Parser Domain — pure parsing of DXF ASCII text into a typed DxfDrawing.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* and the `dxf` npm package (bjnortier, MIT — a
 *     pure TypeScript library, no platform dependencies).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Architecture (per SPEC_PHASE3_WEB.md Part 3B §3):
 *   - This function is the only place in the codebase that knows about the
 *     upstream `dxf` package's output shape. It wraps that shape with our
 *     typed `DxfDrawing` / `DxfEntity` discriminated union.
 *   - The API route (server-side) calls `parseDxf` and returns the typed
 *     result to the client. The client never imports the `dxf` package.
 *
 * Per SPEC_PHASE3_WEB.md Part 3B §2 (Entity Support Matrix):
 *   - Must render:   LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE,
 *                    TEXT, POINT, INSERT + BLOCK definitions
 *   - Best-effort:   MTEXT, DIMENSION, SPLINE  (still extracted; viewer may
 *                    degrade gracefully on these)
 *   - Graceful skip: HATCH, 3DSOLID, custom/proxy entities
 *                    (silently dropped — not present in the typed union)
 *
 * Per BR-DW1: $INSUNITS → unit label (4=mm, 6=m, etc.); absent → null.
 * Per BR-DW2: Extents are computed from entity geometry — pure math, no DOM.
 *
 * Law (golden tests are authoritative — tests/golden/gt-dxf-1-parse.test.ts):
 *   - Fixture A: 4 LINEs forming a 1000×750 rectangle
 *     → 4 LINE entities, extents min (0,0) max (1000,750)
 */

import { parseString } from "dxf";
import type {
  DxfEntity,
  DxfHeader,
  DxfLayer,
  Extents,
  Point,
} from "@shared/schemas/drawing/dxf";
import { unitFromInsUnits } from "@domain/drawing/units";

// ─── Upstream `dxf` package — minimal type surface ──────────────────────
//
// The `dxf` package (v5.x) is shipped as plain JS with no bundled type
// declarations. We declare the minimum surface we consume here, so the
// adapter stays compile-checked. The actual runtime shape is verified by
// `parseString`'s source (see node_modules/dxf/src/parseString.js +
// src/handlers/entity/*.js).

interface RawPoint {
  x?: number;
  y?: number;
  z?: number;
}

interface RawEntity {
  type: string;
  layer?: string;
  // LINE
  start?: RawPoint;
  end?: RawPoint;
  // CIRCLE / ARC
  x?: number;
  y?: number;
  z?: number;
  r?: number;
  startAngle?: number;
  endAngle?: number;
  // LWPOLYLINE / POLYLINE
  vertices?: Array<{ x: number; y: number; bulge?: number }>;
  closed?: boolean;
  // TEXT / MTEXT
  text?: string;
  height?: number;
  rotation?: number;
  startPoint?: RawPoint;
  endPoint?: RawPoint;
  // INSERT
  block?: string;
  name?: string;
  scaleX?: number;
  scaleY?: number;
  scale?: number;
  // SPLINE
  controlPoints?: RawPoint[];
  degree?: number;
  knots?: number[];
  // ELLIPSE
  ratio?: number;
  majorX?: number;
  majorY?: number;
  majorAxis?: RawPoint;
  majorAxisEndPoint?: RawPoint;
  // DIMENSION
  dimensionText?: string;
  // Common
  colorNumber?: number;
  visible?: boolean;
  // Unmodeled fields are ignored.
  [key: string]: unknown;
}

interface RawLayer {
  type: "LAYER";
  name: string;
  colorNumber?: number;
  flags?: number;
  lineTypeName?: string;
  lineWeightEnum?: number;
}

interface RawHeader {
  insUnits?: number;
  extMin?: RawPoint;
  extMax?: RawPoint;
  measurement?: number;
}

interface RawParsed {
  header: RawHeader;
  blocks: unknown[];
  entities: RawEntity[];
  objects: { layouts: unknown[] };
  tables: {
    layers: Record<string, RawLayer>;
    styles: Record<string, unknown>;
    vports: Record<string, unknown>;
    ltypes: Record<string, unknown>;
  };
}

export type ParsedDxf = RawParsed;

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Parse DXF ASCII text into the upstream `dxf` package's intermediate
 * representation (treated as opaque — only used as input to the typed
 * extractors below).
 *
 * This is the lowest-level entry point — useful when the caller wants to
 * inspect raw sections (e.g. for debugging, or to access fields not yet
 * modelled on `DxfDrawing`). For routine use, prefer `parseDrawing` which
 * returns the typed aggregate directly.
 *
 * Pure function: same input → byte-identical output. No I/O, no Date.now(),
 * no Math.random().
 *
 * @throws If the DXF text is so malformed that the upstream parser cannot
 *         tokenize it (rare — the package is very forgiving). The API
 *         route catches this and returns a 400.
 */
export function parseDxf(dxfText: string): ParsedDxf {
  // `parseString` is the upstream `dxf` package's main entry point.
  // It returns the intermediate representation described above.
  return parseString(dxfText) as unknown as ParsedDxf;
}

/**
 * Extract the typed entities from the parsed DXF, silently skipping any
 * entity type the viewer does not support (HATCH, 3DSOLID, custom objects).
 *
 * Returns entities in the order they appear in the DXF ENTITIES section.
 * Layer "0" is the implicit default when an entity has no group-code 8
 * (per the DXF spec — every entity without an explicit layer is on "0").
 *
 * Pure function. No throws on unsupported entity types — they are dropped.
 */
export function extractEntities(parsed: ParsedDxf): DxfEntity[] {
  const result: DxfEntity[] = [];
  for (const raw of parsed.entities ?? []) {
    const converted = convertEntity(raw);
    if (converted !== null) {
      result.push(converted);
    }
  }
  return result;
}

/**
 * Extract the layer list from the parsed DXF's TABLES section.
 *
 *   - Layer "0" is always present (DXF spec — the default layer).
 *   - Layers missing from the TABLES are NOT synthesized (except for "0").
 *   - `visible` is true iff the layer is not frozen AND not turned off.
 *     Per DXF: layer is OFF if `colorNumber < 0`; layer is FROZEN if bit 1
 *     of `flags` is set. Either condition → not visible.
 *   - The default color when `colorNumber` is absent is 7 (white/black).
 *
 * Pure function.
 */
export function extractLayers(parsed: ParsedDxf): DxfLayer[] {
  const rawLayers = parsed.tables?.layers ?? {};
  const result: DxfLayer[] = [];

  // Always include the default "0" layer — it's where entities without an
  // explicit layer code live. If the TABLES declares "0", we use that row
  // (preserving its color/visibility); otherwise we synthesize a default.
  const seenNames = new Set<string>();
  for (const raw of Object.values(rawLayers)) {
    const name = raw.name ?? "0";
    const colorNumber = raw.colorNumber ?? 7;
    const flags = raw.flags ?? 0;
    const visible = colorNumber >= 0 && (flags & 1) === 0;
    result.push({ name, color: colorNumber, visible });
    seenNames.add(name);
  }
  if (!seenNames.has("0")) {
    result.unshift({ name: "0", color: 7, visible: true });
  }
  return result;
}

/**
 * Compute the bounding box of a list of entities — pure function (BR-DW2).
 *
 * The bounding box is computed from the actual entity geometry, NOT from
 * the DXF $EXTMIN/$EXTMAX header. The header is sometimes stale (set by
 * the originating CAD application at last-save time, but the file may have
 * been edited since). Computing from geometry is always correct.
 *
 * For an empty entity list (or all entities with no geometry — e.g. only
 * POINT entities we don't model), returns the degenerate box
 * `{ minX: 0, minY: 0, maxX: 0, maxY: 0 }`. The viewer's `fitToView`
 * handles this gracefully.
 *
 * Pure function: no I/O, no DOM, no Date.now(), no Math.random().
 */
export function calculateExtents(entities: DxfEntity[]): Extents {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const e of entities) {
    const pts = entityExtremePoints(e);
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  // Empty / degenerate — return a zero-extent box at the origin.
  if (
    minX === Number.POSITIVE_INFINITY ||
    minY === Number.POSITIVE_INFINITY ||
    maxX === Number.NEGATIVE_INFINITY ||
    maxY === Number.NEGATIVE_INFINITY
  ) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Resolve the drawing's display unit from the parsed DXF's HEADER.
 *
 * Per BR-DW1: $INSUNITS → unit label (4=mm, 6=m, etc.); absent → null.
 * When the value is 0 ("Unspecified" in the DXF spec) we also return null
 * (same effect as absent — the UI must prompt the user).
 *
 * Pure function — delegates to the pure `unitFromInsUnits` lookup.
 */
export function unitFromHeader(header: DxfHeader): string | null {
  return unitFromInsUnits(header.insUnits);
}

/**
 * Build a full typed `DxfDrawing` from raw DXF text — convenience entry
 * point that runs the entire pipeline: parse → extract entities →
 * extract layers → compute extents → build header.
 *
 * Use this from the API route's GET handler.
 *
 * Pure function: same input → byte-identical output.
 */
export function parseDrawing(dxfText: string): {
  entities: DxfEntity[];
  layers: DxfLayer[];
  header: DxfHeader;
} {
  const parsed = parseDxf(dxfText);
  const entities = extractEntities(parsed);
  const layers = extractLayers(parsed);
  const extents = calculateExtents(entities);
  const insUnits = parsed.header?.insUnits ?? null;
  return {
    entities,
    layers,
    header: { insUnits, extents },
  };
}

// ─── Entity conversion ─────────────────────────────────────────────────

/**
 * Convert one upstream `dxf` entity into our typed `DxfEntity` union.
 *
 * Returns `null` for entity types not in our support matrix (HATCH, 3DSOLID,
 * ATTDEF, ATTRIB, VIEWPORT, OLE2FRAME, etc.) — they are silently dropped.
 *
 * Defensive: every numeric field is parsed via `num()` which treats
 * undefined / NaN as the entity-specific default (usually 0). This makes the
 * parser resilient to malformed DXF (e.g. a LINE missing its group-code 11).
 *
 * @internal
 */
function convertEntity(raw: RawEntity): DxfEntity | null {
  // Default layer — DXF spec: entities without group code 8 live on layer "0".
  const layer = (raw.layer ?? "0").toString();

  switch (raw.type) {
    case "LINE": {
      const start = pointFrom(raw.start) ?? { x: 0, y: 0 };
      const end = pointFrom(raw.end) ?? { x: 0, y: 0 };
      return { type: "LINE", layer, start, end };
    }
    case "CIRCLE": {
      const center = pointFromXY(raw) ?? { x: 0, y: 0 };
      const radius = num(raw.r, 0);
      return { type: "CIRCLE", layer, center, radius: Math.max(0, radius) };
    }
    case "ARC": {
      const center = pointFromXY(raw) ?? { x: 0, y: 0 };
      const radius = num(raw.r, 0);
      return {
        type: "ARC",
        layer,
        center,
        radius: Math.max(0, radius),
        startAngle: num(raw.startAngle, 0),
        endAngle: num(raw.endAngle, 2 * Math.PI),
      };
    }
    case "LWPOLYLINE": {
      const vertices = (raw.vertices ?? []).map((v) => ({
        x: num(v.x, 0),
        y: num(v.y, 0),
        ...(v.bulge !== undefined ? { bulge: num(v.bulge, 0) } : {}),
      }));
      return {
        type: "LWPOLYLINE",
        layer,
        vertices,
        closed: Boolean(raw.closed),
      };
    }
    case "POLYLINE": {
      const vertices = (raw.vertices ?? []).map((v) => ({
        x: num(v.x, 0),
        y: num(v.y, 0),
        ...(v.bulge !== undefined ? { bulge: num(v.bulge, 0) } : {}),
      }));
      return {
        type: "POLYLINE",
        layer,
        vertices,
        closed: Boolean(raw.closed),
      };
    }
    case "TEXT": {
      return {
        type: "TEXT",
        layer,
        position: pointFrom(raw.startPoint) ?? pointFromXY(raw) ?? { x: 0, y: 0 },
        text: String(raw.text ?? ""),
        height: num(raw.height, 1),
        rotation: num(raw.rotation, 0),
      };
    }
    case "POINT": {
      return {
        type: "POINT",
        layer,
        position: pointFromXY(raw) ?? pointFrom(raw.startPoint) ?? { x: 0, y: 0 },
      };
    }
    case "INSERT": {
      // `dxf` upstream uses `block` for the block name; older drafts used `name`.
      const block = String(raw.block ?? raw.name ?? "");
      return {
        type: "INSERT",
        layer,
        block,
        position: pointFromXY(raw) ?? { x: 0, y: 0 },
        scaleX: num(raw.scaleX ?? raw.scale, 1),
        scaleY: num(raw.scaleY ?? raw.scale, 1),
        rotation: num(raw.rotation, 0),
      };
    }
    case "ELLIPSE": {
      const majorAxisEnd =
        pointFrom(raw.majorAxisEndPoint) ??
        pointFrom(raw.majorAxis) ??
        { x: raw.majorX ?? 0, y: raw.majorY ?? 0 };
      return {
        type: "ELLIPSE",
        layer,
        center: pointFromXY(raw) ?? { x: 0, y: 0 },
        majorAxisEnd,
        ratio: num(raw.ratio, 1),
        startAngle: num(raw.startAngle, 0),
        endAngle: num(raw.endAngle, 2 * Math.PI),
      };
    }
    case "SPLINE": {
      const controlPoints = (raw.controlPoints ?? []).map((p) => ({
        x: num(p.x, 0),
        y: num(p.y, 0),
      }));
      return {
        type: "SPLINE",
        layer,
        controlPoints,
        degree: Math.max(0, Math.floor(num(raw.degree, 3))),
        knots: (raw.knots ?? []).map((k) => num(k, 0)),
        closed: Boolean(raw.closed),
      };
    }
    case "MTEXT": {
      return {
        type: "MTEXT",
        layer,
        position: pointFrom(raw.startPoint) ?? pointFromXY(raw) ?? { x: 0, y: 0 },
        text: String(raw.text ?? ""),
        height: num(raw.height, 1),
        rotation: num(raw.rotation, 0),
      };
    }
    case "DIMENSION": {
      // Dimension entities in DXF have a defining start (group 13/23) and end
      // (group 14/24) — but the `dxf` package maps those to `start`/`end` on
      // the entity object already. We treat the dimension as a line segment
      // for extents + measurement purposes.
      const start = pointFrom(raw.start) ?? { x: 0, y: 0 };
      const end = pointFrom(raw.end) ?? start;
      return {
        type: "DIMENSION",
        layer,
        start,
        end,
        position: pointFromXY(raw) ?? start,
        text: String(raw.dimensionText ?? raw.text ?? ""),
      };
    }
    default:
      // Graceful skip — HATCH, 3DSOLID, ATTDEF, ATTRIB, SOLID, VIEWPORT,
      // OLE2FRAME, THREEDFACE, etc. are not in our support matrix.
      return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Coerce a possibly-undefined / NaN value to a finite number, else default. */
function num(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return v;
}

/** Build a 2D point from a `{x,y,z}` triple (DXF group codes 10/20/30). */
function pointFrom(p?: RawPoint): Point | null {
  if (!p) return null;
  return { x: num(p.x, 0), y: num(p.y, 0) };
}

/** Build a 2D point from flat `x`/`y` fields (used by CIRCLE, ARC, etc.). */
function pointFromXY(e: { x?: number; y?: number }): Point | null {
  if (e.x === undefined && e.y === undefined) return null;
  return { x: num(e.x, 0), y: num(e.y, 0) };
}

/**
 * The "extreme points" of an entity — the set of points whose min/max X/Y
 * define the entity's bounding box.
 *
 *   - LINE / DIMENSION:    start + end
 *   - CIRCLE / ARC / ELLIPSE: center ± radius (the bbox of a circle is the
 *                              circumscribed square)
 *   - LWPOLYLINE / POLYLINE / SPLINE: all vertices / control points
 *   - TEXT / MTEXT / POINT: position
 *   - INSERT:               position (the block's geometry is rendered
 *                            separately — its bounds come from the block
 *                            definition, not the INSERT itself; we use just
 *                            the insertion point here for a safe overestimate)
 *
 * @internal
 */
function entityExtremePoints(e: DxfEntity): Point[] {
  switch (e.type) {
    case "LINE":
    case "DIMENSION":
      return [e.start, e.end];
    case "CIRCLE":
    case "ARC": {
      const r = e.radius;
      return [
        { x: e.center.x - r, y: e.center.y - r },
        { x: e.center.x + r, y: e.center.y - r },
        { x: e.center.x - r, y: e.center.y + r },
        { x: e.center.x + r, y: e.center.y + r },
      ];
    }
    case "ELLIPSE": {
      // Approximate ellipse bbox via the major axis endpoint + ratio.
      // This is a safe overestimate — exact ellipse bbox requires solving
      // for the axis-aligned extremes of a rotated ellipse, which is more
      // math than the bbox use-case warrants.
      const cx = e.center.x;
      const cy = e.center.y;
      const mx = e.majorAxisEnd.x;
      const my = e.majorAxisEnd.y;
      const majorLen = Math.hypot(mx, my);
      const minorLen = majorLen * Math.abs(e.ratio);
      const cos = majorLen === 0 ? 1 : mx / majorLen;
      const sin = majorLen === 0 ? 0 : my / majorLen;
      // Bounding extents of a rotated ellipse:
      //   half-width  = sqrt((a·cos)² + (b·sin)²)
      //   half-height = sqrt((a·sin)² + (b·cos)²)
      const hw = Math.hypot(majorLen * cos, minorLen * sin);
      const hh = Math.hypot(majorLen * sin, minorLen * cos);
      return [
        { x: cx - hw, y: cy - hh },
        { x: cx + hw, y: cy - hh },
        { x: cx - hw, y: cy + hh },
        { x: cx + hw, y: cy + hh },
      ];
    }
    case "LWPOLYLINE":
    case "POLYLINE":
      return e.vertices.map((v) => ({ x: v.x, y: v.y }));
    case "SPLINE":
      return e.controlPoints;
    case "TEXT":
    case "MTEXT":
    case "POINT":
    case "INSERT":
      return [e.position];
    default: {
      // Exhaustive guard — if a new entity type is added to the union
      // without a case here, TypeScript flags it at compile time.
      const _exhaustive: never = e;
      return [];
    }
  }
}
