"use client";

/**
 * DocumentsDashboardView (S21) — Documents dashboard with widget cards.
 *
 * Per SPEC_PHASE3_WEB.md §6 (S21): widget cards linking to filtered lists.
 *
 * Data:
 *   - GET /api/projects/[projectId]/documents-dashboard → aggregate stats
 *
 * Widgets:
 *   - Drawings by Status (count per status, PRELIMINARY..OBSOLETE)
 *   - Submittals Overdue (count)
 *   - RFIs Open (count)
 *   - Latest Correspondence (top 5 by date desc)
 *
 * Each card clickable → switches to the relevant filtered list view via
 * `setCurrentView`. The lists are not pre-filtered (they show all entries);
 * a future improvement would pass a filter hint through the UI store.
 *
 * Per BR-DC1: `asOf` defaults to today's UTC date (the API route handles the
 * default — we don't need to send it unless the user wants a custom date).
 *
 * Empty state: if no project selected → "Go to Projects" CTA.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/stores, shadcn/ui. No
 * server-only code.
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  LayoutGrid,
  FileText,
  AlertTriangle,
  HelpCircle,
  Mail,
  ArrowRight,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import type {
  CorrespondenceDirection,
  CorrespondenceType,
  DrawingStatus,
} from "@shared/entities";

// ─── Types ────────────────────────────────────────────────────────────────

interface DrawingsByStatus {
  PRELIMINARY: number;
  ISSUED: number;
  APPROVED_FOR_CONSTRUCTION: number;
  SUPERSEDED: number;
  OBSOLETE: number;
  NO_REVISION: number;
  // Allow string indexing in case the server adds more keys later.
  [key: string]: number;
}

interface LatestCorrespondenceItem {
  id: string;
  ref: string;
  direction: CorrespondenceDirection;
  type: CorrespondenceType;
  date: string;
  subjectEn: string;
  fromParty: string;
  toParty: string;
}

interface DashboardResponse {
  asOf: string;
  drawings: {
    total: number;
    byStatus: DrawingsByStatus;
  };
  submittals: {
    total: number;
    open: number;
    overdue: number;
  };
  rfis: {
    total: number;
    open: number;
    overdue: number;
  };
  correspondence: {
    total: number;
    latest: LatestCorrespondenceItem[];
  };
}

// ─── Component ────────────────────────────────────────────────────────────

export function DocumentsDashboardView() {
  const t = useTranslations("documentsDashboard");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: currentProjectId
      ? queryKeys.documentsDashboard.detail(currentProjectId)
      : ["documents-dashboard", "_disabled"],
    queryFn: () =>
      fetchJson<DashboardResponse>(
        `/api/projects/${currentProjectId}/documents-dashboard`,
      ),
    enabled: !!currentProjectId,
  });

  // ─── Empty state: no project selected ──────────────────────────────────
  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <LayoutGrid className="w-5 h-5 text-muted-foreground" />
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

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("asOf")} {data?.asOf ?? "—"}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : !data ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          —
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Drawings by status */}
          <DashboardCard
            title={t("drawingsByStatus")}
            icon={<FileText className="w-4 h-4" />}
            onClick={() => setCurrentView("drawings")}
            footer={`${data.drawings.total} total`}
          >
            <ul className="space-y-1.5 text-sm">
              {(
                [
                  "PRELIMINARY",
                  "ISSUED",
                  "APPROVED_FOR_CONSTRUCTION",
                  "SUPERSEDED",
                  "OBSOLETE",
                  "NO_REVISION",
                ] as const
              ).map((s) => (
                <li
                  key={s}
                  className="flex items-center justify-between font-mono text-xs"
                >
                  <span className="flex items-center gap-2">
                    <DrawingStatusDot status={s as DrawingStatus | "NO_REVISION"} />
                    {s === "NO_REVISION" ? "no revision" : humanDrawingStatus(s as DrawingStatus)}
                  </span>
                  <span className="font-semibold">{data.drawings.byStatus[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          </DashboardCard>

          {/* Submittals overdue */}
          <DashboardCard
            title={t("submittalsOverdue")}
            icon={<AlertTriangle className="w-4 h-4" />}
            onClick={() => setCurrentView("submittals")}
            footer={`${data.submittals.open} open · ${data.submittals.total} total`}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold font-mono">
                {data.submittals.overdue}
              </span>
              <span className="text-sm text-muted-foreground">
                overdue
              </span>
            </div>
          </DashboardCard>

          {/* RFIs open */}
          <DashboardCard
            title={t("rfisOpen")}
            icon={<HelpCircle className="w-4 h-4" />}
            onClick={() => setCurrentView("rfis")}
            footer={`${data.rfis.overdue} overdue · ${data.rfis.total} total`}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold font-mono">
                {data.rfis.open}
              </span>
              <span className="text-sm text-muted-foreground">
                open
              </span>
            </div>
          </DashboardCard>

          {/* Latest correspondence */}
          <DashboardCard
            title={t("latestCorrespondence")}
            icon={<Mail className="w-4 h-4" />}
            onClick={() => setCurrentView("correspondence")}
            footer={`${data.correspondence.total} total`}
          >
            {data.correspondence.latest.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("noLatest")}
              </p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {data.correspondence.latest.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    <span className="font-mono text-muted-foreground shrink-0">
                      {c.ref}
                    </span>
                    <span className="font-mono text-muted-foreground shrink-0">
                      {c.date}
                    </span>
                    <span className="truncate">{c.subjectEn}</span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function DashboardCard({
  title,
  icon,
  children,
  onClick,
  footer,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  footer?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg border border-border p-4 bg-card hover:bg-muted/30 transition-colors group"
    >
      <div className="flex items-center justify-between text-muted-foreground mb-3">
        <span className="flex items-center gap-2 text-xs uppercase tracking-wide font-semibold">
          {icon}
          {title}
        </span>
        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      {children}
      {footer && (
        <div className="text-[11px] text-muted-foreground mt-3 font-mono">
          {footer}
        </div>
      )}
    </button>
  );
}

function DrawingStatusDot({
  status,
}: {
  status: DrawingStatus | "NO_REVISION";
}) {
  const color: Record<DrawingStatus | "NO_REVISION", string> = {
    PRELIMINARY: "bg-[rgb(251,146,60)]",
    ISSUED: "bg-[rgb(96,165,250)]",
    APPROVED_FOR_CONSTRUCTION: "bg-[rgb(74,222,128)]",
    SUPERSEDED: "bg-muted-foreground/60",
    OBSOLETE: "bg-[rgb(248,113,113)]",
    NO_REVISION: "bg-muted-foreground/30",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color[status]}`}
    />
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function humanDrawingStatus(s: DrawingStatus): string {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
