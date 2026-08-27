"use client";

/**
 * RfisView (S19) — RFI Log.
 *
 * Per SPEC_PHASE3_WEB.md §6 (S19): table + question/answer detail +
 * answer-RFI flow.
 *
 * Data:
 *   - GET  /api/projects/[projectId]/rfis    → { rfis: Rfi[] }
 *   - POST /api/projects/[projectId]/rfis    → Rfi (auto-gen ref)
 *   - GET  /api/rfis/[id]                    → { rfi, events }
 *   - POST /api/rfis/[id]/answer             → { rfi, event }
 *
 * Per BR-DC2: RFI ref is auto-generated as "RFI-###".
 * Per BR-DC6: due date = sentDate + reviewPeriodDays (default 7 days).
 *             Overdue ⇔ asOf > due AND status is non-final.
 *             (For RFIs, ANSWERED counts as final per BR-DC7 — the question
 *             has been answered.)
 * Per BR-DC7: open → answered → closed; cancelled terminal. Answering sets
 *             answer text (EN/AR) + answer date AND transitions status to
 *             ANSWERED.
 * Per BR-DC8: every status change writes an append-only RfiEvent.
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No RFIs yet → "Add an RFI to start logging questions."
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  HelpCircle,
  Plus,
  Loader2,
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
import { Textarea } from "@/components/ui/textarea";
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
import type { RfiStatus } from "@shared/entities";

// ─── Types ────────────────────────────────────────────────────────────────

interface RfiApi {
  id: string;
  projectId: string;
  ref: string;
  questionEn: string;
  questionAr: string | null;
  linkedDrawingId: string | null;
  sentDate: string | null;
  reviewPeriodDays: number;
  answerEn: string | null;
  answerAr: string | null;
  answerDate: string | null;
  status: RfiStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface RfisListResponse {
  rfis: RfiApi[];
}

interface RfiEventApi {
  id: string;
  rfiId: string;
  fromStatus: RfiStatus | null;
  toStatus: RfiStatus;
  note: string | null;
  eventDate: string;
  createdByUserId: string;
  createdAt: string;
}

interface RfiDetailResponse {
  rfi: RfiApi;
  events: RfiEventApi[];
}

interface DrawingOption {
  id: string;
  code: string;
  titleEn: string;
}

interface DrawingsListResponse {
  drawings: DrawingOption[];
}

// ─── Constants ────────────────────────────────────────────────────────────

const FINAL_RFI_STATUSES: RfiStatus[] = ["ANSWERED", "CLOSED", "CANCELLED"];

// ─── Component ────────────────────────────────────────────────────────────

export function RfisView() {
  const t = useTranslations("rfis");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const today = todayIso();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newRfi, setNewRfi] = useState({
    questionEn: "",
    questionAr: "",
    linkedDrawingId: "" as string,
    sentDate: todayIso(),
    reviewPeriodDays: 7,
  });

  const { data, isLoading } = useQuery<RfisListResponse>({
    queryKey: currentProjectId
      ? queryKeys.rfis.list(currentProjectId)
      : ["rfis", "list", "_disabled"],
    queryFn: () =>
      fetchJson<RfisListResponse>(
        `/api/projects/${currentProjectId}/rfis`,
      ),
    enabled: !!currentProjectId,
  });

  // Fetch drawings for the linked-drawing dropdown.
  const { data: drawingsData } = useQuery<DrawingsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.drawings.list(currentProjectId)
      : ["drawings", "list", "_disabled"],
    queryFn: () =>
      fetchJson<DrawingsListResponse>(
        `/api/projects/${currentProjectId}/drawings`,
      ),
    enabled: !!currentProjectId,
  });
  const drawings = drawingsData?.drawings ?? [];

  const rfis = data?.rfis ?? [];

  // Sort RFIs by ref ascending for a stable table. Declared BEFORE the early
  // return below to satisfy the React rules-of-hooks lint rule.
  const sortedRfis = useMemo(
    () =>
      [...rfis].sort((a, b) =>
        a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0,
      ),
    [rfis],
  );

  // Detail (events) for the Sheet drawer.
  const { data: detailData, isLoading: detailLoading } =
    useQuery<RfiDetailResponse>({
      queryKey: selectedId
        ? queryKeys.rfis.detail(selectedId)
        : ["rfis", "detail", "_disabled"],
      queryFn: () =>
        fetchJson<RfiDetailResponse>(`/api/rfis/${selectedId}`),
      enabled: !!selectedId,
    });

  const createMutation = useMutation({
    mutationFn: (vars: {
      questionEn: string;
      questionAr: string | null;
      linkedDrawingId: string | null;
      sentDate: string | null;
      reviewPeriodDays: number;
    }) =>
      apiPost<RfiApi>(`/api/projects/${currentProjectId}/rfis`, {
        projectId: currentProjectId,
        questionEn: vars.questionEn,
        questionAr: vars.questionAr,
        linkedDrawingId: vars.linkedDrawingId,
        sentDate: vars.sentDate,
        reviewPeriodDays: vars.reviewPeriodDays,
        status: "OPEN",
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.rfis.list(currentProjectId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.documentsDashboard.detail(currentProjectId),
      });
      toast.success("RFI created");
      setAddOpen(false);
      setNewRfi({
        questionEn: "",
        questionAr: "",
        linkedDrawingId: "",
        sentDate: todayIso(),
        reviewPeriodDays: 7,
      });
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
            <HelpCircle className="w-5 h-5 text-muted-foreground" />
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

  function submitNewRfi() {
    if (!newRfi.questionEn.trim()) {
      toast.error("Question (EN) is required");
      return;
    }
    createMutation.mutate({
      questionEn: newRfi.questionEn.trim(),
      questionAr: newRfi.questionAr.trim() || null,
      linkedDrawingId: newRfi.linkedDrawingId || null,
      sentDate: newRfi.sentDate || null,
      reviewPeriodDays: newRfi.reviewPeriodDays,
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rfis.length} {rfis.length === 1 ? "RFI" : "RFIs"}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("addRfi")}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : sortedRfis.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <HelpCircle className="w-5 h-5 text-muted-foreground" />
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
            {t("addRfi")}
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
                  {t("question")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-32">
                  {t("linkedDrawing")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28">
                  {t("sent")}
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
              {sortedRfis.map((r) => {
                const overdueState = computeOverdueState(
                  today,
                  r.sentDate,
                  r.reviewPeriodDays,
                  r.status,
                );
                const linkedDrawing = r.linkedDrawingId
                  ? drawings.find((d) => d.id === r.linkedDrawingId)
                  : null;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {r.ref}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium truncate max-w-md">
                        {r.questionEn}
                      </div>
                      {r.questionAr && (
                        <div
                          className="text-xs text-muted-foreground truncate max-w-md"
                          dir="rtl"
                        >
                          {r.questionAr}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {linkedDrawing ? linkedDrawing.code : t("noLinkedDrawing")}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {r.sentDate ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {r.sentDate
                        ? addDays(r.sentDate, r.reviewPeriodDays)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <RfiStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      <OverdueBadge state={overdueState} />
                    </td>
                    <td className="px-4 py-3" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create RFI dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t("addRfi")}</DialogTitle>
            <DialogDescription>{t("empty")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rfi-q-en">{t("questionEn")}</Label>
              <Textarea
                id="rfi-q-en"
                value={newRfi.questionEn}
                onChange={(e) =>
                  setNewRfi({ ...newRfi, questionEn: e.target.value })
                }
                rows={3}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rfi-q-ar">{t("questionAr")}</Label>
              <Textarea
                id="rfi-q-ar"
                value={newRfi.questionAr}
                onChange={(e) =>
                  setNewRfi({ ...newRfi, questionAr: e.target.value })
                }
                rows={3}
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rfi-drawing">{t("linkedDrawing")}</Label>
              <Select
                value={newRfi.linkedDrawingId || "NONE"}
                onValueChange={(v) =>
                  setNewRfi({
                    ...newRfi,
                    linkedDrawingId: v === "NONE" ? "" : v,
                  })
                }
              >
                <SelectTrigger id="rfi-drawing" className="w-full">
                  <SelectValue placeholder={t("noLinkedDrawing")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">{t("noLinkedDrawing")}</SelectItem>
                  {drawings.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.code} · {d.titleEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rfi-sent">{t("sent")}</Label>
                <Input
                  id="rfi-sent"
                  type="date"
                  value={newRfi.sentDate}
                  onChange={(e) =>
                    setNewRfi({ ...newRfi, sentDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rfi-period">{t("reviewPeriod")}</Label>
                <Input
                  id="rfi-period"
                  type="number"
                  min={0}
                  value={newRfi.reviewPeriodDays}
                  onChange={(e) =>
                    setNewRfi({
                      ...newRfi,
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
              onClick={submitNewRfi}
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
              {detailData?.rfi.ref ?? "—"}
            </SheetTitle>
            <SheetDescription>
              {detailData?.rfi.questionEn ?? ""}
            </SheetDescription>
          </SheetHeader>
          {selectedId && (
            <RfiDetailBody
              loading={detailLoading}
              data={detailData}
              rfiId={selectedId}
              drawings={drawings}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function RfiDetailBody({
  loading,
  data,
  rfiId,
  drawings,
}: {
  loading: boolean;
  data: RfiDetailResponse | undefined;
  rfiId: string;
  drawings: DrawingOption[];
}) {
  const t = useTranslations("rfis");
  const tc = useTranslations("common");
  const qc = useQueryClient();

  const [answerOpen, setAnswerOpen] = useState(false);
  const [answerEn, setAnswerEn] = useState("");
  const [answerAr, setAnswerAr] = useState("");
  const [answerDate, setAnswerDate] = useState(todayIso());

  const answerMutation = useMutation({
    mutationFn: (vars: {
      answerEn: string;
      answerAr: string | null;
      answerDate: string;
      expectedVersion: number;
    }) =>
      apiPost<{ rfi: RfiApi; event: RfiEventApi }>(
        `/api/rfis/${rfiId}/answer`,
        {
          answerEn: vars.answerEn,
          answerAr: vars.answerAr,
          answerDate: vars.answerDate,
          expectedVersion: vars.expectedVersion,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.rfis.detail(rfiId),
      });
      // Also invalidate the list (the status badge needs refreshing).
      qc.invalidateQueries({ queryKey: queryKeys.rfis.all });
      qc.invalidateQueries({ queryKey: queryKeys.documentsDashboard.all });
      toast.success("RFI answered");
      setAnswerOpen(false);
      setAnswerEn("");
      setAnswerAr("");
      setAnswerDate(todayIso());
    },
    onError: (err: Error) => toast.error(err.message),
  });

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

  const rfi = data.rfi;
  const linkedDrawing = rfi.linkedDrawingId
    ? drawings.find((d) => d.id === rfi.linkedDrawingId)
    : null;
  const events = [...data.events].sort((a, b) =>
    a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0,
  );

  function submitAnswer() {
    if (!answerEn.trim()) {
      toast.error("Answer (EN) is required");
      return;
    }
    answerMutation.mutate({
      answerEn: answerEn.trim(),
      answerAr: answerAr.trim() || null,
      answerDate,
      expectedVersion: rfi.version,
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label={t("sent")} value={rfi.sentDate ?? "—"} />
          <Field
            label={t("due")}
            value={
              rfi.sentDate
                ? addDays(rfi.sentDate, rfi.reviewPeriodDays)
                : "—"
            }
          />
          <Field
            label={t("linkedDrawing")}
            value={linkedDrawing ? linkedDrawing.code : t("noLinkedDrawing")}
          />
          <Field
            label={t("status")}
            value={<RfiStatusBadge status={rfi.status} />}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          {t("question")}
        </h3>
        <p className="text-sm">{rfi.questionEn}</p>
        {rfi.questionAr && (
          <p className="text-sm text-muted-foreground" dir="rtl">
            {rfi.questionAr}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            {t("answer")}
          </h3>
          {rfi.status !== "CLOSED" && rfi.status !== "CANCELLED" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setAnswerEn(rfi.answerEn ?? "");
                setAnswerAr(rfi.answerAr ?? "");
                setAnswerDate(todayIso());
                setAnswerOpen(true);
              }}
              className="h-7 text-xs gap-1"
            >
              {t("answerRfi")}
            </Button>
          )}
        </div>
        {rfi.answerEn ? (
          <div className="space-y-1.5">
            <p className="text-sm">{rfi.answerEn}</p>
            {rfi.answerAr && (
              <p className="text-sm text-muted-foreground" dir="rtl">
                {rfi.answerAr}
              </p>
            )}
            <p className="text-xs text-muted-foreground font-mono">
              {t("answerDate")}: {rfi.answerDate}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("noAnswer")}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          {t("events")}
        </h3>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noAnswer")}</p>
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
                  {e.fromStatus ?? "—"} → {e.toStatus}
                </span>
                {e.note && (
                  <span className="text-foreground truncate">{e.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={answerOpen} onOpenChange={setAnswerOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t("answerRfi")}</DialogTitle>
            <DialogDescription>{rfi.ref}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ans-en">{t("answerEn")}</Label>
              <Textarea
                id="ans-en"
                value={answerEn}
                onChange={(e) => setAnswerEn(e.target.value)}
                rows={4}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ans-ar">{t("answerAr")}</Label>
              <Textarea
                id="ans-ar"
                value={answerAr}
                onChange={(e) => setAnswerAr(e.target.value)}
                rows={4}
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ans-date">{t("answerDate")}</Label>
              <Input
                id="ans-date"
                type="date"
                value={answerDate}
                onChange={(e) => setAnswerDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAnswerOpen(false)}
            >
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              onClick={submitAnswer}
              disabled={answerMutation.isPending}
            >
              {answerMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : null}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function RfiStatusBadge({ status }: { status: RfiStatus }) {
  const colorClass: Record<RfiStatus, string> = {
    OPEN: "border-transparent bg-[rgba(96,165,250,0.15)] text-[rgb(96,165,250)]",
    ANSWERED:
      "border-transparent bg-[rgba(74,222,128,0.15)] text-[rgb(74,222,128)]",
    CLOSED: "border-transparent bg-muted text-muted-foreground",
    CANCELLED:
      "border-transparent bg-[rgba(248,113,113,0.15)] text-[rgb(248,113,113)]",
  };
  return (
    <Badge variant="outline" className={colorClass[status]}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

function OverdueBadge({
  state,
}: {
  state: ReturnType<typeof computeOverdueState>;
}) {
  const t = useTranslations("rfis");
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
        {t("overdue")}
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

function computeOverdueState(
  asOf: string,
  sentDate: string | null,
  reviewPeriodDays: number,
  status: RfiStatus,
): "overdue" | "due-soon" | "none" {
  if (sentDate === null) return "none";
  if (FINAL_RFI_STATUSES.includes(status)) return "none";

  const due = addDays(sentDate, reviewPeriodDays);
  const diff = daysBetween(asOf, due);
  if (diff < 0) return "overdue";
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
