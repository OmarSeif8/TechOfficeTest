"use client";

/**
 * GanttView (S15) — Gantt chart (SVG-based, client-side rendering).
 *
 * Per SPEC_PHASE2_WEB.md §6 (S15) + BR-WEB-P4: client-side SVG rendering of
 * the latest schedule run. Bars colored by criticality (critical = primary
 * accent; non-critical = muted). Milestones = diamond (duration 0).
 * Dependencies = arrows between bars.
 *
 * Data:
 *   - GET /api/projects/[projectId]/scheduling/current → { run, activities }
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No schedule run / non-success status → "Run schedule first" with a
 *     button that switches to the Scheduling view.
 *
 * Phase 2 scope (per the task description): SVG bars on a date axis, no zoom
 * or pan. The implementation follows the suggested-shape snippet from the
 * task description (single SVG, fixed dayWidth, time axis at top, bars
 * below, milestone diamonds, dependency arrows).
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/stores, shadcn/ui. No
 * server-only code.
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { BarChart3, Play, ArrowRight } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────

type ScheduleRunStatus = "SUCCESS" | "CYCLE_DETECTED" | "VALIDATION_ERROR";
type RelationshipType = "FS" | "SS" | "FF" | "SF";

interface ScheduleRunApi {
  id: string;
  projectId: string;
  projectStart: string; // ISO yyyy-MM-dd (BR-P1)
  status: ScheduleRunStatus;
  projectFinishDate: string | null;
  criticalPath: string[] | null;
  warnings: Array<{ code: string; message: string; activityId?: string }> | null;
  errors: unknown | null;
  runById: string;
  createdAt: string;
}

interface ScheduleActivityApi {
  id: string;
  scheduleRunId: string;
  activityId: string;
  activityCode: string;
  activityNameEn: string;
  isMilestone: boolean;
  es: string; // ISO yyyy-MM-dd — early start
  ef: string; // ISO yyyy-MM-dd — early finish
  ls: string; // ISO yyyy-MM-dd — late start
  lf: string; // ISO yyyy-MM-dd — late finish
  totalFloatDays: number;
  isCritical: boolean;
  // Optional relationship list (Group L may include it inline; if absent we
  // still render the bars without dependency arrows).
  relationships?: Array<{
    id: string;
    predecessorId: string;
    successorId: string;
    type: RelationshipType;
    lag: number;
  }>;
}

interface CurrentScheduleResponse {
  run: ScheduleRunApi | null;
  activities: ScheduleActivityApi[];
}

// ─── Layout constants ─────────────────────────────────────────────────────

const LABEL_COLUMN_WIDTH = 200;
const DAY_WIDTH = 30; // pixels per calendar day
const ROW_HEIGHT = 28;
const TOP_PADDING = 32; // space for the date axis

// ─── Component ────────────────────────────────────────────────────────────

export function GanttView() {
  const t = useTranslations("gantt");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  const { data, isLoading } = useQuery<CurrentScheduleResponse>({
    queryKey: currentProjectId
      ? queryKeys.schedule.current(currentProjectId)
      : ["schedule", "current", "_disabled"],
    queryFn: () =>
      fetchJson<CurrentScheduleResponse>(
        `/api/projects/${currentProjectId}/scheduling/current`,
      ),
    enabled: !!currentProjectId,
  });

  const run = data?.run ?? null;
  const activities = data?.activities ?? [];

  // Memoize the layout so we don't recompute positions on every render.
  // Returns null when there's no successful run to render.
  const layout = useMemo(() => {
    if (!run || run.status !== "SUCCESS" || !run.projectFinishDate) return null;
    return buildGanttLayout(activities, run.projectStart, run.projectFinishDate);
  }, [run, activities]);

  // ─── Empty state: no project selected ──────────────────────────────────
  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t("noProject")}</p>
          <Button
            type="button"
            onClick={() => setCurrentView("projects")}
            className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
          >
            {t("goToProjects")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {run
              ? `${run.projectStart} → ${run.projectFinishDate ?? "—"}`
              : t("noSchedule")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentView("scheduling")}
          className="gap-1.5"
        >
          <Play className="w-3.5 h-3.5" />
          {t("goToScheduling")}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : !run || run.status !== "SUCCESS" || !layout ? (
        // No schedule available — prompt the user to run the schedule first.
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium">{t("noSchedule")}</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {t("runFirst")}
          </p>
          <Button
            type="button"
            onClick={() => setCurrentView("scheduling")}
            className="mt-4 bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
          >
            {t("goToScheduling")}
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-primary" />
              <span>{t("critical")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-muted-foreground/40" />
              <span>{t("nonCritical")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rotate-45 bg-primary" />
              <span>{t("milestone")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 bg-muted-foreground" />
              <span>{t("dependency")}</span>
            </div>
          </div>

          {/* Gantt SVG */}
          <div className="rounded-lg border border-border overflow-x-auto bg-card">
            <svg
              width={LABEL_COLUMN_WIDTH + layout.totalDays * DAY_WIDTH + 40}
              height={TOP_PADDING + activities.length * ROW_HEIGHT + 20}
              role="img"
              aria-label={`${t("title")} — ${activities.length} ${t("days")}`}
            >
              {/* Date axis — vertical gridlines + labels */}
              {Array.from({ length: layout.totalDays + 1 }).map((_, i) => {
                const date = new Date(layout.startDate);
                date.setDate(date.getDate() + i);
                const x = LABEL_COLUMN_WIDTH + i * DAY_WIDTH;
                const isWeekend = isWeekendDate(date);
                return (
                  <g key={`axis-${i}`}>
                    {isWeekend && (
                      <rect
                        x={x}
                        y={0}
                        width={DAY_WIDTH}
                        height={
                          TOP_PADDING + activities.length * ROW_HEIGHT
                        }
                        fill="var(--muted)"
                        opacity={0.25}
                      />
                    )}
                    <line
                      x1={x}
                      y1={0}
                      x2={x}
                      y2={TOP_PADDING + activities.length * ROW_HEIGHT}
                      stroke="var(--border)"
                      strokeWidth={0.5}
                    />
                    {i % 7 === 0 && (
                      <text
                        x={x + 2}
                        y={14}
                        fill="var(--muted-foreground)"
                        fontSize={10}
                      >
                        {date.toLocaleDateString("en", {
                          month: "short",
                          day: "numeric",
                        })}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Activity bars */}
              {layout.rows.map((row, i) => {
                const y = TOP_PADDING + i * ROW_HEIGHT;
                const color = row.isCritical
                  ? "var(--primary)"
                  : "var(--muted-foreground)";
                const barY = y + 4;
                const barH = ROW_HEIGHT - 8;

                return (
                  <g key={row.activityId}>
                    {/* Label column */}
                    <text
                      x={8}
                      y={y + ROW_HEIGHT / 2 + 3}
                      fill="var(--foreground)"
                      fontSize={11}
                    >
                      <tspan className="font-mono" fill="var(--muted-foreground)">
                        {row.activityCode}
                      </tspan>
                      <tspan dx={6}>{row.activityNameEn}</tspan>
                    </text>
                    {/* Bar (or diamond for milestones) */}
                    {row.isMilestone ? (
                      <Diamond
                        x={LABEL_COLUMN_WIDTH + row.offsetDays * DAY_WIDTH + DAY_WIDTH / 2}
                        y={barY + barH / 2}
                        size={10}
                        fill={color}
                      />
                    ) : (
                      <rect
                        x={LABEL_COLUMN_WIDTH + row.offsetDays * DAY_WIDTH}
                        y={barY}
                        width={Math.max(2, row.durationDays * DAY_WIDTH)}
                        height={barH}
                        fill={color}
                        rx={2}
                      />
                    )}
                    {/* Float indicator (LS marker for non-critical) */}
                    {!row.isCritical && !row.isMilestone && row.floatDays > 0 && (
                      <>
                        <rect
                          x={
                            LABEL_COLUMN_WIDTH +
                            (row.offsetDays + row.durationDays) * DAY_WIDTH
                          }
                          y={barY + barH / 2 - 1}
                          width={row.floatDays * DAY_WIDTH}
                          height={2}
                          fill="var(--muted-foreground)"
                          opacity={0.4}
                        />
                        <text
                          x={
                            LABEL_COLUMN_WIDTH +
                            (row.offsetDays + row.durationDays + row.floatDays) *
                              DAY_WIDTH +
                            2
                          }
                          y={y + ROW_HEIGHT / 2 + 3}
                          fill="var(--muted-foreground)"
                          fontSize={9}
                        >
                          +{row.floatDays}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {/* Dependency arrows */}
              {layout.arrows.map((arr, i) => (
                <DependencyArrow key={`dep-${i}`} arrow={arr} />
              ))}

              {/* Horizontal row separators (subtle) */}
              {layout.rows.map((_, i) => {
                const y = TOP_PADDING + (i + 1) * ROW_HEIGHT;
                return (
                  <line
                    key={`sep-${i}`}
                    x1={0}
                    y1={y}
                    x2={
                      LABEL_COLUMN_WIDTH + layout.totalDays * DAY_WIDTH
                    }
                    y2={y}
                    stroke="var(--border)"
                    strokeWidth={0.25}
                    opacity={0.5}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function Diamond({
  x,
  y,
  size,
  fill,
}: {
  x: number;
  y: number;
  size: number;
  fill: string;
}) {
  const half = size / 2;
  const points = [
    `${x},${y - half}`,
    `${x + half},${y}`,
    `${x},${y + half}`,
    `${x - half},${y}`,
  ].join(" ");
  return <polygon points={points} fill={fill} />;
}

function DependencyArrow({
  arrow,
}: {
  arrow: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}) {
  // Simple orthogonal connector: horizontal segment out of the source's
  // right edge, vertical down/up to the target row, then a small horizontal
  // stub into the target's left edge. Phase 2 scope: no curved Bezier paths.
  const midX = (arrow.x1 + arrow.x2) / 2;
  const path = `M ${arrow.x1} ${arrow.y1} L ${midX} ${arrow.y1} L ${midX} ${arrow.y2} L ${arrow.x2 - 4} ${arrow.y2}`;
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth={1}
        opacity={0.6}
      />
      {/* Arrowhead */}
      <polygon
        points={`${arrow.x2 - 4},${arrow.y2 - 3} ${arrow.x2},${arrow.y2} ${arrow.x2 - 4},${arrow.y2 + 3}`}
        fill="var(--muted-foreground)"
        opacity={0.6}
      />
    </g>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────

interface GanttRow {
  activityId: string;
  activityCode: string;
  activityNameEn: string;
  offsetDays: number; // calendar-day offset from project start
  durationDays: number; // calendar-day span (>= 1 for normal bars, 0 for milestones)
  isMilestone: boolean;
  isCritical: boolean;
  floatDays: number;
}

interface GanttArrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface GanttLayout {
  startDate: Date;
  totalDays: number;
  rows: GanttRow[];
  arrows: GanttArrow[];
}

function buildGanttLayout(
  activities: ScheduleActivityApi[],
  projectStart: string,
  projectFinish: string,
): GanttLayout | null {
  const startMs = Date.parse(projectStart);
  const finishMs = Date.parse(projectFinish);
  if (Number.isNaN(startMs) || Number.isNaN(finishMs) || finishMs < startMs) {
    return null;
  }
  const startDate = new Date(startMs);
  const finishDate = new Date(finishMs);
  const totalDays =
    Math.ceil((finishMs - startMs) / 86_400_000) + 1; // inclusive of finish day

  // Sort activities by ES then code for a deterministic, time-ordered render.
  const sorted = [...activities].sort((a, b) => {
    const aes = Date.parse(a.es);
    const bes = Date.parse(b.es);
    if (aes !== bes) return aes - bes;
    return a.activityCode.localeCompare(b.activityCode);
  });

  // Index by activityId for O(1) lookup when drawing dependency arrows.
  const indexById = new Map<string, number>();
  sorted.forEach((a, i) => indexById.set(a.activityId, i));

  const rows: GanttRow[] = sorted.map((a) => {
    const esMs = Date.parse(a.es);
    const efMs = Date.parse(a.ef);
    const offsetDays = Math.max(
      0,
      Math.round((esMs - startMs) / 86_400_000),
    );
    const durationDays = a.isMilestone
      ? 0
      : Math.max(1, Math.round((efMs - esMs) / 86_400_000) + 1);
    return {
      activityId: a.activityId,
      activityCode: a.activityCode,
      activityNameEn: a.activityNameEn,
      offsetDays,
      durationDays,
      isMilestone: a.isMilestone,
      isCritical: a.isCritical,
      floatDays: Math.max(0, a.totalFloatDays),
    };
  });

  // Dependency arrows: for each activity's relationships where the
  // predecessor is also in the chart, draw a connector from the predecessor's
  // finish bar (or start, depending on type) to the successor's start (or
  // finish). For Phase 2 simplicity we always connect right-edge of pred to
  // left-edge of succ regardless of FS/SS/FF/SF — the bar shape carries the
  // duration info; the dependency arrows just show topology.
  const arrows: GanttArrow[] = [];
  for (const a of activities) {
    if (!a.relationships) continue;
    for (const rel of a.relationships) {
      // The relationship endpoint we care about is the successor side (this
      // activity if it's the successor; otherwise the other activity).
      const succIdx = indexById.get(rel.successorId);
      const predIdx = indexById.get(rel.predecessorId);
      if (succIdx === undefined || predIdx === undefined) continue;
      const predRow = rows[predIdx];
      const succRow = rows[succIdx];
      const predX =
        LABEL_COLUMN_WIDTH +
        (predRow.offsetDays + Math.max(1, predRow.durationDays)) * DAY_WIDTH;
      const predY = TOP_PADDING + predIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      const succX = LABEL_COLUMN_WIDTH + succRow.offsetDays * DAY_WIDTH;
      const succY = TOP_PADDING + succIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      arrows.push({ x1: predX, y1: predY, x2: succX, y2: succY });
    }
  }

  return { startDate, totalDays, rows, arrows };
}

function isWeekendDate(d: Date): boolean {
  const day = d.getDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}
