"use client";

/**
 * BoQ Editor View (S3/S4) — the critical screen.
 *
 * Per SPEC_PHASE1_BOQ_WEB §3 (F3): "BoQ builder: multiple BoQ documents →
 * sections → items. Editing any qty/rate updates all totals without manual
 * refresh. A BoQ with 5,000 items scrolls and recalculates without visible
 * lag (< 300 ms recompute)."
 *
 * Implementation overview:
 *   1. Document selector — dropdown to pick which BoQ document to edit, plus
 *      a "New document" button that POSTs to /api/projects/[id]/documents.
 *   2. Section tree — sections render as collapsible cards. Each card holds
 *      an items table with Code / Description / Unit / Qty / Rate / Amount
 *      + Actions columns. "Add section" lives at the top of the document,
 *      "Add item" lives at the bottom of each section.
 *   3. Inline editing — click Qty or Rate to edit in place. PATCH fires on
 *      blur or Enter with `expectedVersion` for optimistic concurrency. The
 *      server response includes `{ item, totals }` — we splice both into
 *      the document detail query cache via `setQueryData` so the totals bar
 *      updates without a refetch (live totals, no flicker).
 *   4. Delete — trash icon on each row soft-deletes the item; we invalidate
 *      the document detail query so the server recomputes totals.
 *   5. Sticky grand total bar — fixed at the bottom of the scroll area,
 *      shows subtotal, VAT (if any), and grand total with thousand separators.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * and shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost, apiPatch, apiDelete } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────

interface BoQDocument {
  id: string;
  projectId: string;
  nameEn: string;
  nameAr: string | null;
  status: string;
  version: number;
}

interface BoQSection {
  id: string;
  documentId: string;
  code: string;
  titleEn: string;
  titleAr: string | null;
  sortOrder: number;
  version: number;
}

interface BoQItem {
  id: string;
  sectionId: string;
  documentId: string;
  code: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unitId: string | null;
  quantity: string;
  rate: string;
  amount: string;
  itemType: string;
  sortOrder: number;
  version: number;
}

interface DocumentTotals {
  subtotal: string;
  vatPercentage: string;
  vatAmount: string;
  totalIncludingVat: string;
  itemCount: number;
}

interface DocumentsListResponse {
  documents: BoQDocument[];
}

interface DocumentDetailResponse {
  document: BoQDocument;
  sections: BoQSection[];
  items: BoQItem[];
  totals: DocumentTotals;
}

interface PatchItemResponse {
  item: BoQItem;
  totals: DocumentTotals;
}

// ─── Root component ───────────────────────────────────────────────────────

export function BoQEditorView() {
  const t = useTranslations("boq");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const currentDocumentId = useUIStore((s) => s.currentDocumentId);
  const setCurrentDocument = useUIStore((s) => s.setCurrentDocument);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  // Fetch the list of BoQ documents for the current project. Disabled when
  // there's no current project (we'll show the empty state instead).
  const { data: docsResp, isLoading: docsLoading } =
    useQuery<DocumentsListResponse>({
      queryKey: currentProjectId
        ? queryKeys.documents.list(currentProjectId)
        : ["documents", "list", "_disabled"],
      queryFn: () =>
        fetchJson(`/api/projects/${currentProjectId}/documents`),
      enabled: !!currentProjectId,
    });

  const documents = docsResp?.documents ?? [];

  // Auto-select the first document when documents first load and the user
  // hasn't picked one. The selected doc id is stored in the UI store so it
  // survives view switches (e.g. BoQ → Library → BoQ).
  useEffect(() => {
    if (!currentDocumentId && documents.length > 0) {
      setCurrentDocument(documents[0].id);
    }
  }, [currentDocumentId, documents, setCurrentDocument]);

  // The currently selected document id — prefer the UI store, fall back to
  // the first document in the list.
  const selectedDocId = currentDocumentId ?? documents[0]?.id ?? null;

  // ─── Empty state: no project selected ──────────────────────────────────
  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            No project selected. Create a project or pick one from the projects list to start building a BoQ.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              onClick={() => setCurrentView("projects")}
              className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)]"
            >
              <Plus className="w-4 h-4 mr-1" />
              Go to Projects
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentView("dashboard")}
            >
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-8 pb-32 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {documents.length}{" "}
            {documents.length === 1 ? "document" : "documents"} in this project
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DocumentSelector
            documents={documents}
            value={selectedDocId}
            onChange={setCurrentDocument}
            loading={docsLoading}
          />
          <CreateDocumentButton projectId={currentProjectId} />
        </div>
      </div>

      {/* Body */}
      {docsLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <FileText className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium">No documents yet</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Create a BoQ document to start adding sections and items.
          </p>
          <div className="mt-4">
            <CreateDocumentButton
              projectId={currentProjectId}
              variant="default"
            />
          </div>
        </div>
      ) : selectedDocId ? (
        <DocumentEditor documentId={selectedDocId} />
      ) : null}
    </div>
  );
}

// ─── Document selector ────────────────────────────────────────────────────

function DocumentSelector({
  documents,
  value,
  onChange,
  loading,
}: {
  documents: BoQDocument[];
  value: string | null;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  const t = useTranslations("boq");
  const tc = useTranslations("common");
  if (loading) {
    return (
      <div className="h-9 px-3 flex items-center rounded-md border border-input bg-input/30 text-sm text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }
  if (documents.length === 0) return null;
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-64">
        <SelectValue placeholder={t("document")} />
      </SelectTrigger>
      <SelectContent>
        {documents.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            <span className="font-mono text-xs text-muted-foreground mr-2">
              {d.status}
            </span>
            <span className="truncate">{d.nameEn}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Create document button ───────────────────────────────────────────────

function CreateDocumentButton({
  projectId,
  variant = "outline",
}: {
  projectId: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const name = `BoQ ${new Date().toLocaleDateString()}`;
      return apiPost<BoQDocument>(`/api/projects/${projectId}/documents`, {
        projectId,
        nameEn: name,
      });
    },
    onSuccess: (doc) => {
      // Invalidate the list so the new document appears in the selector.
      queryClient.invalidateQueries({
        queryKey: queryKeys.documents.list(projectId),
      });
      // Set as the active document so the editor opens it immediately.
      useUIStore.getState().setCurrentDocument(doc.id);
      toast.success("Document created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      className="gap-1"
    >
      {mutation.isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Plus className="w-3.5 h-3.5" />
      )}
      New document
    </Button>
  );
}

// ─── Document editor (main body) ──────────────────────────────────────────

function DocumentEditor({ documentId }: { documentId: string }) {
  const t = useTranslations("boq");
  const tc = useTranslations("common");

  const { data, isLoading, error } = useQuery<DocumentDetailResponse>({
    queryKey: queryKeys.documents.detail(documentId),
    queryFn: () => fetchJson(`/api/documents/${documentId}`),
  });

  // Group items by section. Must be called unconditionally (Rules of Hooks).
  // Returns an empty Map while `data` is loading.
  const itemsBySection = useMemo(() => {
    const map = new Map<string, BoQItem[]>();
    if (!data) return map;
    for (const s of data.sections) map.set(s.id, []);
    for (const item of data.items) {
      const arr = map.get(item.sectionId);
      if (arr) arr.push(item);
    }
    // Sort each section's items by sortOrder for stable display.
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        Failed to load document.
        {error ? ` ${error.message}` : ""}
      </div>
    );
  }

  const { document: doc, sections, totals } = data;

  return (
    <div className="space-y-4">
      {/* Document header */}
      <div className="rounded-lg border border-border p-4 bg-card">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("document")}
            </div>
            <div className="text-lg font-medium truncate">{doc.nameEn}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Status: <span className="font-mono">{doc.status}</span>
              {" · "}
              {sections.length}{" "}
              {sections.length === 1 ? "section" : "sections"}
              {" · "}
              {totals.itemCount} {t("item").toLowerCase()}
              {totals.itemCount === 1 ? "" : "s"}
            </div>
          </div>
          <CreateSectionButton
            documentId={documentId}
            sortOrder={sections.length}
          />
        </div>
      </div>

      {/* Sections tree */}
      {sections.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <h3 className="text-sm font-medium">No sections yet</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Add a section to start adding items.
          </p>
          <div className="mt-4">
            <CreateSectionButton
              documentId={documentId}
              sortOrder={0}
              variant="default"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              items={itemsBySection.get(section.id) ?? []}
            />
          ))}
        </div>
      )}

      {/* Grand total bar (sticky to the bottom of the scroll area) */}
      <GrandTotalBar totals={totals} />
    </div>
  );
}

// ─── Section Header with Inline Edit ───────────────────────────────────────

function SectionHeader({
  section,
  expanded,
  onToggle,
  itemsCount,
  subtotal,
}: {
  section: BoQSection;
  expanded: boolean;
  onToggle: () => void;
  itemsCount: number;
  subtotal: string;
}) {
  const t = useTranslations("boq");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.titleEn);
  const [codeDraft, setCodeDraft] = useState(section.code);

  const mutation = useMutation({
    mutationFn: async (vars: { titleEn: string; code: string }) => {
      return apiPatch<BoQSection>(`/api/sections/${section.id}`, {
        titleEn: vars.titleEn,
        code: vars.code,
        expectedVersion: section.version,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documents.detail(section.documentId),
      });
      setEditing(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update section: ${err.message}`);
    },
  });

  const handleSave = (e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation();
    if (titleDraft.trim() === "") {
      toast.error("Section title cannot be empty");
      return;
    }
    mutation.mutate({ titleEn: titleDraft, code: codeDraft });
  };

  return (
    <div className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/40 transition-colors text-left border-b border-border/50">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          className="p-1 hover:bg-muted rounded text-muted-foreground transition-colors shrink-0"
          title={expanded ? "Collapse section" : "Expand section"}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        {editing ? (
          <div
            className="flex items-center gap-2 flex-1 max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              type="text"
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              className="h-7 w-16 font-mono text-xs"
              placeholder="Code"
              disabled={mutation.isPending}
            />
            <Input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="h-7 flex-1 text-xs"
              placeholder="Section title"
              disabled={mutation.isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave(e);
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleSave}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setEditing(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 min-w-0 flex-1 group/sec cursor-pointer"
            onClick={() => {
              setTitleDraft(section.titleEn);
              setCodeDraft(section.code);
              setEditing(true);
            }}
            title="Click to edit section title"
          >
            <span className="font-mono text-xs text-muted-foreground shrink-0 bg-muted/60 px-1.5 py-0.5 rounded">
              {section.code}
            </span>
            <span className="font-medium truncate text-foreground group-hover/sec:underline">
              {section.titleEn || "(untitled)"}
            </span>
            <span className="text-[10px] text-muted-foreground/60 opacity-0 group-hover/sec:opacity-100 transition-opacity">
              ✎
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        <span>
          {itemsCount} {t("item").toLowerCase()}
          {itemsCount === 1 ? "" : "s"}
        </span>
        <span className="font-mono font-medium text-foreground">
          {formatNumber(subtotal)}
        </span>
      </div>
    </div>
  );
}

// ─── Section block ─────────────────────────────────────────────────────────

function SectionBlock({
  section,
  items,
}: {
  section: BoQSection;
  items: BoQItem[];
}) {
  const t = useTranslations("boq");
  const [expanded, setExpanded] = useState(true);

  // Section subtotal = Σ of rounded item amounts (per BR-3).
  const sectionSubtotal = useMemo(() => {
    return items
      .reduce((sum, i) => sum + Number(i.amount || "0"), 0)
      .toFixed(2);
  }, [items]);

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-card">
      <SectionHeader
        section={section}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
        itemsCount={items.length}
        subtotal={sectionSubtotal}
      />

      {/* Items table */}
      {expanded && (
        <div>
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No items in this section.
              <div className="mt-3 flex justify-center">
                <CreateItemButton sectionId={section.id} sortOrder={0} />
              </div>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/10 text-left">
                    <th className="px-4 py-2 font-medium text-muted-foreground w-24">
                      {t("code")}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {t("description")}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-20">
                      {t("unit")}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-24 text-right">
                      {t("quantity")}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-28 text-right">
                      {t("rate")}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-32 text-right">
                      {t("amount")}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground w-12 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </tbody>
              </table>
              <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs">
                <CreateItemButton sectionId={section.id} sortOrder={items.length} />
                <div className="text-muted-foreground">
                  {t("subtotal")}:{" "}
                  <span className="font-mono text-foreground">
                    {formatNumber(sectionSubtotal)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Item row ──────────────────────────────────────────────────────────────

function ItemRow({ item }: { item: BoQItem }) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground w-24">
        <InlineEdit
          itemId={item.id}
          field="code"
          value={item.code ?? ""}
          placeholder="Code"
          version={item.version}
          className="w-20 font-mono text-xs"
        />
      </td>
      <td className="px-4 py-2">
        <InlineEdit
          itemId={item.id}
          field="descriptionEn"
          value={item.descriptionEn}
          placeholder="Item description"
          version={item.version}
          className="w-full text-left"
        />
      </td>
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground w-20">
        <InlineEdit
          itemId={item.id}
          field="unitId"
          value={item.unitId ?? ""}
          placeholder="Unit"
          version={item.version}
          className="w-16 font-mono text-xs"
        />
      </td>
      <td className="px-4 py-2 text-right w-24">
        <InlineEdit
          itemId={item.id}
          field="quantity"
          value={item.quantity}
          version={item.version}
          className="w-20 text-right font-mono text-xs"
        />
      </td>
      <td className="px-4 py-2 text-right w-28">
        <InlineEdit
          itemId={item.id}
          field="rate"
          value={item.rate}
          version={item.version}
          className="w-24 text-right font-mono text-xs"
        />
      </td>
      <td className="px-4 py-2 text-right font-mono w-32">
        {formatNumber(item.amount)}
      </td>
      <td className="px-4 py-2 text-right w-12">
        <DeleteItemButton itemId={item.id} version={item.version} />
      </td>
    </tr>
  );
}

// ─── Inline edit (Code / Description / Unit / Qty / Rate) ──────────────────

type InlineField = "code" | "descriptionEn" | "unitId" | "quantity" | "rate";

/**
 * Click-to-edit cell. On commit (blur or Enter), PATCHes `/api/items/[id]`
 * with `{ [field]: value, expectedVersion }`. On success, splices the
 * returned `{ item, totals }` into the document detail cache so the totals
 * bar updates without a refetch (live totals — F3 requirement).
 */
function InlineEdit({
  itemId,
  field,
  value,
  placeholder,
  version,
  className,
}: {
  itemId: string;
  field: InlineField;
  value: string;
  placeholder?: string;
  version: number;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select-all on entering edit mode for fast overwrite.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
  };

  const mutation = useMutation({
    mutationFn: async (vars: { value: string; expectedVersion: number }) => {
      const body: Record<string, unknown> = {
        expectedVersion: vars.expectedVersion,
      };
      body[field] =
        vars.value === "" && (field === "code" || field === "unitId")
          ? null
          : vars.value;
      return apiPatch<PatchItemResponse>(`/api/items/${itemId}`, body);
    },
    onMutate: () => setSaving(true),
    onSuccess: (data) => {
      // Splice the updated item + new totals into the document detail cache.
      queryClient.setQueryData<DocumentDetailResponse>(
        queryKeys.documents.detail(data.item.documentId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((i) =>
              i.id === data.item.id ? data.item : i,
            ),
            totals: data.totals,
          };
        },
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.documents.detail(data.item.documentId),
      });
      setSaving(false);
      setEditing(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to save: ${err.message}`);
      setSaving(false);
      setEditing(false);
      setDraft(value); // revert to cached server value
    },
  });

  const commit = () => {
    if (draft === value) {
      // No change — just exit edit mode.
      setEditing(false);
      return;
    }
    if (field === "quantity" || field === "rate") {
      if (draft.trim() === "" || Number.isNaN(Number(draft))) {
        toast.error("Please enter a valid number");
        setDraft(value);
        setEditing(false);
        return;
      }
    } else if (field === "descriptionEn") {
      if (draft.trim() === "") {
        toast.error("Description cannot be empty");
        setDraft(value);
        setEditing(false);
        return;
      }
    }
    mutation.mutate({ value: draft, expectedVersion: version });
  };

  const isNumeric = field === "quantity" || field === "rate";

  if (editing) {
    return (
      <div
        className={`flex items-center gap-1 ${
          isNumeric ? "justify-end" : "justify-start"
        }`}
      >
        <Input
          ref={inputRef}
          type="text"
          inputMode={isNumeric ? "decimal" : "text"}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          className={`h-7 text-xs ${
            className ??
            (isNumeric ? "w-24 text-right font-mono" : "w-full text-left")
          }`}
          disabled={saving}
        />
        {saving && (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />
        )}
      </div>
    );
  }

  const displayText = isNumeric
    ? formatNumber(value)
    : value || placeholder || "—";
  const isPlaceholder = !value && !isNumeric;

  return (
    <button
      type="button"
      onClick={startEditing}
      className={`text-xs hover:bg-accent hover:text-accent-foreground rounded px-1.5 py-1 -my-1 transition-colors inline-flex items-center gap-1 group/edit cursor-pointer ${
        isNumeric
          ? "font-mono w-full justify-end text-right"
          : isPlaceholder
          ? "text-muted-foreground/60 italic w-full text-left"
          : "w-full text-left font-normal"
      }`}
      title="Click to edit"
    >
      <span className="truncate">{displayText}</span>
      {saving && (
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

// ─── Delete item button ────────────────────────────────────────────────────

function DeleteItemButton({
  itemId,
  version,
}: {
  itemId: string;
  version: number;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      // expectedVersion is passed as a query param per the API contract.
      return apiDelete<void>(
        `/api/items/${itemId}?expectedVersion=${version}`,
      );
    },
    onSuccess: () => {
      // Invalidate the whole documents query namespace — the server
      // recomputes totals on the next fetch (the simplest correct path for
      // deletes; the alternative would be client-side totals recompute which
      // we avoid to keep totals computation in the pure domain function).
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      toast.success("Item deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      aria-label="Delete item"
    >
      {mutation.isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Trash2 className="w-3.5 h-3.5" />
      )}
    </Button>
  );
}

// ─── Create item button ────────────────────────────────────────────────────

function CreateItemButton({
  sectionId,
  sortOrder,
}: {
  sectionId: string;
  sortOrder: number;
}) {
  const t = useTranslations("boq");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      // The route handler injects `documentId` and `projectId` from the
      // parent section, so we only need the item-specific fields here.
      return apiPost<BoQItem>(`/api/sections/${sectionId}/items`, {
        sectionId,
        descriptionEn: "New item",
        quantity: "0",
        rate: "0",
        sortOrder,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      toast.success("Item added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="h-7 text-xs gap-1"
    >
      {mutation.isPending ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Plus className="w-3 h-3" />
      )}
      {t("addItem")}
    </Button>
  );
}

// ─── Create section button ─────────────────────────────────────────────────

function CreateSectionButton({
  documentId,
  sortOrder,
  variant = "outline",
}: {
  documentId: string;
  sortOrder: number;
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const t = useTranslations("boq");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      // The route handler resolves `projectId` from the parent document, so
      // we only need documentId (matched against the URL) + the
      // section-specific fields.
      return apiPost<BoQSection>(`/api/documents/${documentId}/sections`, {
        documentId,
        code: String(sortOrder + 1),
        titleEn: "New Section",
        sortOrder,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documents.detail(documentId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      toast.success("Section added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="gap-1"
    >
      {mutation.isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Plus className="w-3.5 h-3.5" />
      )}
      {t("addSection")}
    </Button>
  );
}

// ─── Grand total bar ───────────────────────────────────────────────────────

function GrandTotalBar({ totals }: { totals: DocumentTotals }) {
  const t = useTranslations("boq");
  const hasVat = totals.vatPercentage !== "" && totals.vatAmount !== "0.00";

  return (
    <div className="sticky bottom-0 left-0 right-0 -mx-8 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10">
      <div className="px-8 py-3 flex items-center justify-end gap-6 text-sm flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t("subtotal")}</span>
          <span className="font-mono">{formatNumber(totals.subtotal)}</span>
        </div>
        {hasVat && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              VAT ({totals.vatPercentage}%)
            </span>
            <span className="font-mono">{formatNumber(totals.vatAmount)}</span>
          </div>
        )}
        <div className="flex items-center gap-2 border-l border-border pl-6">
          <span className="text-muted-foreground font-medium">
            {t("grandTotal")}
          </span>
          <span className="font-mono font-semibold text-base">
            {formatNumber(totals.totalIncludingVat)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Format a decimal string with thousand separators on the integer part.
 * Pass-through if the value can't be split — the API returns decimal.js
 * `toFixed(2)` strings like "1067.50", so we always have a fractional part.
 */
function formatNumber(value: string | null | undefined): string {
  if (!value) return "0.00";
  const [whole, frac] = value.split(".");
  const formattedWhole = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${formattedWhole}.${frac}` : formattedWhole;
}
