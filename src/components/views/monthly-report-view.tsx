"use client";

/**
 * MonthlyReportView (S30) — Composite report builder.
 *
 * Per SPEC_PHASE4_WEB.md §6 (S30): composite report builder (summary +
 * S-curve + payment status + variations). Phase 4 MVP — the report is a
 * read-only composite of project dashboard + payments list + variations list.
 *
 * Data:
 *   - GET /api/projects/[projectId]/project-dashboard  → S-curve + SPI
 *   - GET /api/projects/[projectId]/payments           → list of applications
 *   - GET /api/projects/[projectId]/variations        → list of variations
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
import { FileText } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PaymentStatus, VariationStatus } from "@shared/entities";

interface DashboardResponse {
  asOf: string;
  contractValue: string;
  spi: string;
  plannedProgressPct: string;
  actualProgressPct: string;
  overdueDocs: number;
  coveragePct: string;
  bac: string;
  pvAtAsOf: string;
  evAtAsOf: string;
  sCurve: { date: string; planned: string; earned: string }[];
}

interface PaymentsListResponse {
  applications: {
    id: string;
    ipcNo: number;
    periodStart: string;
    periodEnd: string;
    status: PaymentStatus;
    contractValue: string;
    version: number;
  }[];
}

interface VariationsListResponse {
  variations: {
    id: string;
    ref: string;
    titleEn: string;
    status: VariationStatus;
    approvedValue: string | null;
  }[];
}

function statusVariant(status: PaymentStatus | VariationStatus) {
  if (status === "CERTIFIED" || status === "APPROVED") return "default";
  if (status === "REJECTED") return "destructive";
  if (status === "SUBMITTED") return "secondary";
  return "outline";
}

export function MonthlyReportView() {
  const t = useTranslations("monthlyReport");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  const dashQ = useQuery<DashboardResponse>({
    queryKey: currentProjectId
      ? queryKeys.projectDashboard.detail(currentProjectId)
      : ["project-dashboard", "_disabled"],
    queryFn: () =>
      fetchJson<DashboardResponse>(`/api/projects/${currentProjectId}/project-dashboard`),
    enabled: !!currentProjectId,
  });

  const paymentsQ = useQuery<PaymentsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.payments.list(currentProjectId)
      : ["payments", "list", "_disabled"],
    queryFn: () =>
      fetchJson<PaymentsListResponse>(`/api/projects/${currentProjectId}/payments`),
    enabled: !!currentProjectId,
  });

  const variationsQ = useQuery<VariationsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.variations.list(currentProjectId)
      : ["variations", "list", "_disabled"],
    queryFn: () =>
      fetchJson<VariationsListResponse>(`/api/projects/${currentProjectId}/variations`),
    enabled: !!currentProjectId,
  });

  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <FileText className="w-5 h-5 text-muted-foreground" />
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

  const dash = dashQ.data;
  const applications = paymentsQ.data?.applications ?? [];
  const variations = variationsQ.data?.variations ?? [];

  const chartData = (dash?.sCurve ?? []).map((p) => ({
    date: p.date,
    planned: Number.parseFloat(p.planned),
    earned: Number.parseFloat(p.earned),
  }));

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("asOf")} {dash?.asOf ?? "—"}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCell label={t("contractValue")} value={dash?.contractValue ?? "—"} />
        <SummaryCell label={t("spi")} value={dash?.spi ?? "—"} />
        <SummaryCell
          label={t("actualProgress")}
          value={(dash?.actualProgressPct ?? "0") + "%"}
        />
        <SummaryCell
          label={t("overdueDocs")}
          value={String(dash?.overdueDocs ?? 0)}
        />
      </div>

      {/* S-curve */}
      <Section title={t("sCurve")}>
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
            {t("noSchedule")}
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 16, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
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
      </Section>

      {/* Payments summary */}
      <Section title={t("payments") + ` (${applications.length})`}>
        {applications.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">{t("noPayments")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground w-16">IPC #</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">Period</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">{t("contractValue")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {applications.slice(0, 10).map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{a.ipcNo}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {a.periodStart} → {a.periodEnd}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{a.contractValue}</td>
                  <td className="px-4 py-2">
                    <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Variations summary */}
      <Section title={t("variations") + ` (${variations.length})`}>
        {variations.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">{t("noVariations")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">{tc("ref")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">{t("title")}</th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-32">
                  {t("approvedValue")}
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground w-24">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {variations.slice(0, 10).map((v) => (
                <tr key={v.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{v.ref}</td>
                  <td className="px-4 py-2">{v.titleEn}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {v.approvedValue ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={statusVariant(v.status)}>{v.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold font-mono">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {title}
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}
