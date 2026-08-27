"use client";

/**
 * CorrespondenceView (S20) — Correspondence register + transmittal builder.
 *
 * Per SPEC_PHASE3_WEB.md §6 (S20): table + transmittal builder with live
 * preview + export-transmittal printable HTML.
 *
 * Data:
 *   - GET  /api/projects/[projectId]/correspondence        → { correspondences }
 *   - POST /api/projects/[projectId]/correspondence        → Correspondence (auto ref)
 *   - GET  /api/correspondence/[id]                        → { correspondence, transmittalLines }
 *   - POST /api/correspondence/[id]/transmittal-lines      → TransmittalLine (BR-DC10)
 *
 * Per BR-DC2: correspondence refs are auto-generated as "IN-###" or "OUT-###"
 *           (direction-prefixed; IN and OUT have INDEPENDENT sequences).
 * Per BR-DC10: a Correspondence row with type=TRANSMITTAL has child
 *           TransmittalLine rows. The form footer shows total copies.
 * Per BR-WEB-DC1: transmittal PDF uses printable HTML (Phase 1 pragmatic
 *           approach — Puppeteer deferred to Phase 5). The export button
 *           opens a new tab with the printable HTML and triggers the print
 *           dialog client-side.
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No correspondence → "Add an entry to start tracking letters and transmittals."
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  Mail,
  Plus,
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
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
import type {
  CorrespondenceDirection,
  CorrespondenceType,
} from "@shared/entities";

// ─── Constants ────────────────────────────────────────────────────────────

const DIRECTIONS: CorrespondenceDirection[] = ["INCOMING", "OUTGOING"];

const CORRESPONDENCE_TYPES: CorrespondenceType[] = [
  "LETTER",
  "MEMO",
  "TRANSMITTAL",
  "EMAIL",
  "OTHER",
];

// ─── Types ────────────────────────────────────────────────────────────────

interface CorrespondenceApi {
  id: string;
  projectId: string;
  ref: string;
  direction: CorrespondenceDirection;
  type: CorrespondenceType;
  date: string;
  subjectEn: string;
  subjectAr: string | null;
  fromParty: string;
  toParty: string;
  bodyEn: string | null;
  bodyAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface CorrespondenceListResponse {
  correspondences: CorrespondenceApi[];
}

interface TransmittalLineApi {
  id: string;
  transmittalId: string;
  docRef: string;
  descriptionEn: string;
  descriptionAr: string | null;
  copies: number;
  sortOrder: number;
}

interface CorrespondenceDetailResponse {
  correspondence: CorrespondenceApi;
  transmittalLines: TransmittalLineApi[];
}

// ─── Component ────────────────────────────────────────────────────────────

export function CorrespondenceView() {
  const t = useTranslations("correspondence");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    direction: "INCOMING" as CorrespondenceDirection,
    type: "LETTER" as CorrespondenceType,
    date: todayIso(),
    subjectEn: "",
    subjectAr: "",
    fromParty: "",
    toParty: "",
    bodyEn: "",
    bodyAr: "",
  });

  const { data, isLoading } = useQuery<CorrespondenceListResponse>({
    queryKey: currentProjectId
      ? queryKeys.correspondence.list(currentProjectId)
      : ["correspondence", "list", "_disabled"],
    queryFn: () =>
      fetchJson<CorrespondenceListResponse>(
        `/api/projects/${currentProjectId}/correspondence`,
      ),
    enabled: !!currentProjectId,
  });

  const correspondences = data?.correspondences ?? [];

  // NOTE: useMemo must run BEFORE the early-return below to satisfy the
  // React rules-of-hooks lint rule.
  const sortedCorrespondences = useMemo(
    () =>
      [...correspondences].sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
      ),
    [correspondences],
  );

  const createMutation = useMutation({
    mutationFn: (vars: {
      direction: CorrespondenceDirection;
      type: CorrespondenceType;
      date: string;
      subjectEn: string;
      subjectAr: string | null;
      fromParty: string;
      toParty: string;
      bodyEn: string | null;
      bodyAr: string | null;
    }) =>
      apiPost<CorrespondenceApi>(
        `/api/projects/${currentProjectId}/correspondence`,
        {
          projectId: currentProjectId,
          direction: vars.direction,
          type: vars.type,
          date: vars.date,
          subjectEn: vars.subjectEn,
          subjectAr: vars.subjectAr,
          fromParty: vars.fromParty,
          toParty: vars.toParty,
          bodyEn: vars.bodyEn,
          bodyAr: vars.bodyAr,
        },
      ),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.correspondence.list(currentProjectId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.documentsDashboard.detail(currentProjectId),
      });
      toast.success("Correspondence created");
      setAddOpen(false);
      setNewItem({
        direction: "INCOMING",
        type: "LETTER",
        date: todayIso(),
        subjectEn: "",
        subjectAr: "",
        fromParty: "",
        toParty: "",
        bodyEn: "",
        bodyAr: "",
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
            <Mail className="w-5 h-5 text-muted-foreground" />
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

  function submitNewItem() {
    if (!newItem.subjectEn.trim()) {
      toast.error("Subject (EN) is required");
      return;
    }
    if (!newItem.fromParty.trim() || !newItem.toParty.trim()) {
      toast.error("From / To parties are required");
      return;
    }
    createMutation.mutate({
      direction: newItem.direction,
      type: newItem.type,
      date: newItem.date,
      subjectEn: newItem.subjectEn.trim(),
      subjectAr: newItem.subjectAr.trim() || null,
      fromParty: newItem.fromParty.trim(),
      toParty: newItem.toParty.trim(),
      bodyEn: newItem.bodyEn.trim() || null,
      bodyAr: newItem.bodyAr.trim() || null,
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {correspondences.length}{" "}
            {correspondences.length === 1 ? "entry" : "entries"}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("addCorrespondence")}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : sortedCorrespondences.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <Mail className="w-5 h-5 text-muted-foreground" />
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
            {t("addCorrespondence")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                  {t("direction")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                  {t("ref")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-28">
                  {t("date")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                  {t("type")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground">
                  {t("subject")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-40">
                  {t("from")} / {t("to")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedCorrespondences.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <DirectionBadge direction={c.direction} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {c.ref}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {c.date}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {c.type}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium truncate max-w-md">
                      {c.subjectEn}
                    </div>
                    {c.subjectAr && (
                      <div
                        className="text-xs text-muted-foreground truncate max-w-md"
                        dir="rtl"
                      >
                        {c.subjectAr}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div className="truncate">{c.fromParty}</div>
                    <div className="truncate">→ {c.toParty}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t("addCorrespondence")}</DialogTitle>
            <DialogDescription>{t("empty")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="corr-dir">{t("direction")}</Label>
                <Select
                  value={newItem.direction}
                  onValueChange={(v) =>
                    setNewItem({
                      ...newItem,
                      direction: v as CorrespondenceDirection,
                    })
                  }
                >
                  <SelectTrigger id="corr-dir" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECTIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d === "INCOMING" ? t("incoming") : t("outgoing")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="corr-type">{t("type")}</Label>
                <Select
                  value={newItem.type}
                  onValueChange={(v) =>
                    setNewItem({
                      ...newItem,
                      type: v as CorrespondenceType,
                    })
                  }
                >
                  <SelectTrigger id="corr-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CORRESPONDENCE_TYPES.map((tp) => (
                      <SelectItem key={tp} value={tp}>
                        {tp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="corr-date">{t("date")}</Label>
              <Input
                id="corr-date"
                type="date"
                value={newItem.date}
                onChange={(e) =>
                  setNewItem({ ...newItem, date: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="corr-subject-en">{t("subjectEn")}</Label>
              <Input
                id="corr-subject-en"
                value={newItem.subjectEn}
                onChange={(e) =>
                  setNewItem({ ...newItem, subjectEn: e.target.value })
                }
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="corr-subject-ar">{t("subjectAr")}</Label>
              <Input
                id="corr-subject-ar"
                value={newItem.subjectAr}
                onChange={(e) =>
                  setNewItem({ ...newItem, subjectAr: e.target.value })
                }
                dir="rtl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="corr-from">{t("fromParty")}</Label>
                <Input
                  id="corr-from"
                  value={newItem.fromParty}
                  onChange={(e) =>
                    setNewItem({ ...newItem, fromParty: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="corr-to">{t("toParty")}</Label>
                <Input
                  id="corr-to"
                  value={newItem.toParty}
                  onChange={(e) =>
                    setNewItem({ ...newItem, toParty: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="corr-body-en">{t("bodyEn")}</Label>
              <Textarea
                id="corr-body-en"
                value={newItem.bodyEn}
                onChange={(e) =>
                  setNewItem({ ...newItem, bodyEn: e.target.value })
                }
                rows={4}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="corr-body-ar">{t("bodyAr")}</Label>
              <Textarea
                id="corr-body-ar"
                value={newItem.bodyAr}
                onChange={(e) =>
                  setNewItem({ ...newItem, bodyAr: e.target.value })
                }
                rows={4}
                dir="rtl"
              />
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
              onClick={submitNewItem}
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
              {selectedId ?? "—"}
            </SheetTitle>
            <SheetDescription>{t("body")}</SheetDescription>
          </SheetHeader>
          {selectedId && <CorrespondenceDetailBody correspondenceId={selectedId} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function CorrespondenceDetailBody({
  correspondenceId,
}: {
  correspondenceId: string;
}) {
  const t = useTranslations("correspondence");
  const tc = useTranslations("common");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<CorrespondenceDetailResponse>({
    queryKey: queryKeys.correspondence.detail(correspondenceId),
    queryFn: () =>
      fetchJson<CorrespondenceDetailResponse>(
        `/api/correspondence/${correspondenceId}`,
      ),
  });

  const [addLineOpen, setAddLineOpen] = useState(false);
  const [newLine, setNewLine] = useState({
    docRef: "",
    descriptionEn: "",
    descriptionAr: "",
    copies: 1,
  });

  const addLineMutation = useMutation({
    mutationFn: (vars: {
      docRef: string;
      descriptionEn: string;
      descriptionAr: string | null;
      copies: number;
    }) =>
      apiPost<TransmittalLineApi>(
        `/api/correspondence/${correspondenceId}/transmittal-lines`,
        {
          docRef: vars.docRef,
          descriptionEn: vars.descriptionEn,
          descriptionAr: vars.descriptionAr,
          copies: vars.copies,
          sortOrder: 0,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.correspondence.detail(correspondenceId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.correspondence.transmittalLines(correspondenceId),
      });
      toast.success("Line added");
      setAddLineOpen(false);
      setNewLine({
        docRef: "",
        descriptionEn: "",
        descriptionAr: "",
        copies: 1,
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }
  if (!data) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">—</div>;
  }

  const { correspondence, transmittalLines } = data;
  const isTransmittal = correspondence.type === "TRANSMITTAL";
  const totalCopies = transmittalLines.reduce(
    (sum, l) => sum + (l.copies || 0),
    0,
  );

  function submitNewLine() {
    if (!newLine.docRef.trim() || !newLine.descriptionEn.trim()) {
      toast.error("Doc ref + description are required");
      return;
    }
    addLineMutation.mutate({
      docRef: newLine.docRef.trim(),
      descriptionEn: newLine.descriptionEn.trim(),
      descriptionAr: newLine.descriptionAr.trim() || null,
      copies: newLine.copies,
    });
  }

  function exportTransmittal() {
    // Open printable HTML in a new tab (BR-WEB-DC1 — Phase 1 uses printable
    // HTML; Puppeteer deferred to Phase 5).
    const html = buildTransmittalHtml(correspondence, transmittalLines, totalCopies);
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1200");
    if (!w) {
      toast.error("Pop-up blocked — allow pop-ups to export");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Trigger the print dialog after the new tab finishes loading.
    w.onload = () => w.print();
    // Fallback for browsers that fire onload before we attach.
    setTimeout(() => {
      try {
        w.print();
      } catch {
        // Ignore — the user can press Ctrl/Cmd-P manually.
      }
    }, 600);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header info */}
      <section className="grid grid-cols-2 gap-2 text-xs">
        <Field label={t("ref")} value={correspondence.ref} />
        <Field label={t("type")} value={correspondence.type} />
        <Field label={t("date")} value={correspondence.date} />
        <Field
          label={t("direction")}
          value={
            correspondence.direction === "INCOMING"
              ? t("incoming")
              : t("outgoing")
          }
        />
        <Field label={t("from")} value={correspondence.fromParty} />
        <Field label={t("to")} value={correspondence.toParty} />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          {t("subject")}
        </h3>
        <p className="text-sm">{correspondence.subjectEn}</p>
        {correspondence.subjectAr && (
          <p className="text-sm text-muted-foreground" dir="rtl">
            {correspondence.subjectAr}
          </p>
        )}
      </section>

      {(correspondence.bodyEn || correspondence.bodyAr) && (
        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            {t("body")}
          </h3>
          {correspondence.bodyEn && (
            <p className="text-sm whitespace-pre-wrap">
              {correspondence.bodyEn}
            </p>
          )}
          {correspondence.bodyAr && (
            <p
              className="text-sm text-muted-foreground whitespace-pre-wrap"
              dir="rtl"
            >
              {correspondence.bodyAr}
            </p>
          )}
        </section>
      )}

      {/* Transmittal builder */}
      {isTransmittal && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
              {t("transmittalLines")}
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddLineOpen(true)}
              className="h-7 text-xs gap-1"
            >
              <Plus className="w-3 h-3" />
              {t("addLine")}
            </Button>
          </div>

          {transmittalLines.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noLines")}</p>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    <th className="px-2 py-1.5 font-medium text-muted-foreground">
                      {t("docRef")}
                    </th>
                    <th className="px-2 py-1.5 font-medium text-muted-foreground">
                      {t("description")}
                    </th>
                    <th className="px-2 py-1.5 font-medium text-muted-foreground w-16 text-right">
                      {t("copies")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transmittalLines.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {l.docRef}
                      </td>
                      <td className="px-2 py-1.5">{l.descriptionEn}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {l.copies}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40">
                    <td
                      className="px-2 py-1.5 text-right font-medium"
                      colSpan={2}
                    >
                      {t("totalCopies")}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold">
                      {totalCopies}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportTransmittal}
            disabled={transmittalLines.length === 0}
            className="w-full gap-1.5"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            {t("exportTransmittal")}
          </Button>
        </section>
      )}

      {/* Add-line dialog */}
      <Dialog open={addLineOpen} onOpenChange={setAddLineOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("addLine")}</DialogTitle>
            <DialogDescription>
              {correspondence.ref} · transmittal line
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="line-docref">{t("docRef")}</Label>
              <Input
                id="line-docref"
                value={newLine.docRef}
                onChange={(e) =>
                  setNewLine({ ...newLine, docRef: e.target.value })
                }
                placeholder="e.g. ARC-001 Rev B"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="line-desc-en">{t("descriptionEn")}</Label>
              <Input
                id="line-desc-en"
                value={newLine.descriptionEn}
                onChange={(e) =>
                  setNewLine({ ...newLine, descriptionEn: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="line-desc-ar">{t("descriptionAr")}</Label>
              <Input
                id="line-desc-ar"
                value={newLine.descriptionAr}
                onChange={(e) =>
                  setNewLine({ ...newLine, descriptionAr: e.target.value })
                }
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="line-copies">{t("copies")}</Label>
              <Input
                id="line-copies"
                type="number"
                min={0}
                value={newLine.copies}
                onChange={(e) =>
                  setNewLine({
                    ...newLine,
                    copies: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAddLineOpen(false)}
            >
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              onClick={submitNewLine}
              disabled={addLineMutation.isPending}
            >
              {addLineMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : null}
              {tc("create")}
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

function DirectionBadge({
  direction,
}: {
  direction: CorrespondenceDirection;
}) {
  const t = useTranslations("correspondence");
  const isIncoming = direction === "INCOMING";
  const Icon = isIncoming ? ArrowDownToLine : ArrowUpFromLine;
  const colorClass = isIncoming
    ? "border-transparent bg-[rgba(96,165,250,0.15)] text-[rgb(96,165,250)]"
    : "border-transparent bg-[rgba(167,139,250,0.15)] text-[rgb(167,139,250)]";
  return (
    <Badge variant="outline" className={colorClass}>
      <Icon className="w-3 h-3 mr-1" />
      {isIncoming ? t("incoming") : t("outgoing")}
    </Badge>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the printable transmittal HTML (BR-WEB-DC1 — Phase 1 pragmatic
 * printable HTML; Puppeteer deferred to Phase 5).
 *
 * Returns a full HTML document string suitable for `window.open` + write.
 */
function buildTransmittalHtml(
  correspondence: CorrespondenceApi,
  lines: TransmittalLineApi[],
  totalCopies: number,
): string {
  const lineRows = lines
    .map(
      (l, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="ref">${escapeHtml(l.docRef)}</td>
        <td>${escapeHtml(l.descriptionEn)}</td>
        <td class="num">${l.copies}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Transmittal ${escapeHtml(correspondence.ref)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 32px;
      color: #1a1a1a;
      font-size: 13px;
      line-height: 1.5;
    }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin: 24px 0 8px; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 16px; }
    .meta { font-size: 12px; color: #555; }
    .meta strong { color: #1a1a1a; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { text-align: left; background: #f4f4f4; padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #d4d4d4; }
    td { padding: 8px; border-bottom: 1px solid #e4e4e4; vertical-align: top; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; width: 60px; }
    td.ref { font-family: monospace; width: 140px; }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 2px solid #1a1a1a; display: flex; justify-content: space-between; align-items: baseline; }
    .total { font-size: 16px; font-weight: 600; }
    .total span { font-variant-numeric: tabular-nums; }
    .signatures { display: flex; gap: 80px; margin-top: 48px; }
    .sig { font-size: 12px; color: #555; flex: 1; }
    .sig .line { margin-top: 32px; border-top: 1px solid #888; padding-top: 4px; }
    @media print {
      body { margin: 16mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Document Transmittal</h1>
      <div class="meta"><strong>Ref:</strong> ${escapeHtml(correspondence.ref)} · <strong>Date:</strong> ${escapeHtml(correspondence.date)}</div>
    </div>
    <div class="meta" style="text-align: right;">
      <strong>${escapeHtml(correspondence.direction === "INCOMING" ? "Received from" : "Issued to")}:</strong><br />
      ${escapeHtml(correspondence.direction === "INCOMING" ? correspondence.fromParty : correspondence.toParty)}
    </div>
  </div>

  <h2>Subject</h2>
  <p>${escapeHtml(correspondence.subjectEn)}</p>

  ${correspondence.bodyEn ? `<h2>Body</h2><p style="white-space: pre-wrap;">${escapeHtml(correspondence.bodyEn)}</p>` : ""}

  <h2>Transmitted Documents</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 40px;">#</th>
        <th style="width: 140px;">Doc Ref</th>
        <th>Description</th>
        <th style="width: 60px; text-align: right;">Copies</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || '<tr><td colspan="4" style="text-align:center;color:#888;">No lines</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <span class="total">Total copies: <span>${totalCopies}</span></span>
    <span class="meta">Generated ${new Date().toISOString().slice(0, 10)}</span>
  </div>

  <div class="signatures">
    <div class="sig">
      Issued by
      <div class="line">${escapeHtml(correspondence.fromParty)}</div>
    </div>
    <div class="sig">
      Received by
      <div class="line">${escapeHtml(correspondence.toParty)}</div>
    </div>
  </div>

  <script>
    // Auto-print after paint (best-effort; user can cancel).
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 250);
    });
  </script>
</body>
</html>`;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
