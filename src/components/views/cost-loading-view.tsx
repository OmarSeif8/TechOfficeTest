"use client";

/**
 * CostLoadingView (S26) — Two-way link editor: BoQ items ↔ activities.
 *
 * Per SPEC_PHASE4_WEB.md §2 + §6 (S26): per-BoQ-item allocation editor with
 * validation (sum must = 100% per BR-CS1) + coverage report (BR-CS4).
 *
 * Data:
 *   - GET  /api/projects/[projectId]/cost-loading   → { boqItems, activities, links, coverage }
 *   - POST /api/projects/[projectId]/cost-loading   → { allocations } (replace for one BoQ item)
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No BoQ items → user must create them first (redirect to BoQ editor).
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Link2, Loader2, Plus, Trash2, AlertTriangle } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface BoQItemLite {
  id: string;
  code: string | null;
  descriptionEn: string;
  amount: string;
}

interface ActivityLite {
  id: string;
  code: string;
  nameEn: string;
}

interface LinkRow {
  id: string;
  boqItemId: string;
  activityId: string;
  allocationPct: string;
}

interface CoveragePerItem {
  boqItemId: string;
  boqItemCode: string | null;
  boqItemDescriptionEn: string;
  linkedValue: string;
  totalValue: string;
  linked: boolean;
}

interface CostLoadingResponse {
  boqItems: BoQItemLite[];
  activities: ActivityLite[];
  links: LinkRow[];
  coverage: {
    totalLinked: string;
    totalBoQValue: string;
    coveragePct: string;
    perItem: CoveragePerItem[];
  };
  activityPlannedCost: Record<string, string>;
}

interface AllocRow {
  activityId: string;
  allocationPct: string;
}

export function CostLoadingView() {
  const t = useTranslations("costLoading");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [selectedBoqItemId, setSelectedBoqItemId] = useState<string | null>(null);
  const [draftAllocs, setDraftAllocs] = useState<AllocRow[]>([]);

  const { data, isLoading } = useQuery<CostLoadingResponse>({
    queryKey: currentProjectId
      ? queryKeys.costLoading.detail(currentProjectId)
      : ["cost-loading", "_disabled"],
    queryFn: () =>
      fetchJson<CostLoadingResponse>(`/api/projects/${currentProjectId}/cost-loading`),
    enabled: !!currentProjectId,
  });

  const boqItems = data?.boqItems ?? [];
  const activities = data?.activities ?? [];
  const links = data?.links ?? [];
  const coverage = data?.coverage;

  // Allocations for the currently selected BoQ item.
  const selectedAllocs = useMemo(
    () => (selectedBoqItemId ? links.filter((l) => l.boqItemId === selectedBoqItemId) : []),
    [links, selectedBoqItemId],
  );

  // Sync draft allocations when the selection changes ("adjust state during
  // render" pattern — per React docs — avoids setState-in-effect lint rule).
  // Tracks the previous (selectedBoqItemId, saved link count) pair so we
  // re-sync only when the selection actually changes OR when the saved links
  // list grows/shrinks (e.g. after a save mutation).
  const [prevSyncKey, setPrevSyncKey] = useState<string>("");
  const syncKey = `${selectedBoqItemId ?? ""}#${selectedAllocs.length}`;
  if (selectedBoqItemId && syncKey !== prevSyncKey) {
    setPrevSyncKey(syncKey);
    setDraftAllocs(
      selectedAllocs.map((l) => ({
        activityId: l.activityId,
        allocationPct: l.allocationPct,
      })),
    );
  }

  // Sum of draft allocation percentages (decimal-exact check, but we display the float).
  const sumPct = useMemo(() => {
    return draftAllocs.reduce((s, a) => {
      const n = Number.parseFloat(a.allocationPct);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [draftAllocs]);

  const sumOk = Math.abs(sumPct - 100) < 0.005;

  const saveMutation = useMutation({
    mutationFn: (vars: { boqItemId: string; allocations: AllocRow[] }) =>
      apiPost(`/api/projects/${currentProjectId}/cost-loading`, {
        boqItemId: vars.boqItemId,
        allocations: vars.allocations,
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({ queryKey: queryKeys.costLoading.detail(currentProjectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projectDashboard.detail(currentProjectId) });
      toast.success(t("saved"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <Link2 className="w-5 h-5 text-muted-foreground" />
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

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("coverage")}: {coverage?.coveragePct ?? "0.00"}% ·{" "}
            {t("linked")}: {coverage?.totalLinked ?? "0.00"} /{" "}
            {coverage?.totalBoQValue ?? "0.00"}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : boqItems.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <h3 className="text-sm font-medium">{t("empty")}</h3>
          <Button
            type="button"
            onClick={() => setCurrentView("boq")}
            className="mt-4 bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)]"
          >
            {t("goToBoq")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: BoQ items list with coverage badges */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t("boqItems")} ({boqItems.length})
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {boqItems.map((b) => {
                const cov = coverage?.perItem.find((c) => c.boqItemId === b.id);
                const linked = cov?.linked ?? false;
                const isSelected = selectedBoqItemId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBoqItemId(b.id)}
                    className={`w-full text-left px-4 py-2 border-b border-border last:border-0 transition-colors ${
                      isSelected ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {b.code ?? "—"}
                          </span>
                          {b.descriptionEn}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {cov?.linkedValue ?? "0.00"} / {cov?.totalValue ?? b.amount}
                        </div>
                      </div>
                      <div className="ml-2">
                        {linked ? (
                          <span className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            {t("linked")}
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                            {t("unlinked")}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Allocation editor for selected BoQ item */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {selectedBoqItemId ? t("allocations") : t("selectBoqItem")}
            </div>
            {!selectedBoqItemId ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {t("selectBoqItemPrompt")}
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {draftAllocs.map((alloc, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={alloc.activityId}
                      onValueChange={(v) => {
                        const next = [...draftAllocs];
                        next[i] = { ...next[i], activityId: v };
                        setDraftAllocs(next);
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t("selectActivity")} />
                      </SelectTrigger>
                      <SelectContent>
                        {activities.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.code} — {a.nameEn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      className="w-24"
                      value={alloc.allocationPct}
                      onChange={(e) => {
                        const next = [...draftAllocs];
                        next[i] = { ...next[i], allocationPct: e.target.value };
                        setDraftAllocs(next);
                      }}
                    />
                    <span className="text-xs text-muted-foreground w-4">%</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setDraftAllocs(draftAllocs.filter((_, idx) => idx !== i));
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDraftAllocs([
                        ...draftAllocs,
                        { activityId: activities[0]?.id ?? "", allocationPct: "0" },
                      ])
                    }
                    disabled={activities.length === 0}
                    className="gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("addAllocation")}
                  </Button>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-mono ${
                        sumOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      Σ = {sumPct.toFixed(2)}%
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!sumOk || saveMutation.isPending}
                      onClick={() =>
                        saveMutation.mutate({
                          boqItemId: selectedBoqItemId,
                          allocations: draftAllocs.filter((a) => a.activityId),
                        })
                      }
                      className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
                    >
                      {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {tc("save")}
                    </Button>
                  </div>
                </div>
                {!sumOk && draftAllocs.length > 0 && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {t("mustSum100")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
