"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Search, Library as LibraryIcon, Plus } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * LibraryView — S6: Library browser (search + categories + items table).
 *
 * WO-W-4f. Shows the 10 seeded library categories (CONCRETE, FORMWORK, REBAR,
 * MASONRY, PLASTER, PAINT, TILES, DOORS_WINDOWS, ELECTRICAL, PLUMBING) and the
 * 23 starter library items. Supports:
 *   - Debounced free-text search (300ms) over descriptionEn / descriptionAr / code.
 *   - Category filter via the sidebar (or "All categories" to clear).
 *   - Pagination (50 per page) with prev/next.
 *   - Bilingual display — descriptionAr rendered RTL via `dir="rtl"`.
 *   - "Insert into BoQ" stub: a row-level button that surfaces a toast
 *     "Select a BoQ item first" because the Library view has no project /
 *     document context. Real insertion will be implemented when the BoQ
 *     Builder (S4) gets a "browse library" picker modal in a later WO.
 *
 * Data is fetched client-side via TanStack Query. The query key uses the
 * hierarchical factory `queryKeys.library.search(params)` so that invalidation
 * can be scoped to library searches only (without touching categories).
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/stores/ui-store, @/hooks/use-toast,
 * and shadcn/ui. No server-only code.
 */

// ─── Types ────────────────────────────────────────────────────────────────

interface LibraryItem {
  id: string;
  code: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unitId: string | null;
  defaultSpecsEn: string | null;
  defaultSpecsAr: string | null;
  categoryId: string | null;
}

interface LibraryCategory {
  id: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
}

interface LibrarySearchResponse {
  data: LibraryItem[];
  total: number;
}

// ─── Component ────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

export function LibraryView() {
  const t = useTranslations("library");
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const { toast } = useToast();

  // Search input is locally controlled; the actual API query uses the
  // debounced value so we don't fire a request on every keystroke.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [page, setPage] = useState(0);

  // Debounce the search box (300ms). Also reset to page 0 whenever the
  // search term or category changes so the user doesn't land on an empty
  // page past the new result-set's last page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch the 10 seeded categories (CONCRETE..PLUMBING). This is a tiny,
  // stable result-set — default staleTime (30s) from the QueryClient is fine.
  const { data: categories, isLoading: categoriesLoading } = useQuery<LibraryCategory[]>({
    queryKey: queryKeys.library.categories,
    queryFn: () => fetchJson("/api/library/categories"),
  });

  // Build the query params for the items endpoint. Undefined fields are
  // omitted from the URL (the schema treats them as optional).
  const params: {
    search?: string;
    categoryId?: string;
    limit: number;
    offset: number;
  } = {
    search: debouncedSearch || undefined,
    categoryId: selectedCategoryId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data: itemsResp, isLoading: itemsLoading } = useQuery<LibrarySearchResponse>({
    queryKey: queryKeys.library.search(params),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.search) sp.set("search", params.search);
      if (params.categoryId) sp.set("categoryId", params.categoryId);
      sp.set("limit", String(params.limit));
      sp.set("offset", String(params.offset));
      return fetchJson(`/api/library?${sp.toString()}`);
    },
    placeholderData: (prev) => prev, // keep previous page visible while fetching the next
  });

  const items = itemsResp?.data ?? [];
  const total = itemsResp?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // "Insert into BoQ" stub: requires a project + document context which the
  // Library view doesn't have. Surface a toast explaining the limitation.
  // The real flow will be a "browse library" picker modal launched from the
  // BoQ Builder (S4) once that screen lands in a later WO.
  const handleInsertIntoBoq = () => {
    toast({
      title: t("insertIntoBoq"),
      description: "Select a BoQ item first — open a project document, then use the “Add from library” picker in the BoQ Builder.",
    });
  };

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header + search */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} {total === 1 ? "item" : "items"}
            {selectedCategoryId
              ? ` · ${categories?.find((c) => c.id === selectedCategoryId)?.nameEn ?? ""}`
              : ""}
          </p>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder={t("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            aria-label={t("search")}
          />
        </div>
      </div>

      <div className="flex gap-6">
        {/* Category sidebar */}
        <aside className="w-48 shrink-0 space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground px-2 pb-1.5 flex items-center gap-1.5">
            <LibraryIcon className="w-3.5 h-3.5" />
            <span>{t("categories")}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedCategoryId(undefined);
              setPage(0);
            }}
            className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
              !selectedCategoryId
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            All categories
          </button>
          {categoriesLoading && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
          )}
          {categories?.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setSelectedCategoryId(cat.id);
                setPage(0);
              }}
              className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                selectedCategoryId === cat.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <div className="truncate">{cat.nameEn}</div>
              {cat.nameAr && (
                <div className="text-xs text-muted-foreground/80 truncate" dir="rtl">
                  {cat.nameAr}
                </div>
              )}
            </button>
          ))}
        </aside>

        {/* Items table */}
        <div className="flex-1 space-y-3 min-w-0">
          {itemsLoading && items.length === 0 ? (
            <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-border border-dashed p-12 text-center">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
                <Search className="w-5 h-5 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-medium">No items found</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Try a different search term or clear the category filter.
              </p>
              {(search || selectedCategoryId) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setDebouncedSearch("");
                    setSelectedCategoryId(undefined);
                    setPage(0);
                  }}
                  className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-xs font-medium hover:bg-secondary/80 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left">
                      <th className="px-4 py-2 font-medium text-muted-foreground w-28">
                        Code
                      </th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">
                        Description (EN)
                      </th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">
                        Description (AR)
                      </th>
                      <th className="px-4 py-2 font-medium text-muted-foreground w-20">
                        Unit
                      </th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">
                        Specs
                      </th>
                      <th className="px-4 py-2 font-medium text-muted-foreground w-28 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {item.code ?? "—"}
                        </td>
                        <td className="px-4 py-3">{item.descriptionEn}</td>
                        <td
                          className="px-4 py-3 text-muted-foreground"
                          dir="rtl"
                          lang="ar"
                        >
                          {item.descriptionAr ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {item.unitId ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {item.defaultSpecsEn ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleInsertIntoBoq}
                            className="h-7 text-xs gap-1"
                            aria-label={t("insertIntoBoq")}
                          >
                            <Plus className="w-3 h-3" />
                            {t("insertIntoBoq")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {total} items · page {page + 1} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Quick link to BoQ Builder — surfaces the path the user needs to
              take to actually insert a library item. */}
          <div className="text-xs text-muted-foreground pt-2">
            Need to add an item to a BoQ?{" "}
            <button
              type="button"
              onClick={() => setCurrentView("boq")}
              className="text-foreground underline-offset-4 hover:underline"
            >
              Open the BoQ Builder →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
