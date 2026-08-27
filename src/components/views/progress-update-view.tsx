"use client";

/**
 * ProgressUpdateView (S27) — Data date picker → activity % complete table → save.
 *
 * Per SPEC_PHASE4_WEB.md §2 + §6 (S27): pick a data date, fill in activity
 * % complete values, save. The pure earned-value computation is downstream
 * (project dashboard), not here.
 *
 * Data:
 *   - GET  /api/projects/[projectId]/activities   → { activities }
 *   - GET  /api/projects/[projectId]/progress     → { updates }
 *   - POST /api/projects/[projectId]/progress     → ProgressUpdate
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No activities → "Create activities first" CTA → scheduling-view.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TrendingUp, Loader2, Save } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ActivityApi {
  id: string;
  projectId: string;
  code: string;
  nameEn: string;
  duration: number;
  isMilestone: boolean;
}

interface ActivitiesListResponse {
  activities: ActivityApi[];
}

interface ProgressUpdateApi {
  id: string;
  projectId: string;
  dataDate: string;
  scheduleRunId: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
}

interface ProgressListResponse {
  updates: ProgressUpdateApi[];
}

function todayIso() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ProgressUpdateView() {
  const t = useTranslations("progress");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [dataDate, setDataDate] = useState(todayIso());
  const [pcts, setPcts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");

  const { data: activitiesData, isLoading: activitiesLoading } =
    useQuery<ActivitiesListResponse>({
      queryKey: currentProjectId
        ? queryKeys.activities.list(currentProjectId)
        : ["activities", "_disabled"],
      queryFn: () =>
        fetchJson<ActivitiesListResponse>(`/api/projects/${currentProjectId}/activities`),
      enabled: !!currentProjectId,
    });

  const { data: progressData } = useQuery<ProgressListResponse>({
    queryKey: currentProjectId
      ? queryKeys.progress.list(currentProjectId)
      : ["progress", "_disabled"],
    queryFn: () =>
      fetchJson<ProgressListResponse>(`/api/projects/${currentProjectId}/progress`),
    enabled: !!currentProjectId,
  });

  const activities = activitiesData?.activities ?? [];
  const updates = progressData?.updates ?? [];

  const saveMutation = useMutation({
    mutationFn: (vars: {
      dataDate: string;
      notes: string | null;
      activityProgress: { activityId: string; percentComplete: number }[];
    }) =>
      apiPost<ProgressUpdateApi>(`/api/projects/${currentProjectId}/progress`, {
        dataDate: vars.dataDate,
        notes: vars.notes,
        activityProgress: vars.activityProgress,
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({ queryKey: queryKeys.progress.list(currentProjectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projectDashboard.detail(currentProjectId) });
      toast.success(t("saved"));
      setPcts({});
      setNotes("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <TrendingUp className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t("noProject")}</p>
          <Button
            type="button"
            onClick={() => setCurrentView("projects")}
            className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)]"
          >
            {t("goToProjects")}
          </Button>
        </div>
      </div>
    );
  }

  function submit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
      toast.error("Data date must be ISO yyyy-MM-dd");
      return;
    }
    const activityProgress = activities
      .filter((a) => pcts[a.id] !== undefined)
      .map((a) => ({
        activityId: a.id,
        percentComplete: Math.max(0, Math.min(100, Math.round(pcts[a.id]))),
      }));
    if (activityProgress.length === 0) {
      toast.error(t("enterAtLeastOne"));
      return;
    }
    saveMutation.mutate({
      dataDate,
      notes: notes.trim() || null,
      activityProgress,
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {updates.length} {updates.length === 1 ? "update" : "updates"} saved
          </p>
        </div>
      </div>

      {/* Header fields */}
      <div className="rounded-lg border border-border p-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="dataDate">{t("dataDate")}</Label>
          <Input
            id="dataDate"
            type="date"
            value={dataDate}
            onChange={(e) => setDataDate(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1 flex-1 min-w-64">
          <Label htmlFor="notes">{t("notes")}</Label>
          <Input
            id="notes"
            value={notes}
            placeholder={t("notesPlaceholder")}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <Button
          type="button"
          onClick={submit}
          disabled={saveMutation.isPending || activities.length === 0}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {tc("save")}
        </Button>
      </div>

      {/* Activities table */}
      {activitiesLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : activities.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <h3 className="text-sm font-medium">{t("empty")}</h3>
          <Button
            type="button"
            onClick={() => setCurrentView("activities")}
            className="mt-4 bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)]"
          >
            {t("goToActivities")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">{t("code")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">{t("activity")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-20">{t("duration")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-32">{t("percentComplete")}</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-xs">{a.code}</td>
                  <td className="px-4 py-2">
                    {a.nameEn}
                    {a.isMilestone && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                        milestone
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{a.duration}d</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={pcts[a.id] ?? ""}
                        onChange={(e) =>
                          setPcts({
                            ...pcts,
                            [a.id]: Number(e.target.value),
                          })
                        }
                        className="h-7 w-20"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Saved updates list */}
      {updates.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("recentUpdates")}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {updates.slice(0, 10).map((u) => (
              <div
                key={u.id}
                className="px-4 py-2 border-b border-border last:border-0 text-sm font-mono text-xs"
              >
                <span className="text-foreground">{u.dataDate}</span>
                {u.notes && (
                  <span className="ml-3 text-muted-foreground">{u.notes}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
