"use client";

/**
 * SchedulingView (S11) — Scheduling Dashboard.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S11): shows the latest schedule run summary
 * (project start, finish, critical path length), warnings, and a "Run
 * schedule" button.
 *
 * Data:
 *   - GET  /api/projects/[projectId]/scheduling/current → { run, activities }
 *   - POST /api/projects/[projectId]/scheduling/run     → { run, activities }
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA (same pattern as BoQ editor).
 *   - No schedule runs yet → "Run schedule to compute the critical path"
 *     with a Run button.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  CalendarDays,
  Play,
  Loader2,
  AlertTriangle,
  ArrowRight,
  CircleSlash,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────

type ScheduleRunStatus = "SUCCESS" | "CYCLE_DETECTED" | "VALIDATION_ERROR";

interface ScheduleRunApi {
  id: string;
  projectId: string;
  projectStart: string; // ISO yyyy-MM-dd (BR-P1)
  status: ScheduleRunStatus;
  projectFinishDate: string | null; // ISO yyyy-MM-dd when success, null otherwise
  criticalPath: string[] | null; // activity IDs (parsed from criticalPathJson)
  warnings: Array<{ code: string; message: string; activityId?: string }> | null;
  errors: unknown | null; // cycle/validation error payload (parsed from errorJson)
  runById: string;
  createdAt: string; // ISO datetime
}

interface ScheduleActivityApi {
  id: string;
  scheduleRunId: string;
  activityId: string;
  activityCode: string; // joined from Activity for display (Group L responsibility)
  activityNameEn: string;
  isMilestone: boolean;
  es: string; // ISO yyyy-MM-dd — early start
  ef: string; // ISO yyyy-MM-dd — early finish
  ls: string; // ISO yyyy-MM-dd — late start
  lf: string; // ISO yyyy-MM-dd — late finish
  totalFloatDays: number; // working days (BR-P12)
  isCritical: boolean;
}

interface CurrentScheduleResponse {
  run: ScheduleRunApi | null;
  activities: ScheduleActivityApi[];
}

interface RunScheduleResponse {
  run: ScheduleRunApi;
  activities: ScheduleActivityApi[];
}

// ─── Component ────────────────────────────────────────────────────────────

export function SchedulingView() {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const ta = useTranslations("activities");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  // Fetch the latest schedule run + its activities. Disabled when no project
  // is selected (the empty state handles that case).
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

  // "Run schedule" — POST to the run endpoint. The server runs the pure CPM
  // engine, persists a ScheduleRun + ScheduleActivity rows in one
  // transaction (BR-WEB-P1), and returns the new run + activities.
  const runMutation = useMutation({
    mutationFn: () =>
      apiPost<RunScheduleResponse>(
        `/api/projects/${currentProjectId}/scheduling/run`,
        {},
      ),
    onSuccess: () => {
      // Invalidate the "current schedule" query so the dashboard refreshes.
      if (currentProjectId) {
        qc.invalidateQueries({
          queryKey: queryKeys.schedule.current(currentProjectId),
        });
      }
      toast.success("Schedule computed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ─── Empty state: no project selected ──────────────────────────────────
  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <CalendarDays className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t("noProject")}</p>
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              onClick={() => setCurrentView("projects")}
              className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)]"
            >
              {t("goToProjects")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentView("dashboard")}
            >
              {t("goToDashboard")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const run = data?.run ?? null;
  const activities = data?.activities ?? [];
  const criticalPath = run?.criticalPath ?? [];

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {run
              ? `${t("latestRun")} · ${formatDateTime(run.createdAt)}`
              : t("noRuns")}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          {runMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {t("runSchedule")}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : !run ? (
        // No schedule runs yet — prompt the user to run the schedule.
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <CalendarDays className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium">{t("noRuns")}</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {t("runToCompute")}
          </p>
          <Button
            type="button"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="mt-4 bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
          >
            {runMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {t("runSchedule")}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Status banner — show errors prominently */}
          {run.status !== "SUCCESS" && (
            <div className="rounded-lg border border-[var(--linear-warning-border,rgb(251,146,60,0.4))] bg-[var(--linear-warning-bg,rgba(251,146,60,0.08))] p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--linear-warning,rgb(251,146,60))] mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {run.status === "CYCLE_DETECTED"
                      ? t("cycleDetected")
                      : t("validationError")}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono break-all">
                    {run.status === "CYCLE_DETECTED"
                      ? `cycle: ${JSON.stringify(run.errors)}`
                      : `errors: ${JSON.stringify(run.errors)}`}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Summary stat cards */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard
              label={t("projectStart")}
              value={run.projectStart}
              hint="ISO yyyy-MM-dd"
            />
            <StatCard
              label={t("projectFinish")}
              value={run.projectFinishDate ?? "—"}
              hint={
                run.status === "SUCCESS"
                  ? `${activities.length} ${t("activities").toLowerCase()}`
                  : run.status === "CYCLE_DETECTED"
                    ? t("statusCycle")
                    : t("statusValidation")
              }
            />
            <StatCard
              label={t("criticalPath")}
              value={
                run.status === "SUCCESS"
                  ? String(criticalPath.length)
                  : "—"
              }
              hint={
                run.status === "SUCCESS"
                  ? t("criticalPathLength", { count: criticalPath.length })
                  : ""
              }
            />
          </section>

          {/* Quick link to the Gantt view */}
          {run.status === "SUCCESS" && (
            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentView("gantt")}
                className="gap-1.5"
              >
                {t("viewGantt")}
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {/* Critical path list (success only) */}
          {run.status === "SUCCESS" && criticalPath.length > 0 && (
            <section className="rounded-lg border border-border p-4 space-y-2">
              <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
                {t("criticalPath")}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
                {criticalPath.map((id, i) => {
                  const act = activities.find((a) => a.activityId === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded bg-muted/50 border border-border">
                        {act?.activityCode ?? id}
                      </span>
                      {i < criticalPath.length - 1 && (
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      )}
                    </span>
                  );
                })}
              </div>
            </section>
          )}

          {/* Warnings */}
          {run.warnings && run.warnings.length > 0 && (
            <section className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--linear-warning,rgb(251,146,60))]" />
                <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
                  {t("warnings")}
                </h2>
                <span className="text-xs text-muted-foreground">
                  ({run.warnings.length})
                </span>
              </div>
              <ul className="space-y-1.5 text-xs">
                {run.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 font-mono">
                    <span className="px-1.5 py-0.5 rounded bg-muted/50 border border-border text-[10px] shrink-0">
                      {w.code}
                    </span>
                    <span className="text-foreground">{w.message}</span>
                    {w.activityId && (
                      <span className="text-muted-foreground">
                        · {w.activityId}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Activities table (success only) */}
          {run.status === "SUCCESS" && activities.length === 0 && (
            <div className="rounded-lg border border-border border-dashed p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
              <CircleSlash className="w-5 h-5" />
              <p>{t("noActivities")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentView("activities")}
              >
                {t("activities")}
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          )}

          {run.status === "SUCCESS" && activities.length > 0 && (
            <section className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                      {ta("code")}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {ta("name")}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-28 text-right">
                      ES
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-28 text-right">
                      EF
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-28 text-right">
                      LS
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-28 text-right">
                      LF
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-20 text-right">
                      Float
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-20 text-center">
                      Critical
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {a.activityCode}
                      </td>
                      <td className="px-4 py-2">
                        <span className="font-medium">{a.activityNameEn}</span>
                        {a.isMilestone && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-muted/50 border border-border text-muted-foreground uppercase">
                            milestone
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {a.es}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {a.ef}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                        {a.ls}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                        {a.lf}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {a.totalFloatDays}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {a.isCritical ? (
                          <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4 bg-card">
      <div className="text-xs uppercase tracking-wide font-medium text-muted-foreground mb-2">
        {label}
      </div>
      <div className="text-xl font-semibold tracking-tight font-mono">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
