/**
 * GET /api/projects/[projectId]/scheduling/current
 *
 * Current Schedule API — returns the latest ScheduleRun + its ScheduleActivity
 * rows (the "current" schedule per BR-WEB-P3 — latest by createdAt).
 *
 * Per SPEC_PHASE2_WEB.md §6 (S11 Scheduling Dashboard, S15 Gantt Chart).
 * Per BR-WEB-P3: ScheduleRuns are immutable; "current" = latest by createdAt.
 * Per BR-WEB-P4: the Gantt UI fetches via this route.
 *
 * Per BR-WEB-5: verify the project is owned by the session user
 *           (missing-or-not-owned → 404).
 *
 * If no ScheduleRuns exist for the project, returns 404. The UI then shows
 * a "Run schedule" CTA.
 *
 * The response shape:
 *   {
 *     run: ScheduleRun,                    // immutable row (status, finishDate, JSON)
 *     activities: ScheduleActivity[],       // one per computed activity (empty on cycle/validation)
 *     result: ScheduleResult                // parsed-back ScheduleResult (success | cycle | validation)
 *   }
 *
 * The `result` field is reconstructed from the ScheduleRun's JSON columns so
 * the UI has the exact same shape as the POST run response — no special
 * handling for "this came from a stored row vs a fresh run".
 */

import {
  withErrorHandler,
  json,
  notFound,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import type { ScheduleResult } from "@shared/schemas/scheduling/network";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/**
 * Reconstruct a ScheduleResult (the engine's discriminated union) from the
 * ScheduleRun's stored JSON columns. Used so the GET response matches the
 * POST response shape — the UI doesn't need to know whether the data is fresh
 * or recalled from the DB.
 *
 * - status === "SUCCESS": build a "success" result with projectFinishDate +
 *   criticalPath (from JSON) + warnings (from JSON) + activities from the
 *   ScheduleActivity rows (mapped back to ComputedActivity shape).
 * - status === "CYCLE_DETECTED": build a "cycle" result with cycleActivityIds
 *   parsed from errorJson.
 * - status === "VALIDATION_ERROR": build a "validation" result with errors
 *   parsed from errorJson.
 *
 * Note: the stored ScheduleActivity rows don't carry the activity code or
 * duration (only the activityId + es/ef/ls/lf/float/critical). The full
 * ComputedActivity type requires those, so we synthesize them as empty
 * strings / 0 — the UI doesn't need them for the Gantt; it looks them up
 * from the project's activities list by id when needed.
 */
function rebuildResult(
  run: {
    status: "SUCCESS" | "CYCLE_DETECTED" | "VALIDATION_ERROR";
    projectFinishDate: string | null;
    criticalPathJson: string | null;
    warningsJson: string | null;
    errorJson: string | null;
  },
  activities: Array<{
    activityId: string;
    es: string;
    ef: string;
    ls: string;
    lf: string;
    totalFloatDays: number;
    isCritical: boolean;
  }>,
): ScheduleResult {
  const criticalPath = run.criticalPathJson
    ? (JSON.parse(run.criticalPathJson) as string[])
    : [];
  const warnings = run.warningsJson
    ? (JSON.parse(run.warningsJson) as Array<{ code: string; message: string; activityId?: string }>)
    : [];

  if (run.status === "SUCCESS") {
    return {
      kind: "success",
      activities: activities.map((a) => ({
        id: a.activityId,
        code: "", // not stored on ScheduleActivity; UI looks up by id
        duration: 0, // not stored; UI looks up
        type: "TASK" as const, // not stored; UI looks up
        esIndex: 0, efIndex: 0, lsIndex: 0, lfIndex: 0, // not stored
        es: a.es,
        ef: a.ef,
        ls: a.ls,
        lf: a.lf,
        totalFloat: a.totalFloatDays,
        isCritical: a.isCritical,
      })),
      projectFinishDate: run.projectFinishDate ?? "",
      projectFinishIndex: 0, // not stored; UI doesn't need it for Gantt
      criticalPath,
      warnings,
    };
  }

  if (run.status === "CYCLE_DETECTED") {
    const errorPayload = run.errorJson
      ? (JSON.parse(run.errorJson) as { cycleActivityIds: string[] })
      : { cycleActivityIds: [] };
    return {
      kind: "cycle",
      cycleActivityIds: errorPayload.cycleActivityIds ?? [],
    };
  }

  // VALIDATION_ERROR
  const errorPayload = run.errorJson
    ? (JSON.parse(run.errorJson) as { errors: Array<{ code: string; message: string; activityId?: string; relationshipIndex?: number }> })
    : { errors: [] };
  return {
    kind: "validation",
    errors: errorPayload.errors ?? [],
  };
}

// ─── GET current ──────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const latestRun = await services.schedules.getLatestRun(projectId);
  if (!latestRun) {
    return json({ run: null, activities: [], result: null });
  }

  // Fetch the ScheduleActivity rows for this run (empty if status != SUCCESS).
  const runWithActivities = await services.schedules.getRunById(latestRun.id);
  if (!runWithActivities) {
    // Defensive — the run was just fetched by id, it should still exist.
    return notFound("Schedule run not found");
  }

  const { run, activities } = runWithActivities;
  const result = rebuildResult(run, activities);

  return json({ run, activities, result });
});
