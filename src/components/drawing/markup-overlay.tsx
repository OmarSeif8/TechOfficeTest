"use client";

/**
 * MarkupOverlay — SVG markup layer rendered above the DXF drawing.
 *
 * Per SPEC_PHASE3_WEB.md Part 3B §3 (W3-22):
 *   - Markup types: cloud (freehand sketch), arrow (2-click), text (click + type).
 *   - Rendered as SVG elements on a separate `<g>` layer above the drawing.
 *   - "Clear markups" button (rendered by the parent viewer; this component
 *     just exposes the SVG layer + a small toolbar for mode switching).
 *
 * Phase 3B MVP simplification (per task description):
 *   - Markups live in React state ONLY (parent-managed). The spec's
 *     `drawing_markups` DB table + repository are deferred to Phase 4.
 *   - Persistence is the parent's responsibility: the parent owns the
 *     `markups` state and passes it down. This component is presentational.
 *
 * Coordinate system:
 *   - Markup positions are in MODEL SPACE (drawing units), not screen pixels.
 *     The parent applies the same zoom/pan transform to the markup layer as
 *     to the drawing layer — they sit on top of each other and pan together.
 *
 * Architecture:
 *   - Pure presentational component. No fetch, no mutation, no DB. Receives
 *     `markups: Markup[]` and renders one SVG element per markup.
 *   - All markup creation interactions (clicks, text entry) are handled by
 *     the parent viewer — the parent calls `onAddMarkup` etc.
 */

import { useTranslations } from "next-intl";

// ─── Markup types (mirror the eventual DB shape) ──────────────────────────

export interface MarkupBase {
  /** CUID — assigned by the parent (Phase 3B: client-side; Phase 4: DB). */
  id: string;
  /** Stroke color (CSS color string). Default per parent theme. */
  color: string;
  /** Stroke width in screen pixels — applied after zoom transform. */
  strokeWidth: number;
}

export interface CloudMarkup extends MarkupBase {
  type: "cloud";
  /** Freehand polyline vertices in model space. */
  points: Array<{ x: number; y: number }>;
}

export interface ArrowMarkup extends MarkupBase {
  type: "arrow";
  /** Tail (start) in model space. */
  from: { x: number; y: number };
  /** Head (end) in model space. */
  to: { x: number; y: number };
}

export interface TextMarkup extends MarkupBase {
  type: "text";
  /** Top-left insertion point in model space. */
  position: { x: number; y: number };
  /** The text content (single line — multi-line becomes multiple `<tspan>`). */
  text: string;
  /** Font size in model units (NOT screen pixels — scales with zoom). */
  fontSize: number;
}

export type Markup = CloudMarkup | ArrowMarkup | TextMarkup;

// ─── Component ─────────────────────────────────────────────────────────────

export interface MarkupOverlayProps {
  /** Existing markups to render (in z-order — later array entries paint on top). */
  markups: Markup[];
  /**
   * Preview markup shown while the user is in the middle of drawing (e.g. the
   * freehand polyline being dragged, or the arrow being aimed). Optional.
   */
  previewMarkup?: Markup | null;
}

/**
 * Renders markup elements as SVG `<g>` children. The parent wraps this in a
 * `<g transform="translate(panX, panY) scale(zoom)">` so the markups pan + zoom
 * with the drawing — this component is coordinate-system agnostic.
 */
export function MarkupOverlay({
  markups,
  previewMarkup,
}: MarkupOverlayProps) {
  const t = useTranslations("dxfViewer");
  const allMarkups = previewMarkup
    ? [...markups, previewMarkup]
    : markups;

  return (
    <g
      aria-label={t("markups")}
      role="group"
      // Pointer events are off so clicks fall through to the drawing layer
      // beneath (where the parent viewer's pan/zoom handlers live). Markups
      // are not interactive in Phase 3B MVP — they're display-only.
      style={{ pointerEvents: "none" }}
    >
      {allMarkups.map((m) => (
        <MarkupElement key={m.id} markup={m} />
      ))}
    </g>
  );
}

// ─── Per-markup SVG renderers ──────────────────────────────────────────────

function MarkupElement({ markup }: { markup: Markup }) {
  switch (markup.type) {
    case "cloud":
      return <CloudElement markup={markup} />;
    case "arrow":
      return <ArrowElement markup={markup} />;
    case "text":
      return <TextElement markup={markup} />;
    default: {
      // Exhaustive guard — if a new markup type is added without a case,
      // TypeScript flags it at compile time.
      const _exhaustive: never = markup;
      return null;
    }
  }
}

/**
 * Cloud — a freehand polyline rendered with a hand-drawn "cloud" look:
 *   - Squiggly stroke (dashed + rounded line-joins)
 *   - Semi-transparent fill so it reads as a highlighter, not a wall
 *
 * Phase 3B MVP: rendered as a smooth polyline. A "real" revision-cloud effect
 * (semi-circular bumps along the path) is deferred — the polyline + dashed
 * stroke conveys the intent clearly enough for review-markup use.
 */
function CloudElement({ markup }: { markup: CloudMarkup }) {
  if (markup.points.length === 0) return null;
  const pointsStr = markup.points
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  // Auto-close: if the first + last points differ, draw a closing line
  // via `fill="..."` so the cloud reads as a closed shape.
  const first = markup.points[0];
  const last = markup.points[markup.points.length - 1];
  const isClosed =
    first.x === last.x && first.y === last.y && markup.points.length >= 3;

  return (
    <g>
      <polyline
        points={pointsStr}
        fill={isClosed ? `${markup.color}22` : "none"}
        stroke={markup.color}
        strokeWidth={markup.strokeWidth}
        strokeDasharray="6 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/**
 * Arrow — a line from `from` to `to` with a triangular arrowhead at `to`.
 *
 * The arrowhead size is constant in screen pixels (not scaled by zoom) so it
 * stays visible at any zoom level. Achieved by inverting the zoom transform
 * on the arrowhead path — but since this component receives model-space
 * coordinates only, we approximate by using a small absolute size that the
 * parent can override via `strokeWidth`.
 */
function ArrowElement({ markup }: { markup: ArrowMarkup }) {
  const { from, to, color, strokeWidth } = markup;

  // Compute the arrowhead: a triangle at the `to` end, oriented along the
  // line direction. Length is 4× the stroke width; width is 3×.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;

  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular vector.
  const px = -uy;
  const py = ux;

  const headLen = strokeWidth * 6;
  const headWidth = strokeWidth * 4;

  // The line should stop where the arrowhead begins so the tip is sharp.
  const lineEndX = to.x - ux * headLen * 0.6;
  const lineEndY = to.y - uy * headLen * 0.6;

  const arrowPoints = [
    `${to.x},${to.y}`,
    `${to.x - ux * headLen + px * headWidth / 2},${to.y - uy * headLen + py * headWidth / 2}`,
    `${to.x - ux * headLen - px * headWidth / 2},${to.y - uy * headLen - py * headWidth / 2}`,
  ].join(" ");

  return (
    <g>
      <line
        x1={from.x}
        y1={from.y}
        x2={lineEndX}
        y2={lineEndY}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <polygon points={arrowPoints} fill={color} />
    </g>
  );
}

/**
 * Text — a `<text>` element anchored at `position`. The font size is in MODEL
 * units so the text scales with the zoom (zooming in makes text bigger — same
 * as the drawing geometry).
 */
function TextElement({ markup }: { markup: TextMarkup }) {
  const { position, text, color, fontSize } = markup;
  // Multi-line text: split on \n and render as stacked `<tspan>`s.
  const lines = text.split("\n");

  return (
    <text
      x={position.x}
      y={position.y}
      fill={color}
      fontSize={fontSize}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      dominantBaseline="hanging"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={position.x} dy={i === 0 ? 0 : fontSize * 1.2}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

// ─── Factory helpers (used by parent viewer to construct markup objects) ───

let _markupIdCounter = 0;
function nextMarkupId(): string {
  _markupIdCounter += 1;
  return `markup-${Date.now().toString(36)}-${_markupIdCounter.toString(36)}`;
}

export function createCloudMarkup(
  points: Array<{ x: number; y: number }>,
  color = "#f97316",
  strokeWidth = 1.5,
): CloudMarkup {
  return {
    id: nextMarkupId(),
    type: "cloud",
    points,
    color,
    strokeWidth,
  };
}

export function createArrowMarkup(
  from: { x: number; y: number },
  to: { x: number; y: number },
  color = "#ef4444",
  strokeWidth = 1.5,
): ArrowMarkup {
  return {
    id: nextMarkupId(),
    type: "arrow",
    from,
    to,
    color,
    strokeWidth,
  };
}

export function createTextMarkup(
  position: { x: number; y: number },
  text: string,
  color = "#3b82f6",
  fontSize = 12,
): TextMarkup {
  return {
    id: nextMarkupId(),
    type: "text",
    position,
    text,
    color,
    fontSize,
    // Text markups don't have a stroke — but MarkupBase requires the field.
    // Set to 0 so it's a no-op if any code path tries to read it.
    strokeWidth: 0,
  };
}
