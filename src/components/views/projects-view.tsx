"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, useRef, type FormEvent } from "react";
import { Plus, Search, ArrowUpRight, FileText } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { toast } from "sonner";
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

/**
 * ProjectsView (S3 list) — WO-W-4b.
 *
 * Shows the full project list (not the dashboard's 20-row recent slice) with
 * live totals (pre-computed server-side by computeDocumentTotals), a search
 * bar (query param `?search=...` on GET /api/projects), and a "New project"
 * modal that POSTs to /api/projects and switches to the BoQ editor on success.
 *
 * Pattern follows dashboard-view (TanStack Query + i18n + Linear dark theme).
 *
 * The list query is keyed with the search string so changing the search input
 * (debounced via a 300ms setTimeout in handleSearchChange) refetches with the
 * new `?search=...` value.
 */

// ─── Types ────────────────────────────────────────────────────────────────

interface ProjectListItem {
  id: string;
  nameEn: string;
  nameAr: string | null;
  clientEn: string | null;
  clientAr: string | null;
  currency: string;
  documentCount: number;
  itemCount: number;
  grandTotal: string;
  updatedAt: string;
}

interface ProjectsResponse {
  data: ProjectListItem[];
  total: number;
}

/** Shape returned by POST /api/projects (the created project row). */
interface ProjectCreated {
  id: string;
  nameEn: string;
  nameAr: string | null;
  clientEn: string | null;
  clientAr: string | null;
  locationEn: string | null;
  locationAr: string | null;
  contractNo: string | null;
  currency: string;
  version: number;
}

interface CreateFormState {
  nameEn: string;
  nameAr: string;
  clientEn: string;
  clientAr: string;
  locationEn: string;
  locationAr: string;
  contractNo: string;
  currency: string;
}

const INITIAL_FORM: CreateFormState = {
  nameEn: "",
  nameAr: "",
  clientEn: "",
  clientAr: "",
  locationEn: "",
  locationAr: "",
  contractNo: "",
  currency: "USD",
};

// Common ISO-4217-style currency codes for the dropdown. Kept short — Phase 1
// doesn't validate against an ISO list (per ProjectCreateSchema), this is just
// a UX convenience. The user can also type a custom value via the select's
// editable behaviour (the underlying <Input> falls back if no match).
const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "SAR", "AED", "EGP", "JOD"];

// ─── Component ────────────────────────────────────────────────────────────

export function ProjectsView() {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const setCurrentProject = useUIStore((s) => s.setCurrentProject);

  const qc = useQueryClient();

  // Search state — `searchInput` is the live input value; `searchQuery` is
  // the debounced value that's actually sent to the API. This avoids
  // refetching on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Ref to hold the debounce timer so we can clear it on each keystroke.
  // `ReturnType<typeof setTimeout>` is `number` in browsers (and `NodeJS.Timeout`
  // in Node — but this is a client component so it's always `number`).
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Projects list query — keyed with searchQuery so changing the debounced
  // search value triggers a refetch. We pass `limit: 100` so the full list is
  // returned (the spec says "full list, not limited to 20" — 100 is the API's
  // max per ProjectListQuerySchema).
  const { data: projectsResp, isLoading } = useQuery<ProjectsResponse>({
    queryKey: queryKeys.projects.list({
      search: searchQuery || undefined,
      limit: 100,
    }),
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("limit", "100");
      if (searchQuery) qs.set("search", searchQuery);
      const suffix = qs.toString();
      return fetchJson<ProjectsResponse>(
        suffix ? `/api/projects?${suffix}` : "/api/projects",
      );
    },
  });

  const projects = projectsResp?.data ?? [];
  const total = projectsResp?.total ?? 0;

  // Debounced search handler. 300ms is the standard UX default for
  // search-as-you-type.
  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchQuery(value.trim());
    }, 300);
  }

  function openCreate() {
    setForm(INITIAL_FORM);
    setSubmitError(null);
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setSubmitError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    // Validate nameEn client-side (the schema enforces min(1) server-side,
    // but we surface the error inline for better UX).
    if (!form.nameEn.trim()) {
      setSubmitError(tCommon("error") + ": nameEn is required");
      return;
    }

    // Build the POST body. Optional fields are sent as undefined (the
    // schema strips undefined keys, so they're omitted from the JSON body).
    const body: Record<string, string> = {
      nameEn: form.nameEn.trim(),
      currency: form.currency.trim() || "USD",
    };
    if (form.nameAr.trim()) body.nameAr = form.nameAr.trim();
    if (form.clientEn.trim()) body.clientEn = form.clientEn.trim();
    if (form.clientAr.trim()) body.clientAr = form.clientAr.trim();
    if (form.locationEn.trim()) body.locationEn = form.locationEn.trim();
    if (form.locationAr.trim()) body.locationAr = form.locationAr.trim();
    if (form.contractNo.trim()) body.contractNo = form.contractNo.trim();

    try {
      const created = await apiPost<ProjectCreated>("/api/projects", body);

      // Invalidate the projects query (and all sub-keys — list + any
      // detail queries) so the new project shows up in the list cache.
      await qc.invalidateQueries({ queryKey: queryKeys.projects.all });

      toast.success(`Project created: ${created.nameEn}`);

      // Reset + close modal.
      setForm(INITIAL_FORM);
      setCreateOpen(false);

      // Switch to the BoQ editor for the new project (per spec).
      setCurrentProject(created.id);
      setCurrentView("boq");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      setSubmitError(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total > 0
              ? `${total} ${total === 1 ? "project" : "projects"}`
              : "Create a new project to start building a Bill of Quantities."}
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-3.5 h-3.5" />
          {t("create")}
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={tCommon("search")}
          className="pl-9"
          aria-label={tCommon("search")}
        />
      </div>

      {/* Projects table or empty state */}
      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tCommon("loading")}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          title={t("create")}
          description="No projects match your search. Create a new project to get started."
          cta={t("create")}
          onCreate={openCreate}
          isFiltered={searchQuery.length > 0}
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground">
                  {t("table.project")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground">
                  {t("table.client")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                  {t("table.documents")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                  {t("table.items")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                  {t("table.total")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground">
                  {t("table.updated")}
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => {
                    setCurrentProject(p.id);
                    setCurrentView("boq");
                  }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.nameEn}</div>
                    {p.nameAr && (
                      <div className="text-xs text-muted-foreground" dir="rtl">
                        {p.nameAr}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.clientEn ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {p.documentCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {p.itemCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span className="text-muted-foreground text-xs mr-1">
                      {p.currency}
                    </span>
                    <span className="font-medium">
                      {formatNumber(p.grandTotal)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatRelativeTime(p.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create project modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t("create")}</DialogTitle>
            <DialogDescription>
              Create a new project to start building a Bill of Quantities.
              Only the English name is required — fill in the rest as needed.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* nameEn + nameAr */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nameEn">{t("form.nameEn")}</Label>
                <Input
                  id="nameEn"
                  value={form.nameEn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nameEn: e.target.value }))
                  }
                  required
                  autoFocus
                  placeholder="e.g. Tower A — Foundations"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nameAr">{t("form.nameAr")}</Label>
                <Input
                  id="nameAr"
                  value={form.nameAr}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nameAr: e.target.value }))
                  }
                  dir="rtl"
                  placeholder="برج أ — الأساسات"
                />
              </div>
            </div>

            {/* clientEn + clientAr */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="clientEn">{t("form.clientEn")}</Label>
                <Input
                  id="clientEn"
                  value={form.clientEn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, clientEn: e.target.value }))
                  }
                  placeholder="e.g. Ministry of Works"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clientAr">{t("form.clientAr")}</Label>
                <Input
                  id="clientAr"
                  value={form.clientAr}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, clientAr: e.target.value }))
                  }
                  dir="rtl"
                  placeholder="وزارة الأشغال"
                />
              </div>
            </div>

            {/* locationEn + locationAr — share the single `form.location` i18n
                key (see deviations: spec only declares one `location` key, but
                the schema has both locationEn and locationAr). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="locationEn">
                  {t("form.location")} (EN)
                </Label>
                <Input
                  id="locationEn"
                  value={form.locationEn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, locationEn: e.target.value }))
                  }
                  placeholder="e.g. Riyadh, KSA"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="locationAr">
                  {t("form.location")} (AR)
                </Label>
                <Input
                  id="locationAr"
                  value={form.locationAr}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, locationAr: e.target.value }))
                  }
                  dir="rtl"
                  placeholder="الرياض، المملكة العربية السعودية"
                />
              </div>
            </div>

            {/* contractNo + currency */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="contractNo">{t("form.contractNo")}</Label>
                <Input
                  id="contractNo"
                  value={form.contractNo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contractNo: e.target.value }))
                  }
                  placeholder="e.g. MW-2025-0142"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">{t("form.currency")}</Label>
                <select
                  id="currency"
                  value={form.currency}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, currency: e.target.value }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30"
                >
                  {COMMON_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {/* If the current currency isn't in the common list (e.g.
                      user typed it before), show it as an extra option. */}
                  {!COMMON_CURRENCIES.includes(form.currency) &&
                    form.currency && (
                      <option value={form.currency}>{form.currency}</option>
                    )}
                </select>
              </div>
            </div>

            {submitError && (
              <p className="text-sm text-destructive">{submitError}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={closeCreate}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit">{tCommon("create")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState({
  title,
  description,
  cta,
  onCreate,
  isFiltered,
}: {
  title: string;
  description: string;
  cta: string;
  onCreate: () => void;
  isFiltered: boolean;
}) {
  return (
    <div className="rounded-lg border border-border border-dashed p-12 text-center">
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
        {isFiltered ? (
          <Search className="w-5 h-5 text-muted-foreground" />
        ) : (
          <FileText className="w-5 h-5 text-muted-foreground" />
        )}
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
        {description}
      </p>
      <Button
        type="button"
        onClick={onCreate}
        size="sm"
        className="mt-4"
      >
        <Plus className="w-3.5 h-3.5" />
        {cta}
      </Button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatNumber(value: string): string {
  if (!value) return "0";
  const [whole, frac] = value.split(".");
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${formattedWhole}.${frac}` : formattedWhole;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}
