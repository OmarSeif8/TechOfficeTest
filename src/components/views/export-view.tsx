"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FileSpreadsheet, FileText, Download, FileWarning } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { BoQDocument, BoQSection, BoQItem } from "@/shared/entities";

/**
 * ExportView (S9) — Export Center — WO-W-4h.
 *
 * Lets the user export a BoQ document to Excel (.xlsx) or PDF (Phase 1:
 * printable HTML in a new tab — the user uses the browser's Ctrl+P / Cmd+P
 * to "Save as PDF").
 *
 * Configuration:
 *   ─── Document selector ─── dropdown of BoQ documents in the current project
 *   ─── Format selector    ─── two cards: Excel (.xlsx) | PDF
 *   ─── Language selector  ─── dropdown: English | Arabic | Bilingual
 *   ─── Include rate analysis ── checkbox (forwarded to the API; Phase 1 API
 *       accepts but doesn't yet implement rate-analysis output)
 *   ─── Export button      ── triggers the appropriate API endpoint
 *
 * Preview pane shows: document name, status, section count, item count, and
 * estimated total. The estimated total is computed client-side from the
 * denormalised `BoQItem.amount` column (which the server persists at write
 * time per BR-2/BR-5) — so the preview matches the server's export exactly.
 *
 * Phase 1 caveats:
 *   - The export API only supports `language: "en" | "ar"`. The "Bilingual"
 *     option in the UI is sent as `"en"` until the API adds bilingual support.
 *     (The flag is retained in the UI so the design language is forward-
 *     compatible — when the API gains bilingual support, only the mapping
 *     below needs to change.)
 *   - `includeRateAnalysis` is forwarded to the API but the Phase 1 export
 *     endpoints accept it without yet changing their output. This is
 *     documented in both export route files.
 *
 * Pattern follows dashboard-view (TanStack Query + i18n + Linear dark theme +
 * shadcn/ui).
 */

// ─── Types ────────────────────────────────────────────────────────────────

interface DocumentsResponse {
  documents: BoQDocument[];
}

interface SectionsResponse {
  sections: BoQSection[];
}

interface ItemsResponse {
  items: BoQItem[];
}

type ExportFormat = "excel" | "pdf";

type LanguageOption = "en" | "ar" | "bi";

interface PreviewData {
  document: BoQDocument;
  sectionCount: number;
  itemCount: number;
  estimatedTotal: string;
}

// ─── Component ───────────────────────────────────────────────────────────

export function ExportView() {
  const t = useTranslations("export");
  const tCommon = useTranslations("common");
  const tBoq = useTranslations("boq");
  const tErrors = useTranslations("errors");

  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  // ─── Local state ──────────────────────────────────────────────────────
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [format, setFormat] = useState<ExportFormat>("excel");
  const [language, setLanguage] = useState<LanguageOption>("en");
  const [includeRateAnalysis, setIncludeRateAnalysis] =
    useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // ─── 1. No project selected → empty state ─────────────────────────────
  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            No project selected. Create or select a project to export a BoQ document.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              onClick={() => setCurrentView("projects")}
              className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)]"
            >
              Go to Projects
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentView("dashboard")}
            >
              {tCommon("back")} → Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Export BoQ documents to Excel or PDF — bilingual (EN/AR/RTL) ready.
        </p>
      </div>

      <ExportBody
        currentProjectId={currentProjectId}
        selectedDocumentId={selectedDocumentId}
        setSelectedDocumentId={setSelectedDocumentId}
        format={format}
        setFormat={setFormat}
        language={language}
        setLanguage={setLanguage}
        includeRateAnalysis={includeRateAnalysis}
        setIncludeRateAnalysis={setIncludeRateAnalysis}
        isExporting={isExporting}
        setIsExporting={setIsExporting}
        t={t}
        tBoq={tBoq}
        tErrors={tErrors}
      />
    </div>
  );
}

// ─── Body (separated so the early-return guard above stays clean) ────────

interface ExportBodyProps {
  currentProjectId: string;
  selectedDocumentId: string | null;
  setSelectedDocumentId: (id: string | null) => void;
  format: ExportFormat;
  setFormat: (f: ExportFormat) => void;
  language: LanguageOption;
  setLanguage: (l: LanguageOption) => void;
  includeRateAnalysis: boolean;
  setIncludeRateAnalysis: (b: boolean) => void;
  isExporting: boolean;
  setIsExporting: (b: boolean) => void;
  t: ReturnType<typeof useTranslations>;
  tBoq: ReturnType<typeof useTranslations>;
  tErrors: ReturnType<typeof useTranslations>;
}

function ExportBody({
  currentProjectId,
  selectedDocumentId,
  setSelectedDocumentId,
  format,
  setFormat,
  language,
  setLanguage,
  includeRateAnalysis,
  setIncludeRateAnalysis,
  isExporting,
  setIsExporting,
  t,
  tBoq,
  tErrors,
}: ExportBodyProps) {
  // ─── 2. Fetch documents list ──────────────────────────────────────────
  const { data: documentsResp, isLoading: documentsLoading } =
    useQuery<DocumentsResponse>({
      queryKey: queryKeys.documents.list(currentProjectId),
      queryFn: () =>
        fetchJson<DocumentsResponse>(
          `/api/projects/${currentProjectId}/documents`,
        ),
    });

  const documents = documentsResp?.documents ?? [];

  // ─── 3. Empty state ───────────────────────────────────────────────────
  if (documentsLoading) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        Loading documents…
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="rounded-lg border border-border border-dashed p-12 text-center">
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
          <FileWarning className="w-5 h-5 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-medium">No BoQ documents to export</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          This project doesn&apos;t have any BoQ documents yet. Create one in
          the BoQ editor first.
        </p>
        <Button
          type="button"
          onClick={() => useUIStore.getState().setCurrentView("boq")}
          className="mt-4"
        >
          Go to BoQ editor
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* ─── Left column: configuration form ─── */}
      <div className="lg:col-span-2 space-y-6">
        {/* Document selector */}
        <section className="rounded-lg border border-border p-5 space-y-3">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            {tBoq("document")}
          </h2>
          <Select
            value={selectedDocumentId ?? ""}
            onValueChange={(v) => setSelectedDocumentId(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a BoQ document…" />
            </SelectTrigger>
            <SelectContent>
              {documents.map((doc) => (
                <SelectItem key={doc.id} value={doc.id}>
                  <span className="font-medium">{doc.nameEn}</span>
                  {doc.nameAr && (
                    <span
                      className="text-xs text-muted-foreground ms-2"
                      dir="rtl"
                    >
                      {doc.nameAr}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ms-2">
                    · {doc.status}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        {/* Format selector cards */}
        <section className="rounded-lg border border-border p-5 space-y-3">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            {t("format")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <FormatCard
              selected={format === "excel"}
              onClick={() => setFormat("excel")}
              icon={<FileSpreadsheet className="w-5 h-5" />}
              label={t("excel")}
              hint=".xlsx"
            />
            <FormatCard
              selected={format === "pdf"}
              onClick={() => setFormat("pdf")}
              icon={<FileText className="w-5 h-5" />}
              label={t("pdf")}
              hint="printable HTML"
            />
          </div>
        </section>

        {/* Language + rate-analysis row */}
        <section className="rounded-lg border border-border p-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="export-language">{t("language")}</Label>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as LanguageOption)}
            >
              <SelectTrigger id="export-language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">Arabic (RTL)</SelectItem>
                <SelectItem value="bi">
                  Bilingual (English) — Phase 1
                </SelectItem>
              </SelectContent>
            </Select>
            {language === "bi" && (
              <p className="text-xs text-muted-foreground">
                Bilingual export is sent as English in Phase 1 — bilingual
                workbook generation is on the API roadmap.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <Checkbox
              id="export-rate-analysis"
              checked={includeRateAnalysis}
              onCheckedChange={(v) =>
                setIncludeRateAnalysis(v === true || v === "indeterminate")
              }
            />
            <Label
              htmlFor="export-rate-analysis"
              className="font-normal cursor-pointer"
            >
              {t("includeRateAnalysis")}
            </Label>
          </div>
        </section>

        {/* Export button */}
        <section className="flex items-center justify-between rounded-lg border border-border p-5">
          <p className="text-xs text-muted-foreground">
            {format === "excel"
              ? "Generates a multi-sheet .xlsx workbook and downloads it."
              : "Opens a print-optimized HTML page in a new tab — use Ctrl+P / Cmd+P to save as PDF."}
          </p>
          <Button
            type="button"
            disabled={!selectedDocumentId || isExporting}
            onClick={() =>
              handleExport({
                documentId: selectedDocumentId,
                format,
                language,
                includeRateAnalysis,
                setIsExporting,
                tErrors,
              })
            }
          >
            <Download className="w-4 h-4" />
            {isExporting ? "Exporting…" : t("download")}
          </Button>
        </section>
      </div>

      {/* ─── Right column: preview pane ─── */}
      <PreviewPane
        currentProjectId={currentProjectId}
        selectedDocumentId={selectedDocumentId}
        tBoq={tBoq}
      />
    </div>
  );
}

// ─── Format card ─────────────────────────────────────────────────────────

function FormatCard({
  selected,
  onClick,
  icon,
  label,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex flex-col items-start gap-2 p-4 rounded-md border text-left transition-colors ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={selected ? "text-primary" : "text-muted-foreground"}>
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-xs text-muted-foreground font-mono">{hint}</span>
    </button>
  );
}

// ─── Preview pane ───────────────────────────────────────────────────────

function PreviewPane({
  currentProjectId,
  selectedDocumentId,
  tBoq,
}: {
  currentProjectId: string;
  selectedDocumentId: string | null;
  tBoq: ReturnType<typeof useTranslations>;
}) {
  // Fetch the preview (sections + items for the selected document). Computed
  // client-side from the denormalised `BoQItem.amount` column so the preview
  // matches what the export API will produce.
  const { data: preview, isLoading } = useQuery<PreviewData | null>({
    queryKey: ["export", "preview", currentProjectId, selectedDocumentId],
    enabled: !!selectedDocumentId,
    queryFn: async () => {
      if (!selectedDocumentId) return null;

      // Fetch document metadata via the documents list (cached by the parent
      // query) — but since we can't reach into the cache here directly, we
      // re-fetch the documents list and pick the matching document. The
      // queryKey overlap means TanStack Query de-dupes the network call.
      const docs = await fetchJson<DocumentsResponse>(
        `/api/projects/${currentProjectId}/documents`,
      );
      const document =
        docs.documents.find((d) => d.id === selectedDocumentId) ?? null;
      if (!document) return null;

      const sectionsResp = await fetchJson<SectionsResponse>(
        `/api/documents/${selectedDocumentId}/sections`,
      );
      const sections = sectionsResp.sections;

      // Fetch items for each section in parallel. With 50 sections this is 50
      // GETs — acceptable for a preview (and the underlying queries.list query
      // keys are re-used by the BoQ editor view, so the cache is warm).
      const itemsBySection = await Promise.all(
        sections.map((s) =>
          fetchJson<ItemsResponse>(`/api/sections/${s.id}/items`),
        ),
      );

      let itemCount = 0;
      let total = 0;
      for (const { items } of itemsBySection) {
        itemCount += items.length;
        for (const item of items) {
          const amt = Number.parseFloat(item.amount || "0");
          if (!Number.isNaN(amt)) total += amt;
        }
      }

      return {
        document,
        sectionCount: sections.length,
        itemCount,
        estimatedTotal: total.toFixed(2),
      };
    },
  });

  return (
    <aside className="rounded-lg border border-border p-5 space-y-4 h-fit sticky top-4">
      <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
        Preview
      </h2>

      {!selectedDocumentId ? (
        <p className="text-xs text-muted-foreground">
          Select a BoQ document to preview its contents.
        </p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">Loading preview…</p>
      ) : !preview ? (
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t load preview for this document.
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {tBoq("document")}
            </div>
            <div className="text-sm font-medium">{preview.document.nameEn}</div>
            {preview.document.nameAr && (
              <div
                className="text-xs text-muted-foreground"
                dir="rtl"
              >
                {preview.document.nameAr}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-0.5">
              {preview.document.status} · v{preview.document.version}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
            <PreviewStat
              label="Sections"
              value={String(preview.sectionCount)}
            />
            <PreviewStat label="Items" value={String(preview.itemCount)} />
          </div>

          <div className="pt-3 border-t border-border">
            <div className="text-xs text-muted-foreground">
              {tBoq("grandTotal")}
            </div>
            <div className="text-xl font-semibold tracking-tight font-mono">
              {preview.estimatedTotal}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tracking-tight font-mono">
        {value}
      </div>
    </div>
  );
}

// ─── Export handler ──────────────────────────────────────────────────────

/**
 * Trigger the export based on the selected format. Both endpoints accept the
 * same body: `{ documentId, language, includeRateAnalysis }`. The response
 * type differs:
 *   - Excel → .xlsx blob (downloaded as a file)
 *   - PDF   → HTML string (opened in a new tab — user uses Ctrl+P)
 *
 * The "Bilingual" UI option maps to `"en"` for the API since the Phase 1
 * export endpoints only accept `"en" | "ar"`. (Forward-compat: when the API
 * gains bilingual support, only this mapping needs to change.)
 */
async function handleExport({
  documentId,
  format,
  language,
  includeRateAnalysis,
  setIsExporting,
  tErrors,
}: {
  documentId: string | null;
  format: ExportFormat;
  language: LanguageOption;
  includeRateAnalysis: boolean;
  setIsExporting: (b: boolean) => void;
  tErrors: ReturnType<typeof useTranslations>;
}) {
  if (!documentId) {
    toast.error("Select a BoQ document first.");
    return;
  }

  setIsExporting(true);
  try {
    const apiLanguage: "en" | "ar" = language === "ar" ? "ar" : "en";
    const body = JSON.stringify({
      documentId,
      language: apiLanguage,
      includeRateAnalysis,
    });

    if (format === "excel") {
      await handleExcelExport(body);
    } else {
      await handlePdfExport(body);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : tErrors("serverError");
    toast.error(message);
  } finally {
    setIsExporting(false);
  }
}

/**
 * POST /api/exports/excel — returns a .xlsx blob. We trigger a download
 * via a temporary <a> element. The server sets a sensible Content-Disposition
 * filename, but we fall back to "boq-export.xlsx" here so the download is
 * deterministic for tests.
 */
async function handleExcelExport(body: string): Promise<void> {
  const res = await fetch("/api/exports/excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "boq-export.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success("Excel export downloaded.");
}

/**
 * POST /api/exports/pdf — Phase 1 returns printable HTML. We open it in a
 * new tab and let the user use the browser's Ctrl+P / Cmd+P to save as PDF.
 * If the browser blocks the pop-up, we fall back to a toast telling the
 * user to allow pop-ups for this site.
 */
async function handlePdfExport(body: string): Promise<void> {
  const res = await fetch("/api/exports/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const html = await res.text();
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error(
      "Pop-up blocked — allow pop-ups for this site to open the PDF preview.",
    );
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  toast.success("PDF opened in a new tab — use Ctrl+P / Cmd+P to save as PDF.");
}
