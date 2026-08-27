"use client";

import {
  LayoutDashboard,
  Files,
  FileText,
  Calculator,
  Library,
  Upload,
  Download,
  Settings,
  CalendarDays,
  ListTree,
  ListChecks,
  Calendar,
  BarChart3,
  Send,
  HelpCircle,
  Mail,
  LayoutGrid,
  Maximize2,
  Receipt,
  FileEdit,
  Link2,
  TrendingUp,
  Gauge,
  ClipboardList,
  FileBarChart,
  CreditCard,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useUIStore, type ViewName } from "@/lib/stores/ui-store";

/**
 * AppSidebar — Linear-styled sidebar navigation.
 *
 * Per CONSTITUTION_V1.1_WEB Amendment #6 (Linear design language):
 *   - Dark surface-1 background
 *   - Hairline border
 *   - Active item: muted background, no decorative color
 *   - Inactive items: muted-foreground, hover to foreground
 *   - No icons in primary accent (lavender reserved for brand mark + CTAs only)
 *
 * SPA view-switching: per environment constraint, only the / route exists.
 * Nav items switch the active view via Zustand (no URL routing).
 *
 * Phase 2 Group M: added 5 scheduling views grouped under a "Scheduling"
 * section header (scheduling dashboard, WBS, activities, calendar editor,
 * Gantt chart) per SPEC_PHASE2_WEB.md §6.
 *
 * Phase 3A Group Q: added 5 document-control views grouped under a
 * "Documents" section header (drawings, submittals, RFIs, correspondence,
 * documents dashboard) per SPEC_PHASE3_WEB.md §6 (S17–S21).
 */

interface NavItem {
  view: ViewName;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
}

interface NavGroup {
  /** Section header i18n key under `nav`. When omitted, items render flat. */
  groupKey?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { view: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, enabled: true },
      { view: "projects", labelKey: "nav.projects", icon: Files, enabled: true },
      { view: "boq", labelKey: "nav.boq", icon: FileText, enabled: true },
      { view: "calculators", labelKey: "nav.calculators", icon: Calculator, enabled: true },
      { view: "library", labelKey: "nav.library", icon: Library, enabled: true },
      { view: "import", labelKey: "nav.import", icon: Upload, enabled: true },
      { view: "export", labelKey: "nav.export", icon: Download, enabled: true },
      { view: "settings", labelKey: "nav.settings", icon: Settings, enabled: true },
      { view: "subscription", labelKey: "nav.subscription", icon: CreditCard, enabled: true },
    ],
  },
  {
    groupKey: "nav.scheduling",
    items: [
      { view: "scheduling", labelKey: "nav.scheduling", icon: CalendarDays, enabled: true },
      { view: "wbs", labelKey: "nav.wbs", icon: ListTree, enabled: true },
      { view: "activities", labelKey: "nav.activities", icon: ListChecks, enabled: true },
      { view: "calendar", labelKey: "nav.calendar", icon: Calendar, enabled: true },
      { view: "gantt", labelKey: "nav.gantt", icon: BarChart3, enabled: true },
    ],
  },
  {
    groupKey: "nav.documents",
    items: [
      { view: "drawings", labelKey: "nav.drawings", icon: FileText, enabled: true },
      { view: "submittals", labelKey: "nav.submittals", icon: Send, enabled: true },
      { view: "rfis", labelKey: "nav.rfis", icon: HelpCircle, enabled: true },
      { view: "correspondence", labelKey: "nav.correspondence", icon: Mail, enabled: true },
      { view: "documents-dashboard", labelKey: "nav.documentsDashboard", icon: LayoutGrid, enabled: true },
      // Phase 3B Group S — DXF viewer (server-parsed → client SVG)
      { view: "dxf-viewer", labelKey: "nav.dxfViewer", icon: Maximize2, enabled: true },
    ],
  },
  {
    groupKey: "nav.financials",
    items: [
      { view: "payments", labelKey: "nav.payments", icon: Receipt, enabled: true },
      { view: "variations", labelKey: "nav.variations", icon: FileEdit, enabled: true },
      { view: "cost-loading", labelKey: "nav.costLoading", icon: Link2, enabled: true },
      { view: "progress-update", labelKey: "nav.progressUpdate", icon: TrendingUp, enabled: true },
      { view: "project-dashboard", labelKey: "nav.projectDashboard", icon: Gauge, enabled: true },
      { view: "daily-report", labelKey: "nav.dailyReport", icon: ClipboardList, enabled: true },
      { view: "monthly-report", labelKey: "nav.monthlyReport", icon: FileBarChart, enabled: true },
    ],
  },
];

export function AppSidebar() {
  const currentView = useUIStore((s) => s.currentView);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const t = useTranslations("nav");

  return (
    <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className="space-y-0.5">
          {group.groupKey && (
            <div className="pt-4 pb-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              {t(group.groupKey.split(".")[1] as never)}
            </div>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.view;
            const label = item.labelKey.split(".")[1] as never;

            if (!item.enabled) {
              return (
                <span
                  key={item.view}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground/40 cursor-not-allowed"
                >
                  <Icon className="w-4 h-4" />
                  <span>{t(label)}</span>
                </span>
              );
            }

            return (
              <button
                key={item.view}
                type="button"
                onClick={() => setCurrentView(item.view)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left ${
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t(label)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
