"use client";

/**
 * VariationsView (S25) — Variations list + Create dialog.
 *
 * Per SPEC_PHASE4_WEB.md §6 (S25): table with status, "New variation" button.
 *
 * Data:
 *   - GET  /api/projects/[projectId]/variations   → { variations: Variation[] }
 *   - POST /api/projects/[projectId]/variations   → Variation
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No variations → "Create a variation to start tracking contract changes."
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FileEdit, Plus, Loader2, Trash2 } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost, apiDelete } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { VariationStatus } from "@shared/entities";

interface VariationApi {
  id: string;
  projectId: string;
  boqDocumentId: string | null;
  ref: string;
  titleEn: string;
  titleAr: string | null;
  status: VariationStatus;
  approvedValue: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface VariationsListResponse {
  variations: VariationApi[];
}

function statusVariant(status: VariationStatus) {
  if (status === "APPROVED") return "default";
  if (status === "REJECTED") return "destructive";
  if (status === "SUBMITTED") return "secondary";
  return "outline";
}

export function VariationsView() {
  const t = useTranslations("variations");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [newVar, setNewVar] = useState({ ref: "", titleEn: "" });

  const { data, isLoading } = useQuery<VariationsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.variations.list(currentProjectId)
      : ["variations", "list", "_disabled"],
    queryFn: () =>
      fetchJson<VariationsListResponse>(
        `/api/projects/${currentProjectId}/variations`,
      ),
    enabled: !!currentProjectId,
  });

  const variations = data?.variations ?? [];

  const createMutation = useMutation({
    mutationFn: (vars: { ref: string; titleEn: string }) =>
      apiPost<VariationApi>(`/api/projects/${currentProjectId}/variations`, {
        ref: vars.ref,
        titleEn: vars.titleEn,
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({ queryKey: queryKeys.variations.list(currentProjectId) });
      toast.success(t("created"));
      setAddOpen(false);
      setNewVar({ ref: "", titleEn: "" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (vars: { id: string; version: number }) =>
      apiDelete(`/api/variations/${vars.id}?expectedVersion=${vars.version}`),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({ queryKey: queryKeys.variations.list(currentProjectId) });
      toast.success(t("deleted"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <FileEdit className="w-5 h-5 text-muted-foreground" />
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
            {variations.length} {variations.length === 1 ? "variation" : "variations"}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("newVariation")}
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : variations.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <FileEdit className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{t("empty")}</p>
          <Button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("newVariation")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">{t("ref")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">{t("title")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-32">{t("approvedValue")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">{t("status")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-12 text-right">{tc("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {variations.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">{v.ref}</td>
                  <td className="px-4 py-3">{v.titleEn}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {v.approvedValue ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(v.status)}>{v.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      disabled={v.status === "APPROVED"}
                      onClick={() => {
                        if (confirm(`Delete variation ${v.ref}?`)) {
                          deleteMutation.mutate({ id: v.id, version: v.version });
                        }
                      }}
                      title={t("delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("newVariation")}</DialogTitle>
            <DialogDescription>{t("newVariationDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="ref">{t("ref")}</Label>
              <Input
                id="ref"
                value={newVar.ref}
                placeholder="VO-001"
                onChange={(e) => setNewVar({ ...newVar, ref: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="titleEn">{t("titleEn")}</Label>
              <Input
                id="titleEn"
                value={newVar.titleEn}
                onChange={(e) => setNewVar({ ...newVar, titleEn: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!newVar.ref.trim() || !newVar.titleEn.trim()) {
                  toast.error("Ref and title are required");
                  return;
                }
                createMutation.mutate({
                  ref: newVar.ref.trim(),
                  titleEn: newVar.titleEn.trim(),
                });
              }}
              disabled={createMutation.isPending}
              className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
            >
              {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {tc("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
