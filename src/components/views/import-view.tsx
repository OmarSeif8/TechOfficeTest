"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  Check,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  FileWarning,
  Loader2,
} from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";
import { fetchJson } from "@/lib/queries";
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

/**
 * ImportView — S8: Import Wizard.
 *
 * WO-W-4g. A 4-step flow that imports an Excel file (.xlsx / .xls) into a new
 * BoQ Document + Section + Items.
 *
 *   1. Upload     — drag-and-drop or file picker; POST /api/imports/upload
 *                   (multipart). Validates .xlsx / .xls + ≤ 10MB client-side
 *                   before uploading so the user gets instant feedback.
 *   2. Select sheet — dropdown of returned sheet names; GET
 *                   /api/imports/[id]/sheets returns the first 10 rows of each
 *                   sheet for preview. "Next" advances to step 3.
 *   3. Map columns — 6 dropdowns (Code, Description EN, Description AR, Unit,
 *                   Qty, Rate) showing the column letters + header text from
 *                   row 1 of the chosen sheet. A "Skip rows" input accepts
 *                   comma-separated row numbers. "Validate" POSTs to
 *                   /api/imports/[id]/mapping and shows a 5-row preview of the
 *                   mapped data. "Commit" advances to step 4.
 *   4. Validate + Commit — summary card (X rows to import, Y to skip). The
 *                   "Import" button POSTs to /api/imports/[id]/commit which
 *                   creates a BoQDocument + BoQSection + BoQItems in one Prisma
 *                   transaction. On success: success toast + item count + a
 *                   "Go to BoQ editor" button that switches to the BoQ view
 *                   (with the new document set as currentDocumentId).
 *
 * The view is a Client Component — uses TanStack Query for the cacheable
 * sheets-preview GET and direct `fetch` for the upload/mapping/commit
 * mutations (per the WO-W-15 pattern: TanStack Query for reads, direct fetch
 * for writes).
 *
 * All visible strings are sourced via `useTranslations("import")` — keys from
 * src/i18n/messages/{en,ar}.json. Microcopy without dedicated i18n keys is
 * hardcoded English (matches the dashboard-view.tsx precedent).
 *
 * Layer purity: imports only @tanstack/react-query, next-intl, lucide-react,
 * @/lib/queries, @/lib/stores/ui-store, and shadcn/ui. No server-only code.
 */

// ─── Types ────────────────────────────────────────────────────────────────

/** POST /api/imports/upload response. */
interface UploadResponse {
  importBatchId: string;
  fileName: string;
  sheetNames: string[];
}

/** GET /api/imports/[id]/sheets — per-sheet preview shape. */
interface SheetPreview {
  name: string;
  rowCount: number;
  columnCount: number;
  /** First 10 rows of the sheet; each row is an array of cell-string values. */
  preview: string[][];
}

interface SheetsResponse {
  importBatchId: string;
  fileName: string;
  status: string;
  sheets: SheetPreview[];
}

/** POST /api/imports/[id]/mapping — per-row preview shape. */
interface MappedRowPreview {
  rowNumber: number;
  code: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unit: string | null;
  quantity: string;
  rate: string;
  skipped: boolean;
  hasMissingRequired: boolean;
}

interface MappingResponse {
  importBatchId: string;
  sheetName: string;
  skipRows: number[];
  mapping: Record<string, string>;
  preview: MappedRowPreview[];
}

/** POST /api/imports/[id]/commit response. */
interface CommitResponse {
  importBatchId: string;
  status: "COMMITTED";
  document: { id: string; nameEn: string; status: string; version: number };
  section: { id: string; code: string; titleEn: string };
  counts: { totalRows: number; importedRows: number; skippedRows: number };
  invalidRows: Array<{ rowNumber: number; reason: string }>;
}

/** The 6 BoQ fields the user can map Excel columns to. */
const BOQ_FIELDS = [
  "code",
  "descriptionEn",
  "descriptionAr",
  "unit",
  "quantity",
  "rate",
] as const;
type BoqField = (typeof BOQ_FIELDS)[number];

/** Column-ref per BoQ field. Required fields are non-empty strings; optional
 * fields are undefined when the user hasn't picked a column. */
type MappingState = Partial<Record<BoqField, string>>;

/** Sentinel value used in the optional-field Select dropdowns to represent
 * "no column selected". Radix Select disallows empty-string values, so we use
 * a placeholder token and convert back to `undefined` in state. */
const NONE_VALUE = "__none__";

/** Step indicator keys (matched to i18n keys: import.upload, import.selectSheet,
 * import.mapColumns, import.commit). */
const STEP_LABEL_KEYS = [
  "upload",
  "selectSheet",
  "mapColumns",
  "commit",
] as const;

// ─── Constants (BR-WEB-2, BR-WEB-3) ────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls"]);

// ─── Component ────────────────────────────────────────────────────────────

export function ImportView() {
  const t = useTranslations("import");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentProject = useUIStore((s) => s.setCurrentProject);
  const setCurrentDocument = useUIStore((s) => s.setCurrentDocument);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  // ─── Wizard state ──────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: upload result
  const [uploading, setUploading] = useState(false);
  const [importBatchId, setImportBatchId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Step 2: sheet selection
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [sheetConfirmed, setSheetConfirmed] = useState(false);

  // Step 3: mapping
  const [mapping, setMapping] = useState<MappingState>({});
  const [skipRowsInput, setSkipRowsInput] = useState("");
  const [validating, setValidating] = useState(false);
  const [mappingPreview, setMappingPreview] = useState<MappedRowPreview[] | null>(null);
  const [validatedSheet, setValidatedSheet] = useState<string | null>(null);

  // Step 4: commit
  const [documentName, setDocumentName] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);

  // ─── Derived: list of available columns from the selected sheet ─────────
  const selectedSheetPreview = useSelectedSheetPreview(
    importBatchId,
    selectedSheet,
  );
  const availableColumns = useAvailableColumns(selectedSheetPreview);

  // ─── Handlers ──────────────────────────────────────────────────────────

  /** Step 1: handle a file dropped or picked. Validates type + size before
   * uploading so the user gets instant feedback (the server re-validates
   * authoritatively). */
  const handleFile = useCallback(
    async (file: File) => {
      if (!currentProjectId) {
        toast.error("Select a project first");
        return;
      }
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        toast.error(t("invalidType"));
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(t("fileTooLarge"));
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(
          `/api/imports/upload?projectId=${encodeURIComponent(currentProjectId)}`,
          { method: "POST", body: formData },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as UploadResponse;
        setImportBatchId(data.importBatchId);
        setFileName(data.fileName);
        setStep(2);
        toast.success(`Uploaded ${data.fileName} — ${data.sheetNames.length} sheet(s)`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Upload failed",
        );
      } finally {
        setUploading(false);
      }
    },
    [currentProjectId, t],
  );

  /** Step 3: validate the mapping by POSTing to /mapping and showing the
   * returned 5-row preview. */
  const handleValidate = useCallback(async () => {
    if (!importBatchId || !selectedSheet) return;
    if (!mapping.descriptionEn || !mapping.quantity || !mapping.rate) {
      toast.error("Map at least the required fields: Description EN, Qty, Rate");
      return;
    }
    const skipRows = parseSkipRows(skipRowsInput);
    setValidating(true);
    try {
      const body = {
        sheetName: selectedSheet,
        mapping: sanitizeMapping(mapping),
        skipRows,
      };
      const res = await fetch(
        `/api/imports/${importBatchId}/mapping`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as MappingResponse;
      setMappingPreview(data.preview);
      setValidatedSheet(selectedSheet);
      toast.success(
        `Mapping validated — ${data.preview.length} preview row(s)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }, [importBatchId, selectedSheet, mapping, skipRowsInput]);

  /** Step 4: commit the import — creates BoQDocument + Section + Items. */
  const handleCommit = useCallback(async () => {
    if (!importBatchId) return;
    const name = documentName.trim() || fileName || "Imported BoQ";
    const skipRows = parseSkipRows(skipRowsInput);
    if (!mapping.descriptionEn || !mapping.quantity || !mapping.rate) {
      toast.error("Map at least the required fields before committing");
      return;
    }
    setCommitting(true);
    try {
      // The commit route reads sheetName + mapping from the stored
      // mappingJson (set by the validate step). We pass them again in the
      // body so the call works even if the stored mapping was lost (e.g.
      // worker restart between calls).
      const body = {
        documentName: name,
        mapping: sanitizeMapping(mapping),
        skipRows,
      };
      const res = await fetch(
        `/api/imports/${importBatchId}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CommitResponse;
      setCommitResult(data);
      // Defensive: keep the current project set (the upload route required
      // it, so it's already set — this is a no-op unless state was reset).
      if (currentProjectId) setCurrentProject(currentProjectId);
      // Surface the new document in the UI store so the BoQ editor opens it.
      setCurrentDocument(data.document.id);
      toast.success(
        `Imported ${data.counts.importedRows} item(s) into "${data.document.nameEn}"`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  }, [
    importBatchId,
    documentName,
    fileName,
    mapping,
    skipRowsInput,
    currentProjectId,
    setCurrentProject,
    setCurrentDocument,
  ]);

  /** Reset all wizard state so the user can start a fresh import. */
  const handleReset = useCallback(() => {
    setStep(1);
    setImportBatchId(null);
    setFileName(null);
    setSelectedSheet(null);
    setSheetConfirmed(false);
    setMapping({});
    setSkipRowsInput("");
    setMappingPreview(null);
    setValidatedSheet(null);
    setDocumentName("");
    setCommitResult(null);
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Multi-step Excel import — upload, pick a sheet, map columns, commit.
        </p>
      </div>

      {/* No project selected — block the whole wizard */}
      {!currentProjectId ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium">Select a project first</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Excel imports are scoped to a project. Pick a project from the
            Projects view, then come back here.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setCurrentView("projects")}
          >
            Open Projects
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : commitResult ? (
        <CommitSuccessCard
          result={commitResult}
          onGoToBoq={() => setCurrentView("boq")}
          onReset={handleReset}
        />
      ) : (
        <>
          {/* Step indicator */}
          <StepIndicator currentStep={step} labelKeys={STEP_LABEL_KEYS} />

          {/* Step body */}
          <div className="rounded-lg border border-border bg-card p-6">
            {step === 1 && (
              <UploadStep
                uploading={uploading}
                onFile={handleFile}
                fileName={fileName}
              />
            )}

            {step === 2 && (
              <SheetStep
                importBatchId={importBatchId}
                selectedSheet={selectedSheet}
                onSelectSheet={(name) => {
                  setSelectedSheet(name);
                  // Reset validated mapping when sheet changes.
                  setMappingPreview(null);
                  setValidatedSheet(null);
                }}
                onBack={() => setStep(1)}
                onNext={() => {
                  setSheetConfirmed(true);
                  setStep(3);
                }}
              />
            )}

            {step === 3 && (
              <MappingStep
                mapping={mapping}
                onMappingChange={(field, value) =>
                  setMapping((prev) => ({ ...prev, [field]: value }))
                }
                availableColumns={availableColumns}
                skipRowsInput={skipRowsInput}
                onSkipRowsChange={setSkipRowsInput}
                mappingPreview={mappingPreview}
                validating={validating}
                onValidate={handleValidate}
                canValidate={
                  !!mapping.descriptionEn &&
                  !!mapping.quantity &&
                  !!mapping.rate
                }
                canCommit={
                  !!mappingPreview && !!validatedSheet && !validating
                }
                onBack={() => setStep(2)}
                onCommit={() => {
                  // Default document name from file name if user hasn't typed one.
                  if (!documentName && fileName) {
                    setDocumentName(fileName.replace(/\.(xlsx|xls)$/i, ""));
                  }
                  setStep(4);
                }}
              />
            )}

            {step === 4 && (
              <CommitStep
                documentName={documentName}
                onDocumentNameChange={setDocumentName}
                fileName={fileName}
                selectedSheet={selectedSheet}
                mappingPreview={mappingPreview}
                skipRows={parseSkipRows(skipRowsInput)}
                committing={committing}
                onCommit={handleCommit}
                onBack={() => setStep(3)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 1: Upload ────────────────────────────────────────────────────────

function UploadStep({
  uploading,
  onFile,
  fileName,
}: {
  uploading: boolean;
  onFile: (file: File) => void;
  fileName: string | null;
}) {
  const t = useTranslations("import");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Upload className="w-4 h-4 text-primary" />
        <span>{t("upload")}</span>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-12 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted-foreground/50 hover:bg-muted/30"
        }`}
      >
        {uploading ? (
          <>
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Uploading…</p>
          </>
        ) : (
          <>
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm font-medium">{t("dropFile")}</p>
            <p className="text-xs text-muted-foreground">
              .xlsx or .xls · max 10 MB
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            // Reset so picking the same file again still fires onChange.
            e.target.value = "";
          }}
        />
      </div>

      {fileName && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span className="font-mono">{fileName}</span>
          <Check className="w-3.5 h-3.5 text-[var(--linear-success)]" />
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Select sheet ────────────────────────────────────────────────

function SheetStep({
  importBatchId,
  selectedSheet,
  onSelectSheet,
  onBack,
  onNext,
}: {
  importBatchId: string | null;
  selectedSheet: string | null;
  onSelectSheet: (name: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("import");

  // Fetch sheet names + previews. TanStack Query because this is a cacheable
  // GET (re-running the wizard shouldn't re-fetch if the batch is unchanged).
  const { data, isLoading, error } = useQuery<SheetsResponse>({
    queryKey: ["imports", importBatchId, "sheets"],
    queryFn: () => fetchJson(`/api/imports/${importBatchId}/sheets`),
    enabled: !!importBatchId,
  });

  const sheets = data?.sheets ?? [];
  const activeSheet = sheets.find((s) => s.name === selectedSheet);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileSpreadsheet className="w-4 h-4 text-primary" />
        <span>{t("selectSheet")}</span>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading sheets…</div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
          <FileWarning className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {error instanceof Error ? error.message : "Failed to load sheets"}
          </span>
        </div>
      )}

      {!isLoading && sheets.length > 0 && (
        <>
          <div className="space-y-2">
            <Label htmlFor="sheet-select">
              Sheet ({sheets.length} available)
            </Label>
            <Select
              value={selectedSheet ?? undefined}
              onValueChange={onSelectSheet}
            >
              <SelectTrigger id="sheet-select" className="w-full">
                <SelectValue placeholder="Pick a sheet…" />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name} · {s.rowCount} rows
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activeSheet && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Preview · first {Math.min(10, activeSheet.preview.length)} of{" "}
                  {activeSheet.rowCount} rows
                </span>
                <span>{activeSheet.columnCount} columns</span>
              </div>
              <PreviewTable preview={activeSheet.preview} />
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!selectedSheet}
              onClick={onNext}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 3: Map columns ──────────────────────────────────────────────────

function MappingStep({
  mapping,
  onMappingChange,
  availableColumns,
  skipRowsInput,
  onSkipRowsChange,
  mappingPreview,
  validating,
  onValidate,
  canValidate,
  canCommit,
  onBack,
  onCommit,
}: {
  mapping: MappingState;
  onMappingChange: (field: BoqField, value: string | undefined) => void;
  availableColumns: Array<{ letter: string; header: string }>;
  skipRowsInput: string;
  onSkipRowsChange: (v: string) => void;
  mappingPreview: MappedRowPreview[] | null;
  validating: boolean;
  onValidate: () => void;
  canValidate: boolean;
  canCommit: boolean;
  onBack: () => void;
  onCommit: () => void;
}) {
  const t = useTranslations("import");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileSpreadsheet className="w-4 h-4 text-primary" />
        <span>{t("mapColumns")}</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Pick the Excel column for each BoQ field. Description EN, Qty, and Rate
        are required. Code / Description AR / Unit are optional.
      </p>

      {/* Mapping grid: 2 columns of (field label + dropdown) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MappingRow
          label="Code"
          required={false}
          value={mapping.code}
          columns={availableColumns}
          onChange={(v) => onMappingChange("code", v)}
        />
        <MappingRow
          label="Description (EN)"
          required
          value={mapping.descriptionEn}
          columns={availableColumns}
          onChange={(v) => onMappingChange("descriptionEn", v)}
        />
        <MappingRow
          label="Description (AR)"
          required={false}
          value={mapping.descriptionAr}
          columns={availableColumns}
          onChange={(v) => onMappingChange("descriptionAr", v)}
        />
        <MappingRow
          label="Unit"
          required={false}
          value={mapping.unit}
          columns={availableColumns}
          onChange={(v) => onMappingChange("unit", v)}
        />
        <MappingRow
          label="Qty"
          required
          value={mapping.quantity}
          columns={availableColumns}
          onChange={(v) => onMappingChange("quantity", v)}
        />
        <MappingRow
          label="Rate"
          required
          value={mapping.rate}
          columns={availableColumns}
          onChange={(v) => onMappingChange("rate", v)}
        />
      </div>

      {/* Skip rows input */}
      <div className="space-y-2">
        <Label htmlFor="skip-rows">Skip rows (comma-separated row numbers)</Label>
        <Input
          id="skip-rows"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 2, 5, 8"
          value={skipRowsInput}
          onChange={(e) => onSkipRowsChange(e.target.value)}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          These row numbers (1-indexed, as shown in the preview) will be
          skipped during commit. Useful for header repeats or summary rows.
        </p>
      </div>

      {/* Validate button + 5-row preview */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canValidate || validating}
          onClick={onValidate}
        >
          {validating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          {t("validate")}
        </Button>
        {mappingPreview && (
          <span className="text-xs text-muted-foreground">
            {mappingPreview.length} preview row(s)
          </span>
        )}
      </div>

      {mappingPreview && mappingPreview.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Mapped data preview
          </div>
          <MappedPreviewTable rows={mappingPreview} />
        </div>
      )}

      {/* Back / Commit */}
      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canCommit}
          onClick={onCommit}
        >
          {t("commit")}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function MappingRow({
  label,
  required,
  value,
  columns,
  onChange,
}: {
  label: string;
  required: boolean;
  value: string | undefined;
  columns: Array<{ letter: string; header: string }>;
  onChange: (value: string | undefined) => void;
}) {
  // Radix Select disallows empty-string values, so the optional fields get a
  // sentinel "__none__" item that maps back to undefined.
  const selectValue = value ?? (required ? undefined : NONE_VALUE);
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Select
        value={selectValue}
        onValueChange={(v) => onChange(v === NONE_VALUE ? undefined : v)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Pick a column…" />
        </SelectTrigger>
        <SelectContent>
          {!required && (
            <SelectItem value={NONE_VALUE}>— None —</SelectItem>
          )}
          {columns.map((c) => (
            <SelectItem key={c.letter} value={c.letter}>
              <span className="font-mono text-xs text-muted-foreground mr-2">
                {c.letter}
              </span>
              <span className="truncate">{c.header || "(empty header)"}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Step 4: Commit ───────────────────────────────────────────────────────

function CommitStep({
  documentName,
  onDocumentNameChange,
  fileName,
  selectedSheet,
  mappingPreview,
  skipRows,
  committing,
  onCommit,
  onBack,
}: {
  documentName: string;
  onDocumentNameChange: (v: string) => void;
  fileName: string | null;
  selectedSheet: string | null;
  mappingPreview: MappedRowPreview[] | null;
  skipRows: number[];
  committing: boolean;
  onCommit: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("import");
  const defaultDocName = fileName
    ? fileName.replace(/\.(xlsx|xls)$/i, "")
    : "Imported BoQ";

  const rowsToImport = mappingPreview
    ? mappingPreview.filter((r) => !r.skipped && !r.hasMissingRequired).length
    : 0;
  const rowsToSkip = skipRows.length;
  const invalidPreviewRows = mappingPreview
    ? mappingPreview.filter((r) => r.hasMissingRequired).length
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Check className="w-4 h-4 text-primary" />
        <span>{t("commit")}</span>
      </div>

      {/* Summary card */}
      <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Import summary
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Source file</dt>
          <dd className="font-mono text-xs truncate">{fileName ?? "—"}</dd>
          <dt className="text-muted-foreground">Sheet</dt>
          <dd className="font-mono text-xs">{selectedSheet ?? "—"}</dd>
          <dt className="text-muted-foreground">Preview rows (validated)</dt>
          <dd className="font-mono">{mappingPreview?.length ?? 0}</dd>
          <dt className="text-muted-foreground">Rows to import (preview)</dt>
          <dd className="font-mono">{rowsToImport}</dd>
          <dt className="text-muted-foreground">Rows to skip (user-marked)</dt>
          <dd className="font-mono">{rowsToSkip}</dd>
          {invalidPreviewRows > 0 && (
            <>
              <dt className="text-muted-foreground">
                Preview rows w/ missing required
              </dt>
              <dd className="font-mono text-[var(--linear-warning)]">
                {invalidPreviewRows}
              </dd>
            </>
          )}
        </dl>
        <p className="text-xs text-muted-foreground pt-1">
          The commit endpoint creates a BoQDocument + BoQSection + BoQItems in a
          single transaction. Final counts (which include all sheet rows beyond
          the 5-row preview) will be shown on the success screen.
        </p>
      </div>

      {/* Document name */}
      <div className="space-y-2">
        <Label htmlFor="doc-name">Document name</Label>
        <Input
          id="doc-name"
          type="text"
          placeholder={defaultDocName}
          value={documentName}
          onChange={(e) => onDocumentNameChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          The new BoQDocument will be created in DRAFT status under the current
          project. Imported items go into a single section (code:
          SECTION-1, title: Imported Items).
        </p>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={committing}
          onClick={onCommit}
        >
          {committing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          Import
        </Button>
      </div>
    </div>
  );
}

// ─── Commit success card ───────────────────────────────────────────────────

function CommitSuccessCard({
  result,
  onGoToBoq,
  onReset,
}: {
  result: CommitResponse;
  onGoToBoq: () => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--linear-success)]/40 bg-[var(--linear-success)]/5 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-[var(--linear-success)]/20 flex items-center justify-center">
          <Check className="w-4 h-4 text-[var(--linear-success)]" />
        </div>
        <h2 className="text-lg font-semibold">Import successful</h2>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Document</dt>
        <dd className="font-medium">{result.document.nameEn}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="font-mono text-xs">{result.document.status}</dd>
        <dt className="text-muted-foreground">Section</dt>
        <dd className="font-mono text-xs">
          {result.section.code} · {result.section.titleEn}
        </dd>
        <dt className="text-muted-foreground">Items imported</dt>
        <dd className="font-mono text-lg font-semibold text-[var(--linear-success)]">
          {result.counts.importedRows}
        </dd>
        <dt className="text-muted-foreground">Rows skipped</dt>
        <dd className="font-mono">{result.counts.skippedRows}</dd>
        <dt className="text-muted-foreground">Total rows seen</dt>
        <dd className="font-mono">{result.counts.totalRows}</dd>
      </dl>

      {result.invalidRows.length > 0 && (
        <div className="rounded-md border border-[var(--linear-warning)]/30 bg-[var(--linear-warning)]/5 p-3 text-xs">
          <div className="font-medium mb-1 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {result.invalidRows.length} row(s) skipped due to missing required
            fields:
          </div>
          <ul className="space-y-0.5 font-mono text-muted-foreground max-h-32 overflow-y-auto">
            {result.invalidRows.slice(0, 20).map((r) => (
              <li key={r.rowNumber}>
                row {r.rowNumber} — {r.reason}
              </li>
            ))}
            {result.invalidRows.length > 20 && (
              <li>… and {result.invalidRows.length - 20} more</li>
            )}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button type="button" size="sm" onClick={onGoToBoq}>
          Go to BoQ editor
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onReset}
        >
          Import another file
        </Button>
      </div>
    </div>
  );
}

// ─── Step indicator ──────────────────────────────────────────────────────

function StepIndicator({
  currentStep,
  labelKeys,
}: {
  currentStep: number;
  labelKeys: readonly string[];
}) {
  const t = useTranslations("import");
  return (
    <div className="flex items-center gap-1 text-xs">
      {labelKeys.map((key, idx) => {
        const stepNum = idx + 1;
        const isCurrent = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        return (
          <div key={key} className="flex items-center">
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
                isCurrent
                  ? "bg-primary/10 text-primary"
                  : isDone
                    ? "text-muted-foreground"
                    : "text-muted-foreground/60"
              }`}
            >
              <span
                className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-medium ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isDone
                      ? "bg-[var(--linear-success)]/20 text-[var(--linear-success)]"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? <Check className="w-3 h-3" /> : stepNum}
              </span>
              <span className="font-medium">{t(key as never)}</span>
            </div>
            {idx < labelKeys.length - 1 && (
              <ChevronRight className="w-3 h-3 text-muted-foreground/40 mx-0.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Preview tables ────────────────────────────────────────────────────────

/** Render the raw Excel preview as a string[][] table (first row = header). */
function PreviewTable({ preview }: { preview: string[][] }) {
  if (!preview.length) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No preview rows available.
      </div>
    );
  }
  const [header, ...rows] = preview;
  return (
    <div className="rounded-md border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left">
            <th className="px-2 py-1.5 font-medium text-muted-foreground w-8 text-right">
              #
            </th>
            {header.map((cell, i) => (
              <th
                key={i}
                className="px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap"
              >
                <span className="font-mono text-[10px] text-muted-foreground/60 mr-1">
                  {columnIdxToLetter(i)}
                </span>
                {cell || "(empty)"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-border last:border-0 hover:bg-muted/20"
            >
              <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground/60 text-right">
                {ri + 2}
              </td>
              {header.map((_, ci) => (
                <td
                  key={ci}
                  className="px-2 py-1.5 font-mono text-[11px] max-w-[200px] truncate"
                  title={row[ci] ?? ""}
                >
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Render the mapped BoQ preview (5 rows returned by /mapping). */
function MappedPreviewTable({ rows }: { rows: MappedRowPreview[] }) {
  return (
    <div className="rounded-md border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left">
            <th className="px-2 py-1.5 font-medium text-muted-foreground w-8 text-right">
              Row
            </th>
            <th className="px-2 py-1.5 font-medium text-muted-foreground">Code</th>
            <th className="px-2 py-1.5 font-medium text-muted-foreground">
              Description (EN)
            </th>
            <th className="px-2 py-1.5 font-medium text-muted-foreground">
              Description (AR)
            </th>
            <th className="px-2 py-1.5 font-medium text-muted-foreground">Unit</th>
            <th className="px-2 py-1.5 font-medium text-muted-foreground text-right">
              Qty
            </th>
            <th className="px-2 py-1.5 font-medium text-muted-foreground text-right">
              Rate
            </th>
            <th className="px-2 py-1.5 font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.rowNumber}
              className={`border-b border-border last:border-0 ${
                r.skipped
                  ? "bg-[var(--linear-warning)]/5"
                  : r.hasMissingRequired
                    ? "bg-destructive/5"
                    : "hover:bg-muted/20"
              }`}
            >
              <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground/60 text-right">
                {r.rowNumber}
              </td>
              <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                {r.code ?? "—"}
              </td>
              <td className="px-2 py-1.5 max-w-[200px] truncate" title={r.descriptionEn}>
                {r.descriptionEn}
              </td>
              <td
                className="px-2 py-1.5 text-muted-foreground max-w-[150px] truncate"
                dir="rtl"
                lang="ar"
                title={r.descriptionAr ?? ""}
              >
                {r.descriptionAr ?? "—"}
              </td>
              <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                {r.unit ?? "—"}
              </td>
              <td className="px-2 py-1.5 font-mono text-right">{r.quantity}</td>
              <td className="px-2 py-1.5 font-mono text-right">{r.rate}</td>
              <td className="px-2 py-1.5 text-[10px]">
                {r.skipped ? (
                  <span className="text-[var(--linear-warning)]">skipped</span>
                ) : r.hasMissingRequired ? (
                  <span className="text-destructive">invalid</span>
                ) : (
                  <span className="text-[var(--linear-success)]">ok</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────

/**
 * Fetch the sheet preview (TanStack Query) — keyed on the batch + sheet name
 * so switching sheets doesn't re-fetch the same one.
 */
function useSelectedSheetPreview(
  importBatchId: string | null,
  selectedSheet: string | null,
): SheetPreview | null {
  const { data } = useQuery<SheetsResponse>({
    queryKey: ["imports", importBatchId, "sheets"],
    queryFn: () => fetchJson(`/api/imports/${importBatchId}/sheets`),
    enabled: !!importBatchId,
    // Cache for the wizard lifetime — the file is on disk in /tmp keyed by
    // batch id, so it doesn't change between requests.
    staleTime: 5 * 60 * 1000,
  });
  if (!data || !selectedSheet) return null;
  return data.sheets.find((s) => s.name === selectedSheet) ?? null;
}

/**
 * Build the dropdown list of available columns from the selected sheet's
 * header row. Returns `[{ letter, header }]` — one entry per column.
 *
 * The dropdown value is the column LETTER (always unique), so the user's
 * mapping survives duplicate header names.
 */
function useAvailableColumns(
  sheet: SheetPreview | null,
): Array<{ letter: string; header: string }> {
  if (!sheet || sheet.preview.length === 0) return [];
  const header = sheet.preview[0];
  const cols: Array<{ letter: string; header: string }> = [];
  for (let i = 0; i < sheet.columnCount; i++) {
    cols.push({
      letter: columnIdxToLetter(i),
      header: header[i] ?? "",
    });
  }
  return cols;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a 0-indexed column number to a spreadsheet column letter
 * (0 → "A", 25 → "Z", 26 → "AA", etc.).
 */
function columnIdxToLetter(idx: number): string {
  let n = idx + 1; // 1-indexed for the math
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Parse the comma-separated "skip rows" input into a sorted, deduped array of
 * non-negative integers. Invalid tokens are silently dropped.
 *
 * Note: the API expects 1-indexed row numbers (per the sheets/mapping route
 * convention: row 1 = header). The user types what they see in the preview
 * (which is also 1-indexed in our table).
 */
function parseSkipRows(input: string): number[] {
  if (!input.trim()) return [];
  const tokens = input.split(/[\s,]+/).filter(Boolean);
  const seen = new Set<number>();
  for (const tok of tokens) {
    const n = Number(tok);
    if (Number.isInteger(n) && n >= 1 && !seen.has(n)) {
      seen.add(n);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Strip undefined entries from the mapping object before POSTing. The API's
 * zod schema (`ImportMappingSchema`) treats optional fields as undefined,
 * which JSON.stringify omits by default — but we be explicit so the wire
 * shape is predictable.
 */
function sanitizeMapping(m: MappingState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of BOQ_FIELDS) {
    const v = m[field];
    if (v !== undefined && v !== "") {
      out[field] = v;
    }
  }
  return out;
}
