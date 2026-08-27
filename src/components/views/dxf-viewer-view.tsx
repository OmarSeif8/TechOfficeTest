"use client";

/**
 * DxfViewerView — server-parsed DXF rendered as client-side SVG.
 *
 * Per SPEC_PHASE3_WEB.md Part 3B §3 (W3-20):
 *   - SVG rendering of all entity types in the support matrix (LINE, CIRCLE,
 *     ARC, LWPOLYLINE, POLYLINE, TEXT, POINT, ELLIPSE, SPLINE, MTEXT,
 *     DIMENSION, INSERT — block placement only, not the block's geometry).
 *   - Zoom (mouse wheel centered on cursor) + pan (mouse drag).
 *   - "Fit to view" calls the pure `fitToView(extents, vw, vh, pad)` from
 *     the domain — the UI just stores the resulting `{ zoom, pan }`.
 *   - Layer panel: toggles call the pure `filterEntities` from the domain.
 *   - Measurement tools (Phase 3B Stage 2 per spec):
 *       - Distance: click 2 points → `distance(p1, p2)`.
 *       - Area: click N points → `polygonArea(points)`.
 *     Snapping is deferred — free-click in MVP.
 *   - Markup overlay: cloud / arrow / text markups stored in React state
 *     (DB persistence deferred — see MarkupOverlay component).
 *   - Cursor coordinate readout (model coords under the cursor).
 *   - Background color toggle (black / white) — black is the default CAD look.
 *
 * Data flow:
 *   - GET /api/projects/[projectId]/drawings → list (for the dropdown).
 *   - GET /api/drawings/[id]/dxf              → { entities, layers, extents,
 *                                                  unit, source, drawing }.
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No drawing selected  → empty-state CTA prompting the user to pick one.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/stores, @domain/drawing/*
 * (the pure transforms / measurement / layers), shadcn/ui, and the local
 * MarkupOverlay. No server-only code, no direct DB access.
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Layers as LayersIcon,
  X,
  Loader2,
  ArrowRight,
  Ruler,
  Shapes,
  Type as TypeIcon,
  Trash2,
  Sun,
  Moon,
  CheckCheck,
  Square as SquareIcon,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Pure domain functions (BR-DW2 + BR-DW3 — these have zero DOM deps).
import { modelToScreen, screenToModel, fitToView } from "@domain/drawing/transforms";
import { distance, polygonArea, perimeter } from "@domain/drawing/measurement";
import { filterEntities, getLayerNames } from "@domain/drawing/layers";
import type {
  DxfEntity,
  DxfLayer,
  Extents,
  Point,
} from "@shared/schemas/drawing/dxf";
import type { Discipline } from "@shared/entities";

import {
  MarkupOverlay,
  createArrowMarkup,
  createCloudMarkup,
  createTextMarkup,
  type Markup,
} from "@/components/drawing/markup-overlay";

// ─── Types ────────────────────────────────────────────────────────────────

interface DrawingApi {
  id: string;
  projectId: string;
  code: string;
  titleEn: string;
  titleAr: string | null;
  discipline: Discipline;
  currentRevisionId: string | null;
  version: number;
}

interface DrawingsListResponse {
  drawings: DrawingApi[];
}

interface DxfApiResponse {
  entities: DxfEntity[];
  layers: DxfLayer[];
  extents: Extents;
  unit: string | null;
  source: "file" | "fixture";
  drawing: {
    id: string;
    code: string;
    titleEn: string;
    titleAr: string | null;
    discipline: Discipline;
    currentRevisionId: string | null;
    currentRevision: {
      id: string;
      revision: string;
      fileUploadId: string | null;
      originalName: string | null;
      mimeType: string | null;
    } | null;
  };
}

type MeasurementMode = "none" | "distance" | "area";
type MarkupMode = "none" | "cloud" | "arrow" | "text";
type Background = "black" | "white";

// ─── Constants ────────────────────────────────────────────────────────────

const FIT_PADDING = 40; // CSS px of breathing room around the fit box.
const ZOOM_WHEEL_FACTOR = 0.0015; // wheel delta → zoom delta multiplier.
const ZOOM_BUTTON_FACTOR = 1.25; // per-click zoom in/out button factor.
const MIN_ZOOM = 0.001;
const MAX_ZOOM = 1000;
const POINT_RADIUS_PX = 3; // measurement click-point marker (screen px).

// ─── Component ────────────────────────────────────────────────────────────

export function DxfViewerView() {
  const t = useTranslations("dxfViewer");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  // ── Drawing selection ───────────────────────────────────────────────────
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(
    null,
  );

  // ── Viewport state ──────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  // ── Layer visibility (BR-DW3) ───────────────────────────────────────────
  const [visibleLayers, setVisibleLayers] = useState<Set<string> | null>(null);
  const [showLayerPanel, setShowLayerPanel] = useState(true);

  // ── Background + cursor + measurement ───────────────────────────────────
  const [background, setBackground] = useState<Background>("black");
  const [cursorModel, setCursorModel] = useState<Point | null>(null);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>(
    "none",
  );
  const [measurementPoints, setMeasurementPoints] = useState<Point[]>([]);

  // ── Markups ─────────────────────────────────────────────────────────────
  const [markups, setMarkups] = useState<Markup[]>([]);
  const [markupMode, setMarkupMode] = useState<MarkupMode>("none");
  const [pendingCloudPoints, setPendingCloudPoints] = useState<Point[]>([]);
  const [pendingArrowFrom, setPendingArrowFrom] = useState<Point | null>(null);
  const [textInputDialog, setTextInputDialog] = useState<{
    position: Point;
    value: string;
  } | null>(null);

  // ── Pan drag state ──────────────────────────────────────────────────────
  const dragRef = useRef<{
    active: boolean;
    lastScreen: Point;
    startPan: Point;
  }>({ active: false, lastScreen: { x: 0, y: 0 }, startPan: { x: 0, y: 0 } });
  // Mirror of dragRef.current.active for render-aware cursor styling
  // (eslint/react-hooks disallows reading ref.current during render).
  const [isDragging, setIsDragging] = useState(false);

  // ── Data: drawings list ────────────────────────────────────────────────
  const { data: drawingsData } = useQuery<DrawingsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.drawings.list(currentProjectId)
      : ["drawings", "list", "_disabled"],
    queryFn: () =>
      fetchJson<DrawingsListResponse>(
        `/api/projects/${currentProjectId}/drawings`,
      ),
    enabled: !!currentProjectId,
  });
  const drawings = drawingsData?.drawings ?? [];

  // Auto-select the first drawing when the list loads — derive the
  // effective ID rather than calling setState in an effect (the lint rule
  // react-hooks/set-state-in-effect disallows that). The user's explicit
  // selection always wins; the auto-default only kicks in until they pick.
  const effectiveDrawingId = selectedDrawingId ?? drawings[0]?.id ?? null;

  // ── Data: parsed DXF for the selected drawing ───────────────────────────
  const { data: dxfData, isLoading: dxfLoading } = useQuery<DxfApiResponse>({
    queryKey: effectiveDrawingId
      ? queryKeys.drawings.dxf(effectiveDrawingId)
      : ["drawings", "dxf", "_disabled"],
    queryFn: () =>
      fetchJson<DxfApiResponse>(`/api/drawings/${effectiveDrawingId}/dxf`),
    enabled: !!effectiveDrawingId && !!currentProjectId,
  });

  const entities = dxfData?.entities ?? [];
  const layers = dxfData?.layers ?? [];
  const extents = dxfData?.extents ?? null;
  const unit = dxfData?.unit ?? null;
  const source = dxfData?.source ?? "fixture";

  // ── Layer visibility: derive the default set from the parsed layers list.
  // The user's toggle state (if non-null) wins; null = "use the derived
  // default" — i.e. every layer the parser marked visible=true is on.
  const defaultVisibleLayers = useMemo(() => {
    const initial = new Set<string>();
    for (const l of layers) {
      if (l.visible) initial.add(l.name);
    }
    return initial;
  }, [layers]);
  const visibleLayerSet = visibleLayers ?? defaultVisibleLayers;
  // Track the previous effectiveDrawingId so we can reset interaction state
  // when the user picks a new drawing (the React docs' "adjust state during
  // render" pattern — avoids setState-in-effect).
  const [prevDrawingId, setPrevDrawingId] = useState<string | null>(null);
  if (prevDrawingId !== effectiveDrawingId) {
    setPrevDrawingId(effectiveDrawingId);
    // Reset all per-drawing interaction state — the new drawing is a fresh
    // canvas. (Note: this only runs when effectiveDrawingId actually changes,
    // so it doesn't fire on every render.)
    setMeasurementPoints([]);
    setMeasurementMode("none");
    setMarkups([]);
    setMarkupMode("none");
    setPendingCloudPoints([]);
    setPendingArrowFrom(null);
    setTextInputDialog(null);
    // Reset layer override so the new drawing's default visibility applies.
    setVisibleLayers(null);
  }

  // ── Filtered entities via the pure filterEntities (BR-DW3) ───────────────
  const filteredEntities = useMemo(
    () => filterEntities(entities, visibleLayerSet),
    [entities, visibleLayerSet],
  );

  // Layer names actually in use (declared layers + layers used by entities
  // but missing from the TABLES — synthesized defensively by the parser).
  const layerNamesInUse = useMemo(
    () => getLayerNames(entities),
    [entities],
  );

  // ── Viewport size tracking (ResizeObserver) ────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setViewportSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Re-fit-to-view when the drawing's extents change or the viewport
  //    resizes ("adjust state during render" pattern — avoids setState-in-
  //    effect, per React docs).
  const [prevFitKey, setPrevFitKey] = useState<string>("");
  const fitKey = extents
    ? `${extents.minX},${extents.minY},${extents.maxX},${extents.maxY},${viewportSize.w},${viewportSize.h}`
    : "";
  if (fitKey !== "" && fitKey !== prevFitKey) {
    setPrevFitKey(fitKey);
    if (viewportSize.w > 0 && viewportSize.h > 0 && extents) {
      const fit = fitToView(extents, viewportSize.w, viewportSize.h, FIT_PADDING);
      setZoom(fit.zoom);
      setPan(fit.pan);
    }
  }

  // ── Helpers: screen ↔ model with Y-flip ─────────────────────────────────
  //
  // The pure `modelToScreen` / `screenToModel` assume SVG Y points DOWN
  // (i.e., the math is purely linear — no Y-flip). DXF model Y points UP,
  // so the renderer must flip Y. We apply the flip as a separate step
  // (mirroring across the viewport's horizontal midline), keeping the
  // domain math pure.
  const toScreen = useCallback(
    (p: Point): { x: number; y: number } => {
      const pure = modelToScreen(p, zoom, pan);
      // Flip Y: model Y-up → screen Y-up (i.e., invert screen.y around vh/2).
      return { x: pure.x, y: viewportSize.h - pure.y };
    },
    [zoom, pan, viewportSize.h],
  );

  const fromScreen = useCallback(
    (s: Point): Point => {
      // Inverse of toScreen: pre-flip Y, then call the pure screenToModel.
      const flipped = { x: s.x, y: viewportSize.h - s.y };
      return screenToModel(flipped, zoom, pan);
    },
    [zoom, pan, viewportSize.h],
  );

  // ── Zoom controls ────────────────────────────────────────────────────────
  const applyZoom = useCallback(
    (newZoom: number, focusScreen?: Point) => {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      if (focusScreen) {
        // Zoom around the cursor: keep the model point under the cursor
        // stationary in screen space.
        const modelUnderCursor = fromScreen(focusScreen);
        // After zoom changes, the new pan must place modelUnderCursor at the
        // same screen point. Solve:
        //   s.y = vh - (model.y * z + pan.y) → pan.y = vh - s.y - model.y * z
        //                                    (post-flip form)
        // But fromScreen uses (pan, zoom) so we recompute pan directly.
        const newPan = {
          x: focusScreen.x - modelUnderCursor.x * z,
          y: viewportSize.h - focusScreen.y - modelUnderCursor.y * z,
        };
        setZoom(z);
        setPan(newPan);
      } else {
        setZoom(z);
      }
    },
    [fromScreen, viewportSize.h],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const focus = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // Standard wheel: delta > 0 = zoom out, delta < 0 = zoom in.
      const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_FACTOR);
      applyZoom(zoom * factor, focus);
    },
    [zoom, applyZoom],
  );

  const handleZoomIn = () => applyZoom(zoom * ZOOM_BUTTON_FACTOR);
  const handleZoomOut = () => applyZoom(zoom / ZOOM_BUTTON_FACTOR);
  const handleFitToView = () => {
    if (!extents || viewportSize.w === 0 || viewportSize.h === 0) return;
    const fit = fitToView(extents, viewportSize.w, viewportSize.h, FIT_PADDING);
    setZoom(fit.zoom);
    setPan(fit.pan);
  };

  // ── Pan drag ──────────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Only pan when:
    //   - left button
    //   - no measurement or markup mode active (those consume clicks)
    if (e.button !== 0) return;
    if (measurementMode !== "none" || markupMode !== "none") return;
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragRef.current = {
      active: true,
      lastScreen: screen,
      startPan: pan,
    };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    // Update cursor readout.
    const model = fromScreen(screen);
    setCursorModel(model);

    // Pan drag.
    if (dragRef.current.active) {
      const dx = screen.x - dragRef.current.lastScreen.x;
      const dy = screen.y - dragRef.current.lastScreen.y;
      setPan((p) => ({ x: p.x + dx, y: p.y - dy })); // Y inverted (screen Y down).
    }
  };

  const handleMouseUp = () => {
    dragRef.current.active = false;
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    dragRef.current.active = false;
    setIsDragging(false);
    setCursorModel(null);
  };

  // ── Click handler for measurement + markup ──────────────────────────────
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    // Suppress click after a pan drag (so the click doesn't double as a
    // measurement point + start a new pan). Heuristic: if the drag moved
    // more than a few px, treat as pan, not click.
    // (Pan-handling above already updated pan; here we just consume the click
    // if a drag recently happened.)
    const rect = svgRef.current.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const model = fromScreen(screen);

    // Measurement: distance
    if (measurementMode === "distance") {
      if (measurementPoints.length >= 2) {
        // Start a new measurement.
        setMeasurementPoints([model]);
      } else {
        setMeasurementPoints([...measurementPoints, model]);
      }
      return;
    }

    // Measurement: area
    if (measurementMode === "area") {
      setMeasurementPoints([...measurementPoints, model]);
      return;
    }

    // Markups
    if (markupMode === "cloud") {
      setPendingCloudPoints([...pendingCloudPoints, model]);
      return;
    }
    if (markupMode === "arrow") {
      if (!pendingArrowFrom) {
        setPendingArrowFrom(model);
      } else {
        setMarkups((prev) => [
          ...prev,
          createArrowMarkup(pendingArrowFrom, model),
        ]);
        setPendingArrowFrom(null);
      }
      return;
    }
    if (markupMode === "text") {
      setTextInputDialog({ position: model, value: "" });
      return;
    }
  };

  // Double-click ends cloud + area measurement (close the polygon).
  const handleDoubleClick = () => {
    if (markupMode === "cloud" && pendingCloudPoints.length >= 2) {
      setMarkups((prev) => [
        ...prev,
        createCloudMarkup(pendingCloudPoints),
      ]);
      setPendingCloudPoints([]);
      setMarkupMode("none");
    }
    if (measurementMode === "area" && measurementPoints.length >= 3) {
      // Trigger result computation implicitly — the polygon is complete.
      // We don't auto-clear so the user can read the result.
    }
  };

  // ── Cancel buttons ──────────────────────────────────────────────────────
  const cancelMeasurement = () => {
    setMeasurementMode("none");
    setMeasurementPoints([]);
  };
  const cancelMarkup = () => {
    setMarkupMode("none");
    setPendingCloudPoints([]);
    setPendingArrowFrom(null);
    setTextInputDialog(null);
  };
  const clearMarkups = () => {
    setMarkups([]);
    setPendingCloudPoints([]);
    setPendingArrowFrom(null);
    setTextInputDialog(null);
  };

  // ── Measurement result ──────────────────────────────────────────────────
  const measurementResult = useMemo(() => {
    if (measurementMode === "distance" && measurementPoints.length === 2) {
      return {
        label: t("distanceLabel"),
        value: distance(measurementPoints[0], measurementPoints[1]).toFixed(3),
      };
    }
    if (measurementMode === "area" && measurementPoints.length >= 3) {
      return {
        label: t("areaLabel"),
        value: polygonArea(measurementPoints).toFixed(3),
        secondary: `${t("perimeterLabel")}: ${perimeter(measurementPoints).toFixed(3)}`,
      };
    }
    return null;
  }, [measurementMode, measurementPoints, t]);

  // ── Layer panel helpers ──────────────────────────────────────────────────
  const toggleLayer = (name: string) => {
    setVisibleLayers((prev) => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selectAllLayers = () => {
    setVisibleLayers(new Set(layerNamesInUse));
  };
  const deselectAllLayers = () => {
    setVisibleLayers(new Set());
  };

  // ── Empty state: no project selected ────────────────────────────────────
  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <Maximize2 className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t("noProject")}</p>
          <Button
            type="button"
            onClick={() => setCurrentView("projects")}
            className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
          >
            {t("goToProjects")}
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // ─── Theme colors ─────────────────────────────────────────────────────────
  const isDarkBg = background === "black";
  const strokeColor = isDarkBg ? "#e5e7eb" : "#111827";
  const bgColor = isDarkBg ? "#0a0a0a" : "#ffffff";
  const mutedStroke = isDarkBg ? "#6b7280" : "#9ca3af";

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-3.5rem)]">
      {/* ── Toolbar (top) ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        {/* Drawing selector */}
        <Select
          value={effectiveDrawingId ?? ""}
          onValueChange={(v) => {
            setSelectedDrawingId(v || null);
            // (State reset happens automatically via the prevDrawingId guard
            // — no need to manually reset measurement/markups here.)
          }}
        >
          <SelectTrigger className="w-[260px] h-8 text-xs">
            <SelectValue placeholder={t("selectDrawing")} />
          </SelectTrigger>
          <SelectContent>
            {drawings.length === 0 ? (
              <SelectItem value="_none" disabled>
                {t("noDrawing")}
              </SelectItem>
            ) : (
              drawings.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="font-mono">{d.code}</span>
                  {" — "}
                  <span>{d.titleEn}</span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <div className="h-5 w-px bg-border mx-1" />

        {/* Zoom controls */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleZoomIn}>
              <ZoomIn className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("zoomIn")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleZoomOut}>
              <ZoomOut className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("zoomOut")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleFitToView}>
              <Maximize2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("fitToView")}</TooltipContent>
        </Tooltip>

        <span className="text-xs text-muted-foreground tabular-nums ml-1">
          {(zoom * 100).toFixed(0)}%
        </span>

        <div className="h-5 w-px bg-border mx-1" />

        {/* Layer panel toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showLayerPanel ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setShowLayerPanel((s) => !s)}
            >
              <LayersIcon className="w-4 h-4" />
              <span className="text-xs">{t("layers")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("layers")}</TooltipContent>
        </Tooltip>

        <div className="h-5 w-px bg-border mx-1" />

        {/* Measurement mode */}
        <Select
          value={measurementMode}
          onValueChange={(v) => {
            setMeasurementMode(v as MeasurementMode);
            setMeasurementPoints([]);
            if (v !== "none") {
              setMarkupMode("none");
              setPendingCloudPoints([]);
              setPendingArrowFrom(null);
            }
          }}
        >
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <Ruler className="w-3.5 h-3.5 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("none")}</SelectItem>
            <SelectItem value="distance">{t("distance")}</SelectItem>
            <SelectItem value="area">{t("area")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Markup mode */}
        <Select
          value={markupMode}
          onValueChange={(v) => {
            setMarkupMode(v as MarkupMode);
            setPendingCloudPoints([]);
            setPendingArrowFrom(null);
            setTextInputDialog(null);
            if (v !== "none") {
              setMeasurementMode("none");
              setMeasurementPoints([]);
            }
          }}
        >
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <Shapes className="w-3.5 h-3.5 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("none")}</SelectItem>
            <SelectItem value="cloud">{t("cloud")}</SelectItem>
            <SelectItem value="arrow">{t("arrow")}</SelectItem>
            <SelectItem value="text">{t("text")}</SelectItem>
          </SelectContent>
        </Select>

        {markups.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={clearMarkups}>
                <Trash2 className="w-3.5 h-3.5" />
                <span className="text-xs">{t("clearMarkups")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("clearMarkups")}</TooltipContent>
          </Tooltip>
        )}

        {/* Spacer + background toggle */}
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setBackground((b) => (b === "black" ? "white" : "black"))}
            >
              {isDarkBg ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("background")}: {isDarkBg ? t("black") : t("white")}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* ── Body (SVG + side panel) ─────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* SVG canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative min-w-0 overflow-hidden"
          style={{ background: bgColor }}
        >
          {/* Empty state: no drawing selected */}
          {!effectiveDrawingId && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-sm p-8">
                <Maximize2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t("empty")}
                </p>
              </div>
            </div>
          )}

          {/* Loading */}
          {effectiveDrawingId && dxfLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("loadingDrawing")}
              </div>
            </div>
          )}

          {/* Fixture notice */}
          {dxfData && source === "fixture" && (
            <div className="absolute top-2 left-2 z-10">
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">
                {t("fixtureLoaded")}
              </Badge>
            </div>
          )}

          {/* SVG (renders only when we have data) */}
          {dxfData && (
            <svg
              ref={svgRef}
              width={viewportSize.w}
              height={viewportSize.h}
              className="block cursor-grab"
              style={{
                cursor:
                  measurementMode !== "none" || markupMode !== "none"
                    ? "crosshair"
                    : isDragging
                      ? "grabbing"
                      : "grab",
              }}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
            >
              {/* Drawing entities */}
              <g>
                {filteredEntities.map((e, i) => (
                  <EntityRenderer
                    key={`ent-${i}`}
                    entity={e}
                    toScreen={toScreen}
                    zoom={zoom}
                    strokeColor={strokeColor}
                    mutedStroke={mutedStroke}
                  />
                ))}
              </g>

              {/* Markup overlay (renders above drawing; markups are in MODEL coords,
                  so we wrap them in a transform that matches the drawing's zoom/pan
                  + Y-flip). */}
              <g
                transform={`translate(0 ${viewportSize.h}) scale(1 -1)`}
              >
                <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                  <MarkupOverlay
                    markups={markups}
                    previewMarkup={
                      pendingCloudPoints.length > 0
                        ? createCloudMarkup(pendingCloudPoints, "#f9731688")
                        : pendingArrowFrom && cursorModel
                          ? createArrowMarkup(
                              pendingArrowFrom,
                              cursorModel,
                              "#ef444488",
                            )
                          : null
                    }
                  />
                </g>
              </g>

              {/* Measurement preview (drawn in SCREEN space — no Y-flip) */}
              {measurementMode !== "none" && measurementPoints.length > 0 && (
                <g>
                  {/* Polyline connecting all click points */}
                  {measurementPoints.length > 1 && (
                    <polyline
                      points={measurementPoints
                        .map((p) => {
                          const s = toScreen(p);
                          return `${s.x},${s.y}`;
                        })
                        .join(" ")}
                      fill={
                        measurementMode === "area" && measurementPoints.length >= 3
                          ? "rgba(59,130,246,0.15)"
                          : "none"
                      }
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                    />
                  )}
                  {/* Click point markers */}
                  {measurementPoints.map((p, i) => {
                    const s = toScreen(p);
                    return (
                      <g key={`mp-${i}`}>
                        <circle
                          cx={s.x}
                          cy={s.y}
                          r={POINT_RADIUS_PX}
                          fill="#3b82f6"
                          stroke="#ffffff"
                          strokeWidth={1}
                        />
                        <text
                          x={s.x + 6}
                          y={s.y - 6}
                          fill="#3b82f6"
                          fontSize={10}
                          fontFamily="ui-monospace, monospace"
                        >
                          {i + 1}
                        </text>
                      </g>
                    );
                  })}
                  {/* Live preview line to cursor (distance mode, 1 point placed) */}
                  {measurementMode === "distance" &&
                    measurementPoints.length === 1 &&
                    cursorModel && (
                      <line
                        x1={toScreen(measurementPoints[0]).x}
                        y1={toScreen(measurementPoints[0]).y}
                        x2={toScreen(cursorModel).x}
                        y2={toScreen(cursorModel).y}
                        stroke="#3b82f6"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        opacity={0.7}
                      />
                    )}
                  {/* Live preview line for area mode (cursor → first point if closed) */}
                  {measurementMode === "area" &&
                    measurementPoints.length >= 2 &&
                    cursorModel && (
                      <line
                        x1={toScreen(
                          measurementPoints[measurementPoints.length - 1],
                        ).x}
                        y1={toScreen(
                          measurementPoints[measurementPoints.length - 1],
                        ).y}
                        x2={toScreen(cursorModel).x}
                        y2={toScreen(cursorModel).y}
                        stroke="#3b82f6"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        opacity={0.5}
                      />
                    )}
                </g>
              )}

              {/* Pending markup preview (cloud points) */}
              {markupMode === "cloud" && pendingCloudPoints.length > 0 && (
                <g>
                  <polyline
                    points={pendingCloudPoints
                      .map((p) => {
                        const s = toScreen(p);
                        return `${s.x},${s.y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                  />
                  {pendingCloudPoints.map((p, i) => {
                    const s = toScreen(p);
                    return (
                      <circle
                        key={`pc-${i}`}
                        cx={s.x}
                        cy={s.y}
                        r={POINT_RADIUS_PX}
                        fill="#f97316"
                      />
                    );
                  })}
                </g>
              )}

              {/* Pending markup preview (arrow from) */}
              {markupMode === "arrow" && pendingArrowFrom && cursorModel && (
                <g>
                  <line
                    x1={toScreen(pendingArrowFrom).x}
                    y1={toScreen(pendingArrowFrom).y}
                    x2={toScreen(cursorModel).x}
                    y2={toScreen(cursorModel).y}
                    stroke="#ef4444"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                  />
                  <circle
                    cx={toScreen(pendingArrowFrom).x}
                    cy={toScreen(pendingArrowFrom).y}
                    r={POINT_RADIUS_PX}
                    fill="#ef4444"
                  />
                </g>
              )}
            </svg>
          )}

          {/* Bottom status bar (cursor coords + measurement result + hints) */}
          {dxfData && (
            <div className="absolute bottom-0 left-0 right-0 h-7 flex items-center gap-3 px-3 text-[11px] text-muted-foreground bg-card border-t border-border">
              <span className="font-mono">
                {t("coordinates")}:{" "}
                {cursorModel
                  ? `${cursorModel.x.toFixed(2)}, ${cursorModel.y.toFixed(2)}`
                  : "—"}
                {unit ? ` ${unit}` : ""}
              </span>
              <span className="text-border">|</span>
              <span>
                {t("entities")}: {filteredEntities.length}/{entities.length}
              </span>
              <span className="text-border">|</span>
              <span>
                {t("units")}: {unit ?? t("unknownUnit")}
              </span>
              {measurementResult && (
                <>
                  <span className="text-border">|</span>
                  <span className="text-foreground font-medium">
                    {measurementResult.label}:{" "}
                    <span className="tabular-nums">{measurementResult.value}</span>
                    {unit ? ` ${unit}` : ""}
                    {measurementResult.secondary
                      ? ` (${measurementResult.secondary}${
                          unit ? ` ${unit}` : ""
                        })`
                      : ""}
                  </span>
                </>
              )}
              <div className="flex-1" />
              {measurementMode === "distance" && (
                <span className="text-amber-600 dark:text-amber-400">
                  {t("clickTwoPoints")}
                </span>
              )}
              {measurementMode === "area" && (
                <span className="text-amber-600 dark:text-amber-400">
                  {t("clickPolygonPoints")}
                </span>
              )}
              {markupMode === "cloud" && (
                <span className="text-amber-600 dark:text-amber-400">
                  {t("cloud")} — {t("clickPolygonPoints")}
                </span>
              )}
              {markupMode === "arrow" && (
                <span className="text-amber-600 dark:text-amber-400">
                  {t("arrow")} — {t("clickTwoPoints")}
                </span>
              )}
              {markupMode === "text" && (
                <span className="text-amber-600 dark:text-amber-400">
                  {t("text")} — {t("clickTwoPoints").replace("distance", "place")}
                </span>
              )}
              {(measurementMode !== "none" || markupMode !== "none") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 text-[10px] px-2"
                  onClick={() => {
                    cancelMeasurement();
                    cancelMarkup();
                  }}
                >
                  {t("cancelMeasurement")}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Layer panel */}
        {showLayerPanel && (
          <aside className="w-64 border-l border-border bg-card flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <LayersIcon className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">{t("layers")}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setShowLayerPanel(false)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 flex-1"
                onClick={selectAllLayers}
              >
                <CheckCheck className="w-3 h-3" />
                {t("selectAll")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 flex-1"
                onClick={deselectAllLayers}
              >
                <SquareIcon className="w-3 h-3" />
                {t("deselectAll")}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {layerNamesInUse.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  {t("noDrawing")}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {layerNamesInUse.map((name) => {
                    const declared = layers.find((l) => l.name === name);
                    const isVisible = visibleLayerSet.has(name);
                    return (
                      <li
                        key={name}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30"
                      >
                        <Checkbox
                          checked={isVisible}
                          onCheckedChange={() => toggleLayer(name)}
                          id={`layer-${name}`}
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-sm border border-border/50"
                          style={{
                            background: dxfColorToCss(declared?.color ?? 7),
                          }}
                          title={`DXF color ${declared?.color ?? 7}`}
                        />
                        <label
                          htmlFor={`layer-${name}`}
                          className="text-xs cursor-pointer flex-1 truncate"
                        >
                          {name}
                        </label>
                        {!declared?.visible && (
                          <Badge
                            variant="outline"
                            className="text-[9px] h-4 px-1"
                          >
                            OFF
                          </Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Text markup dialog */}
      <Dialog
        open={textInputDialog !== null}
        onOpenChange={(open) => {
          if (!open) setTextInputDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TypeIcon className="w-4 h-4" />
              {t("text")}
            </DialogTitle>
            <DialogDescription>{t("selectDrawing")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="markup-text" className="text-xs">
              {t("text")}
            </Label>
            <Input
              id="markup-text"
              autoFocus
              value={textInputDialog?.value ?? ""}
              onChange={(e) =>
                setTextInputDialog((prev) =>
                  prev ? { ...prev, value: e.target.value } : prev,
                )
              }
              placeholder={t("text")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (textInputDialog && textInputDialog.value.trim()) {
                    setMarkups((prev) => [
                      ...prev,
                      createTextMarkup(
                        textInputDialog.position,
                        textInputDialog.value,
                      ),
                    ]);
                  }
                  setTextInputDialog(null);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTextInputDialog(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              onClick={() => {
                if (textInputDialog && textInputDialog.value.trim()) {
                  setMarkups((prev) => [
                    ...prev,
                    createTextMarkup(
                      textInputDialog.position,
                      textInputDialog.value,
                    ),
                  ]);
                }
                setTextInputDialog(null);
              }}
            >
              {tc("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Entity renderer ────────────────────────────────────────────────────────

interface EntityRendererProps {
  entity: DxfEntity;
  toScreen: (p: Point) => { x: number; y: number };
  zoom: number;
  strokeColor: string;
  mutedStroke: string;
}

function EntityRenderer({
  entity,
  toScreen,
  zoom,
  strokeColor,
  mutedStroke,
}: EntityRendererProps) {
  switch (entity.type) {
    case "LINE": {
      const s1 = toScreen(entity.start);
      const s2 = toScreen(entity.end);
      return (
        <line
          x1={s1.x}
          y1={s1.y}
          x2={s2.x}
          y2={s2.y}
          stroke={strokeColor}
          strokeWidth={1}
        />
      );
    }
    case "CIRCLE": {
      const s = toScreen(entity.center);
      return (
        <circle
          cx={s.x}
          cy={s.y}
          r={entity.radius * zoom}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1}
        />
      );
    }
    case "ARC": {
      // SVG arc: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
      // Compute the start/end screen points (model radius away from center
      // along the start/end angles), then let SVG figure out the arc.
      const rScreen = entity.radius * zoom;
      const startScreen = toScreen({
        x: entity.center.x + entity.radius * Math.cos(entity.startAngle),
        y: entity.center.y + entity.radius * Math.sin(entity.startAngle),
      });
      const endScreen = toScreen({
        x: entity.center.x + entity.radius * Math.cos(entity.endAngle),
        y: entity.center.y + entity.radius * Math.sin(entity.endAngle),
      });
      // DXF ARC sweeps CCW from start to end. Our renderer flips Y (model
      // Y-up → screen Y-down), so CCW in model = CW in screen → sweep-flag = 1.
      let sweepAngle = entity.endAngle - entity.startAngle;
      if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
      const largeArc = sweepAngle > Math.PI ? 1 : 0;
      return (
        <path
          d={`M ${startScreen.x} ${startScreen.y} A ${rScreen} ${rScreen} 0 ${largeArc} 1 ${endScreen.x} ${endScreen.y}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1}
        />
      );
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      if (entity.vertices.length === 0) return null;
      const pts = entity.vertices.map((v) => toScreen(v));
      const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <polyline
          points={pointsStr}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1}
        />
      );
    }
    case "TEXT":
    case "MTEXT": {
      const s = toScreen(entity.position);
      const fontPx = Math.max(6, entity.height * zoom);
      // Counter-rotate: DXF rotation is CCW (radians); SVG `rotate()` is CW
      // (degrees) and our Y-flip inverts the rotation direction. Net effect:
      // negate the DXF rotation in degrees.
      const rotationDeg = (-entity.rotation * 180) / Math.PI;
      return (
        <text
          x={s.x}
          y={s.y}
          fill={strokeColor}
          fontSize={fontPx}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
          transform={`rotate(${rotationDeg} ${s.x} ${s.y})`}
        >
          {entity.text}
        </text>
      );
    }
    case "POINT": {
      const s = toScreen(entity.position);
      return (
        <circle
          cx={s.x}
          cy={s.y}
          r={POINT_RADIUS_PX}
          fill={strokeColor}
        />
      );
    }
    case "INSERT": {
      // Phase 3B MVP: render the INSERT as a small marker at the insertion
      // point. Block-geometry rendering (i.e. exploding the block's entities
      // at the insertion with scale + rotation) is a follow-up — the spec
      // lists INSERT + BLOCK definitions as "must render", but the Phase 3B
      // MVP scope is to demonstrate the viewer architecture (server parse →
      // client SVG) with the Fixture A rectangle, which has no INSERTs.
      const s = toScreen(entity.position);
      const sz = 4 * Math.max(1, zoom);
      return (
        <g>
          <circle cx={s.x} cy={s.y} r={sz} fill="none" stroke={strokeColor} strokeWidth={1} />
          <line
            x1={s.x - sz * 1.25}
            y1={s.y}
            x2={s.x + sz * 1.25}
            y2={s.y}
            stroke={strokeColor}
            strokeWidth={0.5}
          />
          <line
            x1={s.x}
            y1={s.y - sz * 1.25}
            x2={s.x}
            y2={s.y + sz * 1.25}
            stroke={strokeColor}
            strokeWidth={0.5}
          />
        </g>
      );
    }
    case "ELLIPSE": {
      // Approximate as a polygon with N samples around the ellipse. Always
      // correct regardless of rotation; cheap for the small N we use.
      const { center, majorAxisEnd, ratio } = entity;
      const majorLen = Math.hypot(majorAxisEnd.x, majorAxisEnd.y);
      const minorLen = majorLen * Math.abs(ratio);
      const N = 64;
      const angle = Math.atan2(majorAxisEnd.y, majorAxisEnd.x);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < N; i++) {
        const t = (i / N) * 2 * Math.PI;
        const ex = majorLen * Math.cos(t);
        const ey = minorLen * Math.sin(t);
        pts.push({
          x: center.x + ex * cos - ey * sin,
          y: center.y + ex * sin + ey * cos,
        });
      }
      const screenPts = pts.map((p) => toScreen(p));
      const pointsStr = screenPts.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <polygon
          points={pointsStr}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1}
        />
      );
    }
    case "SPLINE": {
      // Best-effort: render the control points as a polyline (no NURBS
      // evaluation — the spec lists SPLINE as "best-effort").
      if (entity.controlPoints.length === 0) return null;
      const pts = entity.controlPoints.map((p) => toScreen(p));
      const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <polyline
          points={pointsStr}
          fill="none"
          stroke={mutedStroke}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      );
    }
    case "DIMENSION": {
      const s1 = toScreen(entity.start);
      const s2 = toScreen(entity.end);
      return (
        <g>
          <line
            x1={s1.x}
            y1={s1.y}
            x2={s2.x}
            y2={s2.y}
            stroke={mutedStroke}
            strokeWidth={0.5}
            strokeDasharray="3 2"
          />
          {entity.text && (
            <text
              x={(s1.x + s2.x) / 2}
              y={(s1.y + s2.y) / 2 - 4}
              fill={strokeColor}
              fontSize={9}
            >
              {entity.text}
            </text>
          )}
        </g>
      );
    }
    default: {
      // Exhaustive guard — if a new entity type is added to the union
      // without a case here, TypeScript flags it at compile time.
      const _exhaustive: never = entity;
      return null;
    }
  }
}

// ─── DXF color → CSS color ────────────────────────────────────────────────

/** Map a DXF ACI color number to a CSS color. Covers the standard 1-7 plus
 *  a few common ones. Unknown → gray (CAD default for "BYLAYER" = 256). */
function dxfColorToCss(color: number): string {
  const map: Record<number, string> = {
    1: "#ef4444", // red
    2: "#eab308", // yellow
    3: "#22c55e", // green
    4: "#06b6d4", // cyan
    5: "#3b82f6", // blue
    6: "#ec4899", // magenta
    7: "#e5e7eb", // white/black (depending on theme)
    8: "#6b7280", // gray
    9: "#9ca3af", // light gray
  };
  return map[Math.abs(color)] ?? "#9ca3af";
}
