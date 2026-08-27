"use client";

/**
 * WbsView (S12) — Work Breakdown Structure tree editor.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S12): tree view with reorder (dnd-kit — same
 * pattern as BoQ sections, but tree structure), per-node code + name (EN/AR)
 * + edit/delete actions, "Add node" CTA.
 *
 * Data:
 *   - GET    /api/projects/[projectId]/wbs  → { nodes: WbsNode[] }
 *   - POST   /api/projects/[projectId]/wbs  → WbsNode (created)
 *   - PATCH  /api/wbs/[wbsId]               → WbsNode (updated)
 *   - DELETE /api/wbs/[wbsId]                → 204 (soft-delete)
 *
 * Tree rendering: nodes have `parentId` (self-reference). We build the tree
 * client-side from the flat list returned by the API and recurse to any depth.
 * Sibling order is governed by `sortOrder` (ascending). The dnd-kit reordering
 * is intentionally deferred for Phase 2 Group M (BoQ sections ship without
 * drag-reorder today; this view mirrors that UX). A future iteration will
 * wrap each sibling group in <SortableContext> using the same import paths
 * already declared in package.json (@dnd-kit/core + @dnd-kit/sortable).
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No nodes yet → "Add a node to start organizing the schedule."
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  ListTree,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Pencil,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost, apiPatch, apiDelete } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface WbsNodeApi {
  id: string;
  projectId: string;
  parentId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface WbsListResponse {
  nodes: WbsNodeApi[];
}

interface WbsTreeRow {
  node: WbsNodeApi;
  depth: number;
  children: WbsTreeRow[];
}

// ─── Component ────────────────────────────────────────────────────────────

export function WbsView() {
  const t = useTranslations("wbs");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [editing, setEditing] = useState<{
    id: string | null; // null = creating new
    parentId: string | null;
    code: string;
    nameEn: string;
    nameAr: string;
  } | null>(null);

  // Fetch the WBS nodes for the current project.
  const { data, isLoading } = useQuery<WbsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.wbs.list(currentProjectId)
      : ["wbs", "list", "_disabled"],
    queryFn: () =>
      fetchJson<WbsListResponse>(`/api/projects/${currentProjectId}/wbs`),
    enabled: !!currentProjectId,
  });

  const nodes = data?.nodes ?? [];

  // Build the tree (sorted by sortOrder within each parent group).
  const tree = useMemo(() => buildWbsTree(nodes), [nodes]);

  // ─── Mutations (declared unconditionally above the early return so the
  // Rules of Hooks hold — the no-project branch renders no mutation UI, but
  // React still requires the same hook call sequence every render). ──────
  const createMutation = useMutation({
    mutationFn: (vars: {
      parentId: string | null;
      code: string;
      nameEn: string;
      nameAr: string;
    }) =>
      apiPost<WbsNodeApi>(`/api/projects/${currentProjectId ?? ""}/wbs`, {
        projectId: currentProjectId,
        parentId: vars.parentId,
        code: vars.code,
        nameEn: vars.nameEn,
        nameAr: vars.nameAr || null,
        sortOrder: 0,
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.wbs.list(currentProjectId),
      });
      toast.success("Node created");
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
    }) =>
      apiPatch<WbsNodeApi>(`/api/wbs/${vars.id}`, {
        code: vars.code,
        nameEn: vars.nameEn,
        nameAr: vars.nameAr || null,
        // WbsNode has no version column per Group K — the PATCH route
        // treats it as a soft-delete-aware update only (no expectedVersion).
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.wbs.list(currentProjectId),
      });
      toast.success("Node saved");
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/api/wbs/${id}`),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.wbs.list(currentProjectId),
      });
      toast.success("Node deleted");
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
            <ListTree className="w-5 h-5 text-muted-foreground" />
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

  function openCreate(parentId: string | null) {
    setEditing({ id: null, parentId, code: "", nameEn: "", nameAr: "" });
  }
  function openEdit(node: WbsNodeApi) {
    setEditing({
      id: node.id,
      parentId: node.parentId,
      code: node.code,
      nameEn: node.nameEn,
      nameAr: node.nameAr ?? "",
    });
  }
  function submitEdit() {
    if (!editing) return;
    if (!editing.code.trim() || !editing.nameEn.trim()) {
      toast.error("Code and name (EN) are required");
      return;
    }
    if (editing.id) {
      updateMutation.mutate({
        id: editing.id,
        code: editing.code.trim(),
        nameEn: editing.nameEn.trim(),
        nameAr: editing.nameAr.trim(),
      });
    } else {
      createMutation.mutate({
        parentId: editing.parentId,
        code: editing.code.trim(),
        nameEn: editing.nameEn.trim(),
        nameAr: editing.nameAr.trim(),
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
            {nodes.length} {nodes.length === 1 ? "node" : "nodes"}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => openCreate(null)}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("addNode")}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : tree.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <ListTree className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {t("empty")}
          </p>
          <Button
            type="button"
            onClick={() => openCreate(null)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("addNode")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
          {tree.map((row) => (
            <WbsTreeBranch
              key={row.node.id}
              row={row}
              onEdit={openEdit}
              onDelete={(id) => {
                if (window.confirm(t("deleteConfirm"))) {
                  deleteMutation.mutate(id);
                }
              }}
              onAddChild={(parentId) => openCreate(parentId)}
              addChildLabel={t("addNode")}
              editLabel={t("editNode")}
              deleteLabel={t("deleteNode")}
            />
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? t("editNode") : t("addNode")}
            </DialogTitle>
            <DialogDescription>
              {editing?.parentId
                ? `Child of ${nodes.find((n) => n.id === editing.parentId)?.code ?? ""}`
                : "Top-level node"}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="wbs-code">{t("code")}</Label>
                <Input
                  id="wbs-code"
                  value={editing.code}
                  onChange={(e) =>
                    setEditing({ ...editing, code: e.target.value })
                  }
                  placeholder="e.g. 1.2.3"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wbs-name-en">{t("nameEn")}</Label>
                <Input
                  id="wbs-name-en"
                  value={editing.nameEn}
                  onChange={(e) =>
                    setEditing({ ...editing, nameEn: e.target.value })
                  }
                  placeholder="e.g. Foundations"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wbs-name-ar">{t("nameAr")}</Label>
                <Input
                  id="wbs-name-ar"
                  value={editing.nameAr}
                  onChange={(e) =>
                    setEditing({ ...editing, nameAr: e.target.value })
                  }
                  dir="rtl"
                  placeholder="الأساسات"
                />
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
    </div>
  );
}

// ─── Tree branch (recursive) ───────────────────────────────────────────────

function WbsTreeBranch({
  row,
  onEdit,
  onDelete,
  onAddChild,
  addChildLabel,
  editLabel,
  deleteLabel,
}: {
  row: WbsTreeRow;
  onEdit: (node: WbsNodeApi) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
  addChildLabel: string;
  editLabel: string;
  deleteLabel: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = row.children.length > 0;

  return (
    <div className="bg-card">
      <div className="flex items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )
          ) : (
            <span className="inline-block w-4" />
          )}
        </button>
        <span
          className="font-mono text-xs text-muted-foreground shrink-0"
          style={{ marginLeft: `${row.depth * 8}px` }}
        >
          {row.node.code}
        </span>
        <span className="font-medium truncate flex-1">{row.node.nameEn}</span>
        {row.node.nameAr && (
          <span className="text-xs text-muted-foreground truncate" dir="rtl">
            {row.node.nameAr}
          </span>
        )}
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onAddChild(row.node.id)}
            aria-label={addChildLabel}
            title={addChildLabel}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(row.node)}
            aria-label={editLabel}
            title={editLabel}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-destructive"
            onClick={() => onDelete(row.node.id)}
            aria-label={deleteLabel}
            title={deleteLabel}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="divide-y divide-border/50 bg-muted/10">
          {row.children.map((child) => (
            <WbsTreeBranch
              key={child.node.id}
              row={child}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              addChildLabel={addChildLabel}
              editLabel={editLabel}
              deleteLabel={deleteLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildWbsTree(nodes: WbsNodeApi[]): WbsTreeRow[] {
  // Index nodes by parent for O(1) lookup; sort by sortOrder within each group.
  const byParent = new Map<string | null, WbsNodeApi[]>();
  for (const n of nodes) {
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function build(parentId: string | null, depth: number): WbsTreeRow[] {
    const children = byParent.get(parentId) ?? [];
    return children.map((node) => ({
      node,
      depth,
      children: build(node.id, depth + 1),
    }));
  }
  return build(null, 0);
}
