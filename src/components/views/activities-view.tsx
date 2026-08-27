"use client";

/**
 * ActivitiesView (S13) — Activities list + relationships editor.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S13): table with Code | Name (EN/AR) | Duration
 * | WBS Node | Type (Task/Milestone) | Actions. "Add activity" CTA at the top.
 * Inline duration editing (same InlineEdit pattern as BoQ editor). A detail
 * sheet shows the activity's relationships (predecessors + successors) with
 * add/remove via the relationships API.
 *
 * Data:
 *   - GET    /api/projects/[projectId]/activities      → { activities }
 *   - POST   /api/projects/[projectId]/activities      → Activity (created)
 *   - PATCH  /api/activities/[activityId]              → Activity (updated)
 *   - DELETE /api/activities/[activityId]              → 204 (soft-delete)
 *   - GET    /api/activities/[activityId]/relationships → { relationships }
 *   - POST   /api/activities/[activityId]/relationships → Relationship (created)
 *   - DELETE /api/relationships/[relationshipId]        → 204
 *
 * Optimistic concurrency: Activity has `version` (per Group K schema).
 * PATCH + DELETE carry `expectedVersion` (BR-WEB-4) — a 409 surfaces as a
 * toast and the query is invalidated so the user sees the server's truth.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ListChecks,
  Plus,
  Trash2,
  Loader2,
  Pencil,
  ArrowRight,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost, apiPatch, apiDelete } from "@/lib/mutations";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────

interface ActivityApi {
  id: string;
  projectId: string;
  wbsNodeId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  duration: number; // working days, ≥ 0 (BR-P3)
  isMilestone: boolean;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface WbsNodeApi {
  id: string;
  projectId: string;
  parentId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
}

interface RelationshipApi {
  id: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: "FS" | "SS" | "FF" | "SF";
  lag: number;
  // Joined fields for display (Group L responsibility to populate):
  predecessorCode?: string;
  predecessorNameEn?: string;
  successorCode?: string;
  successorNameEn?: string;
}

interface ActivitiesListResponse {
  activities: ActivityApi[];
}

interface WbsListResponse {
  nodes: WbsNodeApi[];
}

interface RelationshipsResponse {
  relationships: RelationshipApi[];
}

// ─── Component ────────────────────────────────────────────────────────────

export function ActivitiesView() {
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [editing, setEditing] = useState<{
    id: string | null; // null = creating
    code: string;
    nameEn: string;
    nameAr: string;
    duration: number;
    isMilestone: boolean;
    wbsNodeId: string | null;
    version?: number;
  } | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ActivitiesListResponse>({
    queryKey: currentProjectId
      ? queryKeys.activities.list(currentProjectId)
      : ["activities", "list", "_disabled"],
    queryFn: () =>
      fetchJson<ActivitiesListResponse>(
        `/api/projects/${currentProjectId}/activities`,
      ),
    enabled: !!currentProjectId,
  });

  // Fetch the WBS nodes so the activity create/edit form can show a
  // "WBS Node" dropdown. The list is small — fine to load alongside.
  const { data: wbsData } = useQuery<WbsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.wbs.list(currentProjectId)
      : ["wbs", "list", "_disabled"],
    queryFn: () =>
      fetchJson<WbsListResponse>(`/api/projects/${currentProjectId}/wbs`),
    enabled: !!currentProjectId,
  });

  const activities = data?.activities ?? [];
  const wbsNodes = wbsData?.nodes ?? [];

  // Sort by sortOrder for stable display.
  const sortedActivities = useMemo(
    () => [...activities].sort((a, b) => a.sortOrder - b.sortOrder),
    [activities],
  );

  // ─── Mutations (declared unconditionally above the early return so the
  // Rules of Hooks hold — the no-project branch renders no mutation UI, but
  // React still requires the same hook call sequence every render). ──────
  const createMutation = useMutation({
    mutationFn: (vars: {
      code: string;
      nameEn: string;
      nameAr: string;
      duration: number;
      isMilestone: boolean;
      wbsNodeId: string | null;
    }) =>
      apiPost<ActivityApi>(`/api/projects/${currentProjectId ?? ""}/activities`, {
        projectId: currentProjectId,
        wbsNodeId: vars.wbsNodeId,
        code: vars.code,
        nameEn: vars.nameEn,
        nameAr: vars.nameAr || null,
        duration: vars.duration,
        isMilestone: vars.isMilestone,
        sortOrder: activities.length,
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.activities.list(currentProjectId),
      });
      toast.success("Activity created");
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      code: string;
      nameEn: string;
      nameAr: string;
      duration: number;
      isMilestone: boolean;
      wbsNodeId: string | null;
      expectedVersion: number;
    }) =>
      apiPatch<ActivityApi>(`/api/activities/${vars.id}`, {
        code: vars.code,
        nameEn: vars.nameEn,
        nameAr: vars.nameAr || null,
        duration: vars.duration,
        isMilestone: vars.isMilestone,
        wbsNodeId: vars.wbsNodeId,
        expectedVersion: vars.expectedVersion,
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.activities.list(currentProjectId),
      });
      toast.success("Activity saved");
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (vars: { id: string; expectedVersion: number }) =>
      apiDelete<void>(
        `/api/activities/${vars.id}?expectedVersion=${vars.expectedVersion}`,
      ),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.activities.list(currentProjectId),
      });
      toast.success("Activity deleted");
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
            <ListChecks className="w-5 h-5 text-muted-foreground" />
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

  function openCreate() {
    setEditing({
      id: null,
      code: "",
      nameEn: "",
      nameAr: "",
      duration: 1,
      isMilestone: false,
      wbsNodeId: null,
    });
  }
  function openEdit(a: ActivityApi) {
    setEditing({
      id: a.id,
      code: a.code,
      nameEn: a.nameEn,
      nameAr: a.nameAr ?? "",
      duration: a.duration,
      isMilestone: a.isMilestone,
      wbsNodeId: a.wbsNodeId,
      version: a.version,
    });
  }
  function submitEdit() {
    if (!editing) return;
    if (!editing.code.trim() || !editing.nameEn.trim()) {
      toast.error("Code and name (EN) are required");
      return;
    }
    if (editing.duration < 0) {
      toast.error("Duration must be ≥ 0");
      return;
    }
    if (editing.id && editing.version !== undefined) {
      updateMutation.mutate({
        id: editing.id,
        code: editing.code.trim(),
        nameEn: editing.nameEn.trim(),
        nameAr: editing.nameAr.trim(),
        duration: editing.duration,
        isMilestone: editing.isMilestone,
        wbsNodeId: editing.wbsNodeId,
        expectedVersion: editing.version,
      });
    } else {
      createMutation.mutate({
        code: editing.code.trim(),
        nameEn: editing.nameEn.trim(),
        nameAr: editing.nameAr.trim(),
        duration: editing.duration,
        isMilestone: editing.isMilestone,
        wbsNodeId: editing.wbsNodeId,
      });
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activities.length}{" "}
            {activities.length === 1 ? t("title").toLowerCase() : t("title").toLowerCase()}
          </p>
        </div>
        <Button
          type="button"
          onClick={openCreate}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("addActivity")}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : sortedActivities.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <ListChecks className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {t("empty")}
          </p>
          <Button
            type="button"
            onClick={openCreate}
            className="mt-4 bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("addActivity")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                  {t("code")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground">
                  {t("name")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28 text-right">
                  {t("duration")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-40">
                  {t("wbsNode")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28">
                  {t("type")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28 text-right" />
              </tr>
            </thead>
            <tbody>
              {sortedActivities.map((a) => (
                <ActivityRow
                  key={a.id}
                  activity={a}
                  wbsNodes={wbsNodes}
                  onEdit={() => openEdit(a)}
                  onDelete={() => {
                    if (window.confirm(t("deleteConfirm"))) {
                      deleteMutation.mutate({
                        id: a.id,
                        expectedVersion: a.version,
                      });
                    }
                  }}
                  onShowDetail={() => setDetailId(a.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? t("editActivity") : t("addActivity")}
            </DialogTitle>
            <DialogDescription>
              {editing?.isMilestone
                ? t("milestone")
                : t("task")}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="act-code">{t("code")}</Label>
                  <Input
                    id="act-code"
                    value={editing.code}
                    onChange={(e) =>
                      setEditing({ ...editing, code: e.target.value })
                    }
                    placeholder="e.g. A or 100"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="act-duration">{t("duration")}</Label>
                  <Input
                    id="act-duration"
                    type="number"
                    min={0}
                    step={1}
                    value={editing.duration}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        duration: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="act-name-en">{t("nameEn")}</Label>
                  <Input
                    id="act-name-en"
                    value={editing.nameEn}
                    onChange={(e) =>
                      setEditing({ ...editing, nameEn: e.target.value })
                    }
                    placeholder="e.g. Excavation"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="act-name-ar">{t("nameAr")}</Label>
                  <Input
                    id="act-name-ar"
                    value={editing.nameAr}
                    onChange={(e) =>
                      setEditing({ ...editing, nameAr: e.target.value })
                    }
                    dir="rtl"
                    placeholder="حفر"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="act-type">{t("type")}</Label>
                  <Select
                    value={editing.isMilestone ? "milestone" : "task"}
                    onValueChange={(v) =>
                      setEditing({
                        ...editing,
                        isMilestone: v === "milestone",
                        // Force duration to 0 when switching to milestone.
                        duration: v === "milestone" ? 0 : editing.duration,
                      })
                    }
                  >
                    <SelectTrigger id="act-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="task">{t("task")}</SelectItem>
                      <SelectItem value="milestone">
                        {t("milestone")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="act-wbs">{t("wbsNode")}</Label>
                  <Select
                    value={editing.wbsNodeId ?? "__none__"}
                    onValueChange={(v) =>
                      setEditing({
                        ...editing,
                        wbsNodeId: v === "__none__" ? null : v,
                      })
                    }
                  >
                    <SelectTrigger id="act-wbs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("none")}</SelectItem>
                      {wbsNodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {n.code}
                          </span>
                          {n.nameEn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={submitEdit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail sheet — shows relationships */}
      <Sheet
        open={!!detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
      >
        <SheetContent className="sm:max-w-[560px] overflow-y-auto">
          {detailId && (
            <ActivityRelationships
              activityId={detailId}
              allActivities={sortedActivities}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Activity row ─────────────────────────────────────────────────────────

function ActivityRow({
  activity,
  wbsNodes,
  onEdit,
  onDelete,
  onShowDetail,
}: {
  activity: ActivityApi;
  wbsNodes: WbsNodeApi[];
  onEdit: () => void;
  onDelete: () => void;
  onShowDetail: () => void;
}) {
  const t = useTranslations("activities");
  const wbs = wbsNodes.find((n) => n.id === activity.wbsNodeId);
  return (
    <tr
      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors group"
    >
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
        {activity.code}
      </td>
      <td className="px-4 py-2">
        <button
          type="button"
          onClick={onShowDetail}
          className="text-left hover:underline underline-offset-4"
        >
          <span className="font-medium">{activity.nameEn}</span>
        </button>
        {activity.nameAr && (
          <div className="text-xs text-muted-foreground" dir="rtl">
            {activity.nameAr}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <InlineDurationEdit
          activityId={activity.id}
          duration={activity.duration}
          version={activity.version}
        />
      </td>
      <td className="px-4 py-2 text-xs text-muted-foreground">
        {wbs ? (
          <span className="font-mono">
            {wbs.code}{" "}
            <span className="text-muted-foreground/70">· {wbs.nameEn}</span>
          </span>
        ) : (
          t("none")
        )}
      </td>
      <td className="px-4 py-2">
        {activity.isMilestone ? (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-border bg-muted/30">
            <span className="inline-block w-1.5 h-1.5 rotate-45 bg-primary" />
            {t("milestone")}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("task")}</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onShowDetail}
            aria-label={t("relationships")}
            title={t("relationships")}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onEdit}
            aria-label={t("editActivity")}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-destructive"
            onClick={onDelete}
            aria-label={t("deleteActivity")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Inline duration edit ──────────────────────────────────────────────────

function InlineDurationEdit({
  activityId,
  duration,
  version,
}: {
  activityId: string;
  duration: number;
  version: number;
}) {
  const qc = useQueryClient();
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(duration));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const mutation = useMutation({
    mutationFn: async (vars: { value: number; expectedVersion: number }) =>
      apiPatch<ActivityApi>(`/api/activities/${activityId}`, {
        duration: vars.value,
        expectedVersion: vars.expectedVersion,
      }),
    onMutate: () => setSaving(true),
    onSuccess: () => {
      if (currentProjectId) {
        qc.invalidateQueries({
          queryKey: queryKeys.activities.list(currentProjectId),
        });
      }
      setSaving(false);
      setEditing(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to save: ${err.message}`);
      setSaving(false);
      setEditing(false);
      setDraft(String(duration));
    },
  });

  function startEditing() {
    setDraft(String(duration));
    setEditing(true);
  }
  function commit() {
    const n = Number(draft);
    if (draft.trim() === "" || Number.isNaN(n) || n < 0) {
      toast.error("Please enter a valid non-negative integer");
      setDraft(String(duration));
      setEditing(false);
      return;
    }
    if (n === duration) {
      setEditing(false);
      return;
    }
    mutation.mutate({ value: Math.floor(n), expectedVersion: version });
  }

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Input
          ref={inputRef}
          type="number"
          min={0}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(String(duration));
              setEditing(false);
            }
          }}
          className="h-7 w-20 text-right font-mono text-xs"
          disabled={saving}
        />
        {saving && (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="font-mono text-xs hover:bg-accent hover:text-accent-foreground rounded px-2 py-1 -my-1 transition-colors w-full text-right"
      title="Click to edit"
    >
      {saving && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}
      {duration}
    </button>
  );
}

// ─── Activity relationships (sheet content) ────────────────────────────────

function ActivityRelationships({
  activityId,
  allActivities,
}: {
  activityId: string;
  allActivities: ActivityApi[];
}) {
  const t = useTranslations("activities");
  const qc = useQueryClient();
  const currentProjectId = useUIStore((s) => s.currentProjectId);

  const { data, isLoading } = useQuery<RelationshipsResponse>({
    queryKey: queryKeys.activities.relationships(activityId),
    queryFn: () =>
      fetchJson<RelationshipsResponse>(
        `/api/activities/${activityId}/relationships`,
      ),
  });

  const relationships = data?.relationships ?? [];
  const predecessors = relationships.filter((r) => r.successorId === activityId);
  const successors = relationships.filter((r) => r.predecessorId === activityId);

  // "Add relationship" form state. The activity in the URL is always one side;
  // the user picks whether it's the predecessor or successor, then picks the
  // other-side activity, the type, and the lag.
  const [addMode, setAddMode] = useState<"predecessor" | "successor">(
    "predecessor",
  );
  const [otherId, setOtherId] = useState<string>("");
  const [relType, setRelType] = useState<"FS" | "SS" | "FF" | "SF">("FS");
  const [lag, setLag] = useState(0);

  // Reset the form whenever the activity changes.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setOtherId("");
    setRelType("FS");
    setLag(0);
    setAddMode("predecessor");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [activityId]);

  const createRelMutation = useMutation({
    mutationFn: async () => {
      if (!otherId) throw new Error(t("selectActivity"));
      // If addMode === "predecessor": the activity in the URL is the SUCCESSOR,
      //   and `otherId` is the predecessor.
      // If addMode === "successor": the activity in the URL is the PREDECESSOR,
      //   and `otherId` is the successor.
      const predecessorId =
        addMode === "predecessor" ? otherId : activityId;
      const successorId = addMode === "predecessor" ? activityId : otherId;
      if (predecessorId === successorId) {
        throw new Error("An activity cannot depend on itself");
      }
      return apiPost<RelationshipApi>(
        `/api/activities/${activityId}/relationships`,
        {
          projectId: currentProjectId,
          predecessorId,
          successorId,
          type: relType,
          lag,
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.activities.relationships(activityId),
      });
      toast.success("Relationship added");
      setOtherId("");
      setRelType("FS");
      setLag(0);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteRelMutation = useMutation({
    mutationFn: (relId: string) => apiDelete<void>(`/api/relationships/${relId}`),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.activities.relationships(activityId),
      });
      toast.success("Relationship removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const activity = allActivities.find((a) => a.id === activityId);

  return (
    <div className="space-y-6">
      <SheetHeader>
        <SheetTitle>
          {t("relationships")}
          {activity && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · <span className="font-mono">{activity.code}</span>{" "}
              {activity.nameEn}
            </span>
          )}
        </SheetTitle>
        <SheetDescription>
          {t("predecessors")} ({predecessors.length}) · {t("successors")} ({successors.length})
        </SheetDescription>
      </SheetHeader>

      {/* Predecessors */}
      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
          {t("predecessors")}
        </h3>
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : predecessors.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t("noRelationships")}</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {predecessors.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5"
              >
                <span className="font-mono text-muted-foreground">
                  {r.predecessorCode ?? r.predecessorId}
                </span>
                <span className="text-foreground truncate flex-1">
                  {r.predecessorNameEn ?? ""}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-muted/50 border border-border font-mono text-[10px]">
                  {r.type}
                </span>
                <span className="text-muted-foreground font-mono">
                  {r.lag >= 0 ? `+${r.lag}` : r.lag}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:text-destructive"
                  onClick={() => deleteRelMutation.mutate(r.id)}
                  aria-label={t("removeRelationship")}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Successors */}
      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
          {t("successors")}
        </h3>
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : successors.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t("noRelationships")}</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {successors.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5"
              >
                <span className="font-mono text-muted-foreground">
                  {r.successorCode ?? r.successorId}
                </span>
                <span className="text-foreground truncate flex-1">
                  {r.successorNameEn ?? ""}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-muted/50 border border-border font-mono text-[10px]">
                  {r.type}
                </span>
                <span className="text-muted-foreground font-mono">
                  {r.lag >= 0 ? `+${r.lag}` : r.lag}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:text-destructive"
                  onClick={() => deleteRelMutation.mutate(r.id)}
                  aria-label={t("removeRelationship")}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add relationship */}
      <section className="space-y-3 rounded-lg border border-border border-dashed p-3">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
          {t("addRelationship")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              {t("predecessor")} / {t("successor")}
            </Label>
            <Select
              value={addMode}
              onValueChange={(v) => setAddMode(v as "predecessor" | "successor")}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="predecessor">
                  {t("predecessor")}
                </SelectItem>
                <SelectItem value="successor">{t("successor")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              {t("selectActivity")}
            </Label>
            <Select value={otherId} onValueChange={setOtherId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {allActivities
                  .filter((a) => a.id !== activityId)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="font-mono text-xs text-muted-foreground mr-2">
                        {a.code}
                      </span>
                      {a.nameEn}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              {t("relationshipType")}
            </Label>
            <Select
              value={relType}
              onValueChange={(v) => setRelType(v as "FS" | "SS" | "FF" | "SF")}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FS">FS</SelectItem>
                <SelectItem value="SS">SS</SelectItem>
                <SelectItem value="FF">FF</SelectItem>
                <SelectItem value="SF">SF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              {t("lag")}
            </Label>
            <Input
              type="number"
              value={lag}
              onChange={(e) =>
                setLag(Number.isNaN(Number(e.target.value)) ? 0 : Number(e.target.value))
              }
              className="h-8 text-xs"
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => createRelMutation.mutate()}
          disabled={createRelMutation.isPending || !otherId}
          className="w-full bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          {createRelMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          {t("addRelationship")}
        </Button>
      </section>
    </div>
  );
}
