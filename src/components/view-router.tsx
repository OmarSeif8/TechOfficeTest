"use client";

import { useUIStore } from "@/lib/stores/ui-store";
import { DashboardView } from "@/components/views/dashboard-view";
import { ProjectsView } from "@/components/views/projects-view";
import { LibraryView } from "@/components/views/library-view";
import { SettingsView } from "@/components/views/settings-view";
import { BoQEditorView } from "@/components/views/boq-editor-view";
import { CalculatorsView } from "@/components/views/calculators-view";
import { ImportView } from "@/components/views/import-view";
import { ExportView } from "@/components/views/export-view";
import { SchedulingView } from "@/components/views/scheduling-view";
import { WbsView } from "@/components/views/wbs-view";
import { ActivitiesView } from "@/components/views/activities-view";
import { CalendarView } from "@/components/views/calendar-view";
import { GanttView } from "@/components/views/gantt-view";
import { DrawingsView } from "@/components/views/drawings-view";
import { SubmittalsView } from "@/components/views/submittals-view";
import { RfisView } from "@/components/views/rfis-view";
import { CorrespondenceView } from "@/components/views/correspondence-view";
import { DocumentsDashboardView } from "@/components/views/documents-dashboard-view";
import { DxfViewerView } from "@/components/views/dxf-viewer-view";
import { PaymentsView } from "@/components/views/payments-view";
import { VariationsView } from "@/components/views/variations-view";
import { CostLoadingView } from "@/components/views/cost-loading-view";
import { ProgressUpdateView } from "@/components/views/progress-update-view";
import { ProjectDashboardView } from "@/components/views/project-dashboard-view";
import { DailyReportView } from "@/components/views/daily-report-view";
import { MonthlyReportView } from "@/components/views/monthly-report-view";
import { SubscriptionView } from "@/components/views/subscription-view";

/**
 * ClientViewRouter — renders the active view based on Zustand `currentView`.
 *
 * Per environment constraint: only the / route exists. All screens are
 * rendered within this single-page app via view switching.
 *
 * The sidebar's `setCurrentView()` controls which view is shown.
 *
 * Each view is a Client Component that fetches its own data via TanStack Query.
 * Views are lazy-imported in a future optimization — for Phase 1/2 they're
 * directly imported (simpler, and Next.js's turbopack handles code splitting).
 *
 * Phase 2 Group M: added 5 scheduling views (scheduling, wbs, activities,
 * calendar, gantt) per SPEC_PHASE2_WEB.md §6 (S11–S15).
 *
 * Phase 3A Group Q: added 5 document-control views (drawings, submittals,
 * rfis, correspondence, documents-dashboard) per SPEC_PHASE3_WEB.md §6
 * (S17–S21).
 */
export function ClientViewRouter() {
  const currentView = useUIStore((s) => s.currentView);

  switch (currentView) {
    case "dashboard":
      return <DashboardView />;
    case "projects":
      return <ProjectsView />;
    case "boq":
      return <BoQEditorView />;
    case "calculators":
      return <CalculatorsView />;
    case "library":
      return <LibraryView />;
    case "import":
      return <ImportView />;
    case "export":
      return <ExportView />;
    case "settings":
      return <SettingsView />;
    // ─── Phase 2 — Scheduling (CPM engine) views ────────────────────────────
    case "scheduling":
      return <SchedulingView />;
    case "wbs":
      return <WbsView />;
    case "activities":
      return <ActivitiesView />;
    case "calendar":
      return <CalendarView />;
    case "gantt":
      return <GanttView />;
    // ─── Phase 3A — Document Control views ──────────────────────────────────
    case "drawings":
      return <DrawingsView />;
    case "submittals":
      return <SubmittalsView />;
    case "rfis":
      return <RfisView />;
    case "correspondence":
      return <CorrespondenceView />;
    case "documents-dashboard":
      return <DocumentsDashboardView />;
    // ─── Phase 3B — Drawing Viewer (DXF SVG) ────────────────────────────────
    case "dxf-viewer":
      return <DxfViewerView />;
    // ─── Phase 4 — Financials (Groups U+V+W) ───────────────────────────────
    case "payments":
      return <PaymentsView />;
    case "variations":
      return <VariationsView />;
    case "cost-loading":
      return <CostLoadingView />;
    case "progress-update":
      return <ProgressUpdateView />;
    case "project-dashboard":
      return <ProjectDashboardView />;
    case "daily-report":
      return <DailyReportView />;
    case "monthly-report":
      return <MonthlyReportView />;
    case "subscription":
      return <SubscriptionView />;
    default:
      return <DashboardView />;
  }
}
