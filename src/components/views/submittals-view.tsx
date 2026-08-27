"use client";

/**
 * SubmittalsView (S18) — Submittals Log.
 *
 * Per SPEC_PHASE3_WEB.md §6 (S18): table + status timeline + status-change
 * actions.
 *
 * Data:
 *   - GET  /api/projects/[projectId]/submittals   → { submittals: Submittal[] }
 *   - POST /api/projects/[projectId]/submittals   → Submittal (auto-gen ref)
 *   - GET  /api/submittals/[id]                   → { submittal, events }
 *   - POST /api/submittals/[id]/status            → { submittal, event }
 *
 * Per BR-DC2: submittal ref is auto-generated as "SUB-###" (numbering domain).
 * Per BR-DC5: status workflow draft → submitted → under-review →
 *             approved | approved-with-comments | rejected | revise-resubmit.
 *             Final = approved | approved-with-comments | rejected.
 * Per BR-DC6: due date = submittedDate + reviewPeriodDays (calendar days).
 *             Overdue ⇔ asOf > due AND status is non-final and not DRAFT.
 *             Overdue badge: red if overdue, amber if due within 3 days.
 * Per BR-DC8: every status change writes an append-only SubmittalEvent.
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No submittals yet → "Add a submittal to start tracking reviews."
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  Send,
  Plus,
  Loader2,
  ArrowRight,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type {
  Discipline,
  SubmittalStatus,
  SubmittalType,
} from "@shared/entities";

// ─── Constants ────────────────────────────────────────────────────────────

const DISCIPLINES: Discipline[] = [
  "ARC",
  "STR",
  "CIV",
  "MEC",
  "ELE",
  "PLB",
  "FIR",
  "LND",
];

const SUBMITTAL_TYPES: SubmittalType[] = ["MATERIAL", "TECHNICAL"];

const SUBMITTAL_STATUSES: SubmittalStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "APPROVED_WITH_COMMENTS",
  "REJECTED",
  "REVISE_RESUBMIT",
];

const FINAL_SUBMITTAL_STATUSES: SubmittalStatus[] = [
  "APPROVED",
  "APPROVED_WITH_COMMENTS",
  "REJECTED",
];

// Valid transitions per BR-DC5 (mirror of the status-workflow domain module).
const SUBMITTAL_TRANSITIONS: Record<SubmittalStatus, SubmittalStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: [
    "UNDER_REVIEW",
    "APPROVED",
    "APPROVED_WITH_COMMENTS",
    "REJECTED",
    "REVISE_RESUBMIT",
  ],
  UNDER_REVIEW: [
    "APPROVED",
    "APPROVED_WITH_COMMENTS",
    "REJECTED",
    "REVISE_RESUBMIT",
  ],
  APPROVED: [],
  APPROVED_WITH_COMMENTS: [],
  REJECTED: [],
  REVISE_RESUBMIT: ["SUBMITTED"],
};

// ─── Types ────────────────────────────────────────────────────────────────

interface SubmittalApi {
  id: string;
  projectId: string;
  ref: string;
  subjectEn: string;
  subjectAr: string | null;
  type: SubmittalType;
  discipline: Discipline;
  submittedDate: string | null; // ISO yyyy-MM-dd
  reviewPeriodDays: number;
  resubmissionNo: number;
  status: SubmittalStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface SubmittalsListResponse {
  submittals: SubmittalApi[];
}

interface SubmittalEventApi {
  id: string;
  submittalId: string;
  fromStatus: SubmittalStatus | null;
  toStatus: SubmittalStatus;
  note: string | null;
  eventDate: string;
  createdByUserId: string;
  createdAt: string;
}

interface SubmittalDetailResponse {
  submittal: SubmittalApi;
  events: SubmittalEventApi[];
}

// ─── Component ────────────────────────────────────────────────────────────

export function SubmittalsView() {
  const t = useTranslations("submittals");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newSubmittal, setNewSubmittal] = useState({
    subjectEn: "",
    subjectAr: "",
    type: "MATERIAL" as SubmittalType,
    discipline: "ARC" as Discipline,
    submittedDate: todayIso(),
    reviewPeriodDays: 14,
  });

  // Injected clock (BR-DC1) — the UI supplies "today" from the browser.
  const today = todayIso();

  const { data, isLoading } = useQuery<SubmittalsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.submittals.list(currentProjectId)
      : ["submittals", "list", "_disabled"],
    queryFn: () =>
      fetchJson<SubmittalsListResponse>(
        `/api/projects/${currentProjectId}/submittals`,
      ),
    enabled: !!currentProjectId,
  });

  const submittals = data?.submittals ?? [];

  // Sort submittals by ref ascending for a stable table. Declared BEFORE the
  // early return below to satisfy the React rules-of-hooks lint rule.
  const sortedSubmittals = useMemo(
    () =>
      [...submittals].sort((a, b) =>
        a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0,
      ),
    [submittals],
  );

  // Detail (events timeline) for the Sheet drawer.
  const { data: detailData, isLoading: detailLoading } =
    useQuery<SubmittalDetailResponse>({
      queryKey: selectedId
        ? queryKeys.submittals.detail(selectedId)
        : ["submittals", "detail", "_disabled"],
      queryFn: () =>
        fetchJson<SubmittalDetailResponse>(`/api/submittals/${selectedId}`),
      enabled: !!selectedId,
    });

  // Create submittal — ref is auto-generated by the server.
  const createMutation = useMutation({
    mutationFn: (vars: {
      subjectEn: string;
      subjectAr: string | null;
      type: SubmittalType;
      discipline: Discipline;
      submittedDate: string | null;
      reviewPeriodDays: number;
    }) =>
      apiPost<SubmittalApi>(
        `/api/projects/${currentProjectId}/submittals`,
        {
          projectId: currentProjectId,
          subjectEn: vars.subjectEn,
          subjectAr: vars.subjectAr,
          type: vars.type,
          discipline: vars.discipline,
          submittedDate: vars.submittedDate,
          reviewPeriodDays: vars.reviewPeriodDays,
          resubmissionNo: 0,
          status: "DRAFT",
        },
      ),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.submittals.list(currentProjectId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.documentsDashboard.detail(currentProjectId),
      });
      toast.success("Submittal created");
      setAddOpen(false);
      setNewSubmittal({
        subjectEn: "",
        subjectAr: "",
        type: "MATERIAL",
        discipline: "ARC",
        submittedDate: todayIso(),
        reviewPeriodDays: 14,
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Change status via POST /api/submittals/[id]/status.
  const statusChangeMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      toStatus: SubmittalStatus;
      eventDate: string;
      expectedVersion: number;
      note?: string;
    }) =>
      apiPost<{ submittal: SubmittalApi; event: SubmittalEventApi }>(
        `/api/submittals/${vars.id}/status`,
        {
          toStatus: vars.toStatus,
          eventDate: vars.eventDate,
          expectedVersion: vars.expectedVersion,
          note: vars.note ?? null,
        },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.submittals.detail(vars.id),
      });
      if (currentProjectId) {
        qc.invalidateQueries({
          queryKey: queryKeys.submittals.list(currentProjectId),
        });
        qc.invalidateQueries({
          queryKey: queryKeys.documentsDashboard.detail(currentProjectId),
        });
      }
      toast.success("Status updated");
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
            <Send className="w-5 h-5 text-muted-foreground" />
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

  function submitNewSubmittal() {
    if (!newSubmittal.subjectEn.trim()) {
      toast.error("Subject (EN) is required");
      return;
    }
    createMutation.mutate({
      subjectEn: newSubmittal.subjectEn.trim(),
      subjectAr: newSubmittal.subjectAr.trim() || null,
      type: newSubmittal.type,
      discipline: newSubmittal.discipline,
      submittedDate: newSubmittal.submittedDate || null,
      reviewPeriodDays: newSubmittal.reviewPeriodDays,
    });
  }

  function changeStatus(s: SubmittalApi, toStatus: SubmittalStatus) {
    if (!detailData) return;
    statusChangeMutation.mutate({
      id: s.id,
      toStatus,
      eventDate: today,
      expectedVersion: detailData.submittal.version,
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {submittals.length}{" "}
            {submittals.length === 1 ? "submittal" : "submittals"}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("addSubmittal")}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : sortedSubmittals.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <Send className="w-5 h-5 text-muted-foreground" />
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
            {t("addSubmittal")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                  {t("ref")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground">
                  {t("subject")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                  {t("type")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-20">
                  {t("discipline")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28">
                  {t("submitted")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28">
                  {t("due")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-32">
                  {t("status")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                  {t("overdue")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-12 text-right">
                  {tc("actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSubmittals.map((s) => {
                const overdueState = computeOverdueState(
                  today,
                  s.submittedDate,
                  s.reviewPeriodDays,
                  s.status,
                );
                return (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.ref}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium truncate">{s.subjectEn}</div>
                      {s.subjectAr && (
                        <div
                          className="text-xs text-muted-foreground truncate"
                          dir="rtl"
                        >
                          {s.subjectAr}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.type}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.discipline}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.submittedDate ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.submittedDate
                        ? addDays(s.submittedDate, s.reviewPeriodDays)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <SubmittalStatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3">
                      <OverdueBadge state={overdueState} />
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Stop row click so the dropdown doesn't double-fire. */}
                      <StatusChangeMenu
                        submittal={s}
                        onChange={(to) => changeStatus(s, to)}
                        disabled={statusChangeMutation.isPending}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create submittal dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("addSubmittal")}</DialogTitle>
            <DialogDescription>{t("empty")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sub-subject-en">{t("subjectEn")}</Label>
              <Input
                id="sub-subject-en"
                value={newSubmittal.subjectEn}
                onChange={(e) =>
                  setNewSubmittal({ ...newSubmittal, subjectEn: e.target.value })
                }
                placeholder="e.g. Concrete mix design — grade C40/50"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-subject-ar">{t("subjectAr")}</Label>
              <Input
                id="sub-subject-ar"
                value={newSubmittal.subjectAr}
                onChange={(e) =>
                  setNewSubmittal({ ...newSubmittal, subjectAr: e.target.value })
                }
                dir="rtl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sub-type">{t("type")}</Label>
                <Select
                  value={newSubmittal.type}
                  onValueChange={(v) =>
                    setNewSubmittal({
                      ...newSubmittal,
                      type: v as SubmittalType,
                    })
                  }
                >
                  <SelectTrigger id="sub-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBMITTAL_TYPES.map((tp) => (
                      <SelectItem key={tp} value={tp}>
                        {tp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-discipline">{t("discipline")}</Label>
                <Select
                  value={newSubmittal.discipline}
                  onValueChange={(v) =>
                    setNewSubmittal({
                      ...newSubmittal,
                      discipline: v as Discipline,
                    })
                  }
                >
                  <SelectTrigger id="sub-discipline" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCIPLINES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sub-submitted">{t("submitted")}</Label>
                <Input
                  id="sub-submitted"
                  type="date"
                  value={newSubmittal.submittedDate}
                  onChange={(e) =>
                    setNewSubmittal({
                      ...newSubmittal,
                      submittedDate: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-review-period">
                  {t("reviewPeriod")}
                </Label>
                <Input
                  id="sub-review-period"
                  type="number"
                  min={0}
                  value={newSubmittal.reviewPeriodDays}
                  onChange={(e) =>
                    setNewSubmittal({
                      ...newSubmittal,
                      reviewPeriodDays: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAddOpen(false)}
            >
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              onClick={submitNewSubmittal}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : null}
              {tc("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail drawer */}
      <Sheet
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>
              {detailData?.submittal.ref ?? "—"}
              <span className="text-muted-foreground font-normal ml-2">
                · {detailData?.submittal.subjectEn ?? ""}
              </span>
            </SheetTitle>
            <SheetDescription>{t("statusTimeline")}</SheetDescription>
          </SheetHeader>
          {selectedId && (
            <SubmittalDetailBody
              loading={detailLoading}
              data={detailData}
              onChangeStatus={changeStatus}
              changing={statusChangeMutation.isPending}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function SubmittalDetailBody({
  loading,
  data,
  onChangeStatus,
  changing,
}: {
  loading: boolean;
  data: SubmittalDetailResponse | undefined;
  onChangeStatus: (s: SubmittalApi, to: SubmittalStatus) => void;
  changing: boolean;
}) {
  const t = useTranslations("submittals");
  const tc = useTranslations("common");

  if (loading) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }
  if (!data) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">—</div>;
  }

  const events = [...data.events].sort((a, b) =>
    a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0,
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label={t("type")} value={data.submittal.type} />
          <Field label={t("discipline")} value={data.submittal.discipline} />
          <Field
            label={t("submitted")}
            value={data.submittal.submittedDate ?? "—"}
          />
          <Field
            label={t("due")}
            value={
              data.submittal.submittedDate
                ? addDays(
                    data.submittal.submittedDate,
                    data.submittal.reviewPeriodDays,
                  )
                : "—"
            }
          />
          <Field
            label={t("reviewPeriod")}
            value={`${data.submittal.reviewPeriodDays} d`}
          />
          <Field
            label={t("status")}
            value={<SubmittalStatusBadge status={data.submittal.status} />}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          {t("changeStatus")}
        </h3>
        <StatusChangeMenu
          submittal={data.submittal}
          onChange={(to) => onChangeStatus(data.submittal, to)}
          disabled={changing}
          fullWidth
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          {t("statusTimeline")}
        </h3>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noEvents")}</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-2 font-mono py-1 border-b border-border/40 last:border-0"
              >
                <span className="text-muted-foreground shrink-0">
                  {e.eventDate}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {e.fromStatus ? humanStatus(e.fromStatus) : "—"} →{" "}
                  {humanStatus(e.toStatus)}
                </span>
                {e.note && (
                  <span className="text-foreground truncate">{e.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function StatusChangeMenu({
  submittal,
  onChange,
  disabled,
  fullWidth,
}: {
  submittal: SubmittalApi;
  onChange: (to: SubmittalStatus) => void;
  disabled: boolean;
  fullWidth?: boolean;
}) {
  const t = useTranslations("submittals");
  const allowed = SUBMITTAL_TRANSITIONS[submittal.status] ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || allowed.length === 0}
          className={fullWidth ? "w-full justify-between" : "h-7 text-xs"}
        >
          {t("changeStatus")}
          <ArrowRight className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("changeStatus")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allowed.length === 0 ? (
          <DropdownMenuItem disabled>
            <span className="text-muted-foreground">Terminal status</span>
          </DropdownMenuItem>
        ) : (
          allowed.map((to) => (
            <DropdownMenuItem
              key={to}
              onClick={() => onChange(to)}
            >
              {humanStatus(to)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SubmittalStatusBadge({ status }: { status: SubmittalStatus }) {
  const colorClass: Record<SubmittalStatus, string> = {
    DRAFT: "border-transparent bg-muted text-muted-foreground",
    SUBMITTED:
      "border-transparent bg-[rgba(96,165,250,0.15)] text-[rgb(96,165,250)]",
    UNDER_REVIEW:
      "border-transparent bg-[rgba(251,146,60,0.15)] text-[rgb(251,146,60)]",
    APPROVED:
      "border-transparent bg-[rgba(74,222,128,0.15)] text-[rgb(74,222,128)]",
    APPROVED_WITH_COMMENTS:
      "border-transparent bg-[rgba(74,222,128,0.10)] text-[rgb(74,222,128)]",
    REJECTED:
      "border-transparent bg-[rgba(248,113,113,0.15)] text-[rgb(248,113,113)]",
    REVISE_RESUBMIT:
      "border-transparent bg-[rgba(251,146,60,0.10)] text-[rgb(251,146,60)]",
  };
  return (
    <Badge variant="outline" className={colorClass[status]}>
      {humanStatus(status)}
    </Badge>
  );
}

function OverdueBadge({
  state,
}: {
  state: ReturnType<typeof computeOverdueState>;
}) {
  const t = useTranslations("submittals");
  if (state === "overdue") {
    return (
      <Badge
        variant="outline"
        className="border-transparent bg-[rgba(248,113,113,0.15)] text-[rgb(248,113,113)]"
      >
        <AlertTriangle className="w-3 h-3 mr-1" />
        {t("overdue")}
      </Badge>
    );
  }
  if (state === "due-soon") {
    return (
      <Badge
        variant="outline"
        className="border-transparent bg-[rgba(251,146,60,0.15)] text-[rgb(251,146,60)]"
      >
        <Clock className="w-3 h-3 mr-1" />
        {t("dueSoon")}
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function humanStatus(s: SubmittalStatus): string {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  return new Date(ms + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Compute the overdue state per BR-DC6.
 *   overdue ⇔ asOf > due AND status is non-final AND status != DRAFT.
 *   due-soon ⇔ 0 ≤ (due − asOf) ≤ 3 days AND status is non-final AND != DRAFT.
 *
 * The caller passes the injected "today" (BR-DC1 — no Date.now() in domain).
 */
function computeOverdueState(
  asOf: string,
  submittedDate: string | null,
  reviewPeriodDays: number,
  status: SubmittalStatus,
): "overdue" | "due-soon" | "none" {
  if (submittedDate === null) return "none";
  if (status === "DRAFT") return "none";
  if (FINAL_SUBMITTAL_STATUSES.includes(status)) return "none";

  const due = addDays(submittedDate, reviewPeriodDays);
  const diff = daysBetween(asOf, due);
  if (diff < 0) return "overdue"; // asOf > due
  if (diff <= 3) return "due-soon";
  return "none";
}

function daysBetween(asOf: string, due: string): number {
  const a = Date.parse(asOf + "T00:00:00Z");
  const b = Date.parse(due + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86400000);
}

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
