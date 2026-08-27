"use client";

/**
 * ProjectDashboardView (S28) — S-curve chart (Recharts) + cards.
 *
 * Per SPEC_PHASE4_WEB.md §2 + §6 (S28): planned vs earned curves over time,
 * cards: contract value, SPI, progress %, overdue docs.
 *
 * Data:
 *   - GET /api/projects/[projectId]/project-dashboard → aggregated data
 *
 * Per BR-WEB-CS1: S-curve charts use Recharts (client-side rendering).
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/stores, shadcn/ui, recharts.
 * No server-only code.
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  LayoutDashboard,
  TrendingUp,
  Gauge,
  Percent,
  AlertTriangle,
  DollarSign,
} from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";

interface SCurvePoint {
  date: string;
  planned: string;
  earned: string;
}

interface DashboardResponse {
  asOf: string;
  contractValue: string;
  certifiedToDate: string;
  spi: string;
  plannedProgressPct: string;
  actualProgressPct: string;
  overdueDocs: number;
  coveragePct: string;
  bac: string;
  pvAtAsOf: string;
  evAtAsOf: string;
  sCurve: SCurvePoint[];
  latestScheduleRunId: string | null;
  latestProgressUpdateId: string | null;
}

interface DashboardCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  footer?: string;
}

function DashboardCard({ title, value, icon, footer }: DashboardCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold font-mono">{value}</div>
      {footer && (
        <div className="mt-1 text-xs text-muted-foreground">{footer}</div>
      )}
    </div>
  );
}

export function ProjectDashboardView() {
  const t = useTranslations("projectDashboard");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: currentProjectId
      ? queryKeys.projectDashboard.detail(currentProjectId)
      : ["project-dashboard", "_disabled"],
    queryFn: () =>
      fetchJson<DashboardResponse>(`/api/projects/${currentProjectId}/project-dashboard`),
    enabled: !!currentProjectId,
  });

  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <LayoutDashboard className="w-5 h-5 text-muted-foreground" />
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

  const chartData = (data?.sCurve ?? []).map((p) => ({
    date: p.date,
    planned: Number.parseFloat(p.planned),
    earned: Number.parseFloat(p.earned),
  }));

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("asOf")} {data?.asOf ?? "—"}
        </p>
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
        <>
          {/* Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <DashboardCard
              title={t("contractValue")}
              value={data.contractValue}
              icon={<DollarSign className="w-4 h-4" />}
            />
            <DashboardCard
              title={t("spi")}
              value={data.spi}
              icon={<Gauge className="w-4 h-4" />}
              footer={t("coverage") + ": " + data.coveragePct + "%"}
            />
            <DashboardCard
              title={t("actualProgress")}
              value={data.actualProgressPct + "%"}
              icon={<Percent className="w-4 h-4" />}
              footer={t("plannedProgress") + ": " + data.plannedProgressPct + "%"}
            />
            <DashboardCard
              title={t("overdueDocs")}
              value={String(data.overdueDocs)}
              icon={<AlertTriangle className="w-4 h-4" />}
            />
          </div>

          {/* S-curve */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                {t("sCurve")}
              </div>
              <div className="text-xs text-muted-foreground">
                BAC: {data.bac} · PV: {data.pvAtAsOf} · EV: {data.evAtAsOf}
              </div>
            </div>
            {chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                {t("noSchedule")}
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 16, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="text-muted-foreground" stroke="currentColor" opacity={0.2} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      className="text-muted-foreground"
                    />
                    <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="planned"
                      name={t("planned")}
                      stroke="#3b82f6"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="earned"
                      name={t("earned")}
                      stroke="#10b981"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
