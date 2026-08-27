"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Plus,
  Files,
  Library,
  CircleDot,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";

/**
 * DashboardView — the home dashboard (S2).
 *
 * Shows: stats cards, recent projects table with live totals, build status.
 *
 * Data fetched client-side via TanStack Query (staleTime 30s per WO-W-15).
 * The project totals are computed server-side by the API (the /api/projects
 * endpoint returns pre-computed grandTotal via the pure domain function
 * computeDocumentTotals — proof: domain code runs in the Next.js server
 * without modification).
 */

interface ProjectListItem {
  id: string;
  nameEn: string;
  nameAr: string | null;
  clientEn: string | null;
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

export function DashboardView() {
  const t = useTranslations("dashboard");
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const setCurrentProject = useUIStore((s) => s.setCurrentProject);

  const { data: projectsResp, isLoading: projectsLoading } =
    useQuery<ProjectsResponse>({
      queryKey: queryKeys.projects.list(),
      queryFn: () => fetchJson("/api/projects"),
    });

  const { data: libraryCount } = useQuery<number>({
    queryKey: ["stats", "library-count"],
    queryFn: async () => {
      const resp = await fetchJson<{ total: number }>("/api/library?limit=1");
      return resp.total ?? 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  const projects = projectsResp?.data ?? [];
  const projectCount = projectsResp?.total ?? 0;

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-8">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCurrentView("projects")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-[var(--linear-primary-hover)] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("empty.cta")}
        </button>
      </div>

      {/* Stats row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard
          label={t("stats.projects")}
          value={String(projectCount)}
          hint="Active projects"
          icon={<Files className="w-4 h-4" />}
        />
        <StatCard
          label={t("stats.library")}
          value={String(libraryCount ?? "—")}
          hint="Starter catalog items"
          icon={<Library className="w-4 h-4" />}
        />
        <StatCard
          label={t("stats.referenceData")}
          value="9·13"
          hint="Units · Rebar diameters"
          icon={<CircleDot className="w-4 h-4" />}
        />
      </section>

      {/* Recent projects */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            {t("recentProjects")}
          </h2>
          {projectCount === 0 && !projectsLoading && (
            <span className="text-xs text-muted-foreground">
              No projects yet — create one to start
            </span>
          )}
        </div>

        {projectsLoading ? (
          <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
            Loading projects...
          </div>
        ) : projectCount === 0 ? (
          <EmptyState
            title={t("empty.title")}
            description={t("empty.description")}
            cta={t("empty.cta")}
            onCreate={() => setCurrentView("projects")}
          />
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-4 py-2 font-medium text-muted-foreground">
                    Project
                  </th>
                  <th className="px-4 py-2 font-medium text-muted-foreground">
                    Client
                  </th>
                  <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                    Documents
                  </th>
                  <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                    Items
                  </th>
                  <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                    Grand total
                  </th>
                  <th className="px-4 py-2 font-medium text-muted-foreground">
                    Updated
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
                        <div
                          className="text-xs text-muted-foreground"
                          dir="rtl"
                        >
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
      </section>

      {/* Build status */}
      <section className="rounded-lg border border-border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            Phase 1 build status
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Following the Constitution v1.1 (Web Adaptation). Golden tests are law.
        </p>
        <BuildStatusList />
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-4 bg-card">
      <div className="flex items-center justify-between text-muted-foreground mb-2">
        <span className="text-xs uppercase tracking-wide font-medium">
          {label}
        </span>
        <span>{icon}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight font-mono">
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  cta,
  onCreate,
}: {
  title: string;
  description: string;
  cta: string;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-lg border border-border border-dashed p-12 text-center">
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
        <Plus className="w-5 h-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
        {description}
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-[var(--linear-primary-hover)] transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        {cta}
      </button>
    </div>
  );
}

function BuildStatusList() {
  const items = [
    { name: "WO-W-0: Scaffold + layer purity rules", status: "done" },
    { name: "WO-W-1: Prisma schema (41 models)", status: "done" },
    { name: "WO-W-2: Seed data (units, rebar, library)", status: "done" },
    { name: "WO-W-3..5: Domain core + golden tests (GT-1..8)", status: "done" },
    { name: "WO-W-6..8: AI provider, auth, registry", status: "done" },
    { name: "WO-W-9..12: API routes (32 routes)", status: "done" },
    { name: "WO-W-13..15: UI infrastructure (i18n, layout, state)", status: "done" },
    { name: "WO-W-16..18: Screens S2-S10 + hardening", status: "in progress" },
  ];
  return (
    <ul className="space-y-1.5 text-xs">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-2 font-mono">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              item.status === "done"
                ? "bg-[var(--linear-success)]"
                : "bg-[var(--linear-warning)]"
            }`}
          />
          <span className="flex-1">{item.name}</span>
          <span className="text-muted-foreground">{item.status}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatNumber(value: string): string {
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
