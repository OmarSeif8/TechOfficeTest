"use client";

/**
 * PaymentsView (S22) — Payment applications list + Create dialog + Compute.
 *
 * Per SPEC_PHASE4_WEB.md §6 (S22): table with status badges, gross/retention/net
 * columns, "New IPC" button. Phase 4 MVP — header-only create; lines +
 * deductions + additions are added via the per-id PATCH route (which the
 * detail dialog edits inline).
 *
 * Data:
 *   - GET  /api/projects/[projectId]/payments   → { applications: PaymentApplication[] }
 *   - POST /api/projects/[projectId]/payments   → PaymentApplication
 *   - POST /api/payments/[id]/compute           → { computed, warnings, summary }
 *
 * Per BR-IP9: list is sorted by ipcNo asc (the API returns it that way).
 * Per BR-IP10: CERTIFIED applications are immutable — the delete button is
 *             disabled for them.
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No applications → "Create an IPC to start tracking payments."
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Receipt, Plus, Loader2, Calculator, Trash2 } from "lucide-react";
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
import type { PaymentStatus } from "@shared/entities";

// ─── Types ────────────────────────────────────────────────────────────────

interface PaymentApplicationApi {
  id: string;
  projectId: string;
  ipcNo: number;
  periodStart: string;
  periodEnd: string;
  status: PaymentStatus;
  contractValue: string;
  retentionPercent: string;
  retentionCapAmount: string | null;
  advanceAmount: string;
  advanceEnabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface PaymentsListResponse {
  applications: PaymentApplicationApi[];
}

interface ComputeResponse {
  application: PaymentApplicationApi;
  computed: {
    grossCum: string;
    retentionCum: string;
    recoveryCum: string;
    deductionsTotal: string;
    additionsTotal: string;
    netCum: string;
    netThisPeriod: string;
    lines: { itemId: string; qtyCum: string; valueCum: string }[];
  };
  warnings: { code: string; message: string }[];
  summary: {
    totalGrossCum: string;
    totalRetentionCum: string;
    totalRecoveryCum: string;
    totalNetCum: string;
    advanceRemaining: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function statusVariant(status: PaymentStatus) {
  if (status === "CERTIFIED") return "default";
  if (status === "SUBMITTED") return "secondary";
  return "outline";
}

function todayIso() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Component ────────────────────────────────────────────────────────────

export function PaymentsView() {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [newApp, setNewApp] = useState({
    ipcNo: 1,
    periodStart: todayIso(),
    periodEnd: todayIso(),
    contractValue: "0",
    retentionPercent: "5",
    retentionCapAmount: "",
    advanceAmount: "0",
    advanceEnabled: false,
  });

  const { data, isLoading } = useQuery<PaymentsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.payments.list(currentProjectId)
      : ["payments", "list", "_disabled"],
    queryFn: () =>
      fetchJson<PaymentsListResponse>(
        `/api/projects/${currentProjectId}/payments`,
      ),
    enabled: !!currentProjectId,
  });

  const applications = data?.applications ?? [];

  const createMutation = useMutation({
    mutationFn: (vars: {
      ipcNo: number;
      periodStart: string;
      periodEnd: string;
      contractValue: string;
      retentionPercent: string;
      retentionCapAmount: string | null;
      advanceAmount: string;
      advanceEnabled: boolean;
    }) =>
      apiPost<PaymentApplicationApi>(`/api/projects/${currentProjectId}/payments`, {
        ipcNo: vars.ipcNo,
        periodStart: vars.periodStart,
        periodEnd: vars.periodEnd,
        contractValue: vars.contractValue,
        retentionPercent: vars.retentionPercent,
        retentionCapAmount: vars.retentionCapAmount || null,
        advanceAmount: vars.advanceAmount,
        advanceEnabled: vars.advanceEnabled,
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({ queryKey: queryKeys.payments.list(currentProjectId) });
      toast.success(t("created"));
      setAddOpen(false);
      setNewApp({
        ipcNo: newApp.ipcNo + 1,
        periodStart: todayIso(),
        periodEnd: todayIso(),
        contractValue: newApp.contractValue,
        retentionPercent: newApp.retentionPercent,
        retentionCapAmount: "",
        advanceAmount: "0",
        advanceEnabled: false,
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const computeMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<ComputeResponse>(`/api/payments/${id}/compute`, {}),
    onSuccess: (data) => {
      if (!currentProjectId) return;
      qc.invalidateQueries({ queryKey: queryKeys.payments.list(currentProjectId) });
      const warningCount = data.warnings.length;
      if (warningCount > 0) {
        toast.success(`${t("computedWithWarnings")} (${warningCount})`);
      } else {
        toast.success(t("computed"));
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (vars: { id: string; version: number }) =>
      apiDelete(`/api/payments/${vars.id}?expectedVersion=${vars.version}`),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({ queryKey: queryKeys.payments.list(currentProjectId) });
      toast.success(t("deleted"));
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
            <Receipt className="w-5 h-5 text-muted-foreground" />
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

  function submitNew() {
    if (newApp.ipcNo <= 0) {
      toast.error("IPC # must be positive");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newApp.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(newApp.periodEnd)) {
      toast.error("Dates must be ISO yyyy-MM-dd");
      return;
    }
    createMutation.mutate({
      ipcNo: newApp.ipcNo,
      periodStart: newApp.periodStart,
      periodEnd: newApp.periodEnd,
      contractValue: newApp.contractValue,
      retentionPercent: newApp.retentionPercent,
      retentionCapAmount: newApp.retentionCapAmount || null,
      advanceAmount: newApp.advanceAmount,
      advanceEnabled: newApp.advanceEnabled,
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {applications.length}{" "}
            {applications.length === 1 ? "application" : "applications"}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("newIpc")}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : applications.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <Receipt className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {t("empty")}
          </p>
          <Button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("newIpc")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground w-20">IPC #</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28">{t("periodStart")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28">{t("periodEnd")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">{t("contractValue")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">{t("retention")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">{t("advance")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">{t("status")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-12 text-right">{tc("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">{a.ipcNo}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.periodStart}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.periodEnd}</td>
                  <td className="px-4 py-3 font-mono text-xs">{a.contractValue}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.retentionPercent}%</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {a.advanceEnabled ? a.advanceAmount : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => computeMutation.mutate(a.id)}
                        disabled={computeMutation.isPending}
                        title={t("compute")}
                      >
                        {computeMutation.isPending && computeMutation.variables === a.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Calculator className="w-3.5 h-3.5" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        disabled={a.status === "CERTIFIED"}
                        onClick={() => {
                          if (confirm(`Delete IPC #${a.ipcNo}?`)) {
                            deleteMutation.mutate({ id: a.id, version: a.version });
                          }
                        }}
                        title={a.status === "CERTIFIED" ? t("certifiedImmutable") : t("delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("newIpc")}</DialogTitle>
            <DialogDescription>{t("newIpcDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="ipcNo">IPC #</Label>
              <Input
                id="ipcNo"
                type="number"
                min={1}
                value={newApp.ipcNo}
                onChange={(e) => setNewApp({ ...newApp, ipcNo: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contractValue">{t("contractValue")}</Label>
              <Input
                id="contractValue"
                value={newApp.contractValue}
                onChange={(e) => setNewApp({ ...newApp, contractValue: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="periodStart">{t("periodStart")}</Label>
              <Input
                id="periodStart"
                type="date"
                value={newApp.periodStart}
                onChange={(e) => setNewApp({ ...newApp, periodStart: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="periodEnd">{t("periodEnd")}</Label>
              <Input
                id="periodEnd"
                type="date"
                value={newApp.periodEnd}
                onChange={(e) => setNewApp({ ...newApp, periodEnd: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retentionPercent">{t("retention")}%</Label>
              <Input
                id="retentionPercent"
                value={newApp.retentionPercent}
                onChange={(e) => setNewApp({ ...newApp, retentionPercent: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retentionCapAmount">{t("retentionCap")}</Label>
              <Input
                id="retentionCapAmount"
                value={newApp.retentionCapAmount}
                placeholder="optional"
                onChange={(e) => setNewApp({ ...newApp, retentionCapAmount: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="advanceAmount">{t("advance")}</Label>
              <Input
                id="advanceAmount"
                value={newApp.advanceAmount}
                disabled={!newApp.advanceEnabled}
                onChange={(e) => setNewApp({ ...newApp, advanceAmount: e.target.value })}
              />
            </div>
            <div className="space-y-1 flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newApp.advanceEnabled}
                  onChange={(e) => setNewApp({ ...newApp, advanceEnabled: e.target.checked })}
                />
                {t("advanceEnabled")}
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              onClick={submitNew}
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
