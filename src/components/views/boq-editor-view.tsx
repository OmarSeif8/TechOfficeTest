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

  // Section subtotal = Σ of rounded item amounts (per BR-3). We sum the
  // server-computed `amount` strings — the BoQItem entity exposes this field
  // pre-computed by the repository on read.
  const sectionSubtotal = useMemo(() => {
    return items
      .reduce((sum, i) => sum + Number(i.amount || "0"), 0)
      .toFixed(2);
  }, [items]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Section header (click to expand/collapse) */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {section.code}
          </span>
          <span className="font-medium truncate">
            {section.titleEn || "(untitled)"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          <span>
            {items.length} {t("item").toLowerCase()}
            {items.length === 1 ? "" : "s"}
          </span>
          <span className="font-mono">{formatNumber(sectionSubtotal)}</span>
        </div>
      </button>

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
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
        {item.code ?? "—"}
      </td>
      <td className="px-4 py-2">{item.descriptionEn}</td>
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
        {item.unitId ?? "—"}
      </td>
      <td className="px-4 py-2 text-right">
        <InlineEdit
          itemId={item.id}
          field="quantity"
          value={item.quantity}
          version={item.version}
        />
      </td>
      <td className="px-4 py-2 text-right">
        <InlineEdit
          itemId={item.id}
          field="rate"
          value={item.rate}
          version={item.version}
        />
      </td>
      <td className="px-4 py-2 text-right font-mono">
        {formatNumber(item.amount)}
      </td>
      <td className="px-4 py-2 text-right">
        <DeleteItemButton itemId={item.id} version={item.version} />
      </td>
    </tr>
  );
}

// ─── Inline edit (Qty / Rate) ──────────────────────────────────────────────

/**
 * Click-to-edit cell. On commit (blur or Enter), PATCHes `/api/items/[id]`
 * with `{ [field]: value, expectedVersion }`. On success, splices the
 * returned `{ item, totals }` into the document detail cache so the totals
 * bar updates without a refetch (live totals — F3 requirement).
 *
 * Optimistic concurrency: `expectedVersion` is the item's current `version`
 * field. If the server returns 409 Conflict (concurrent edit), the mutation
 * errors out, we revert the draft to the cached server value, and surface a
 * toast.
 */
function InlineEdit({
  itemId,
  field,
  value,
  version,
}: {
  itemId: string;
  field: "quantity" | "rate";
  value: string;
  version: number;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  // The draft is initialized from the server value at the moment the user
  // enters edit mode (in `startEditing`, an event handler — not in an
  // effect). This avoids the set-state-in-effect anti-pattern: the displayed
  // value when *not* editing is just `value` (read directly from props).
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select-all on entering edit mode for fast overwrite. This effect
  // touches the DOM (input.focus), not React state — allowed.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    // Sync the draft to the freshest server value at click-time so any
    // updates that arrived since the last render are reflected.
    setDraft(value);
    setEditing(true);
  };

  const mutation = useMutation({
    mutationFn: async (vars: { value: string; expectedVersion: number }) => {
      const body: Record<string, unknown> = {
        expectedVersion: vars.expectedVersion,
      };
      body[field] = vars.value;
      return apiPatch<PatchItemResponse>(`/api/items/${itemId}`, body);
    },
    onMutate: () => setSaving(true),
    onSuccess: (data) => {
      // Splice the updated item + new totals into the document detail cache.
      // This avoids a refetch — the totals bar updates instantly (F3 live
      // totals requirement).
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
    // Basic numeric validation. The server-side zod schema accepts decimal
    // strings; we reject empty / non-numeric input before the round-trip.
    if (draft.trim() === "" || Number.isNaN(Number(draft))) {
      toast.error("Please enter a valid number");
      setDraft(value);
      setEditing(false);
      return;
    }
    mutation.mutate({ value: draft, expectedVersion: version });
  };

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
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
          className="h-7 w-24 text-right font-mono text-xs"
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
      className="font-mono text-xs hover:bg-accent hover:text-accent-foreground rounded px-2 py-1 -my-1 transition-colors w-full text-right inline-flex items-center justify-end gap-1"
      title="Click to edit"
    >
      <span>{formatNumber(value)}</span>
      {saving && (
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
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
