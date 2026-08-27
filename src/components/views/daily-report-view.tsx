"use client";

/**
 * DailyReportView (S29) — Daily site report form.
 *
 * Per SPEC_PHASE4_WEB.md §4 + §6 (S29): date, weather, manpower rows,
 * equipment rows, work-done rows.
 *
 * Data:
 *   - GET  /api/projects/[projectId]/daily-reports   → { reports }
 *   - POST /api/projects/[projectId]/daily-reports   → DailyReport
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Calendar, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPost } from "@/lib/mutations";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface DailyReportApi {
  id: string;
  projectId: string;
  date: string;
  weather: string | null;
  temperature: string | null;
  notesEn: string | null;
  notesAr: string | null;
  version: number;
  createdAt: string;
}

interface DailyReportsListResponse {
  reports: DailyReportApi[];
}

interface ManpowerRow {
  tradeEn: string;
  count: number;
}

interface EquipmentRow {
  descriptionEn: string;
  count: number;
  hours: string;
}

interface WorkDoneRow {
  locationEn: string;
  descriptionEn: string;
}

function todayIso() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DailyReportView() {
  const t = useTranslations("dailyReport");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const [date, setDate] = useState(todayIso());
  const [weather, setWeather] = useState("");
  const [temperature, setTemperature] = useState("");
  const [notesEn, setNotesEn] = useState("");
  const [manpower, setManpower] = useState<ManpowerRow[]>([]);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [workDone, setWorkDone] = useState<WorkDoneRow[]>([]);

  const { data, isLoading } = useQuery<DailyReportsListResponse>({
    queryKey: currentProjectId
      ? queryKeys.dailyReports.list(currentProjectId)
      : ["daily-reports", "list", "_disabled"],
    queryFn: () =>
      fetchJson<DailyReportsListResponse>(`/api/projects/${currentProjectId}/daily-reports`),
    enabled: !!currentProjectId,
  });

  const reports = data?.reports ?? [];

  const createMutation = useMutation({
    mutationFn: (vars: {
      date: string;
      weather: string | null;
      temperature: string | null;
      notesEn: string | null;
      manpower: ManpowerRow[];
      equipment: EquipmentRow[];
      workDone: WorkDoneRow[];
    }) =>
      apiPost<DailyReportApi>(`/api/projects/${currentProjectId}/daily-reports`, {
        date: vars.date,
        weather: vars.weather,
        temperature: vars.temperature,
        notesEn: vars.notesEn,
        manpower: vars.manpower.map((m, i) => ({
          tradeEn: m.tradeEn,
          count: m.count,
          sortOrder: i,
        })),
        equipment: vars.equipment.map((e, i) => ({
          descriptionEn: e.descriptionEn,
          count: e.count,
          hours: e.hours || null,
          sortOrder: i,
        })),
        workDone: vars.workDone.map((w, i) => ({
          locationEn: w.locationEn,
          descriptionEn: w.descriptionEn,
          sortOrder: i,
        })),
      }),
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({ queryKey: queryKeys.dailyReports.list(currentProjectId) });
      toast.success(t("saved"));
      // Reset form but keep date.
      setWeather("");
      setTemperature("");
      setNotesEn("");
      setManpower([]);
      setEquipment([]);
      setWorkDone([]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <Calendar className="w-5 h-5 text-muted-foreground" />
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

  function submit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Date must be ISO yyyy-MM-dd");
      return;
    }
    createMutation.mutate({
      date,
      weather: weather.trim() || null,
      temperature: temperature.trim() || null,
      notesEn: notesEn.trim() || null,
      manpower: manpower.filter((m) => m.tradeEn.trim()),
      equipment: equipment.filter((e) => e.descriptionEn.trim()),
      workDone: workDone.filter((w) => w.locationEn.trim() && w.descriptionEn.trim()),
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {reports.length} {reports.length === 1 ? "report" : "reports"}
          </p>
        </div>
        <Button
          type="button"
          onClick={submit}
          disabled={createMutation.isPending}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          {createMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {tc("save")}
        </Button>
      </div>

      {/* Header fields */}
      <div className="rounded-lg border border-border p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label htmlFor="date">{t("date")}</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="weather">{t("weather")}</Label>
          <Input
            id="weather"
            value={weather}
            placeholder="Sunny"
            onChange={(e) => setWeather(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="temperature">{t("temperature")}</Label>
          <Input
            id="temperature"
            value={temperature}
            placeholder="32°C"
            onChange={(e) => setTemperature(e.target.value)}
          />
        </div>
        <div className="space-y-1 md:col-span-1">
          <Label htmlFor="notesEn">{t("notes")}</Label>
          <Textarea
            id="notesEn"
            value={notesEn}
            rows={1}
            placeholder={t("notesPlaceholder")}
            onChange={(e) => setNotesEn(e.target.value)}
          />
        </div>
      </div>

      {/* Manpower */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("manpower")} ({manpower.length})
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setManpower([...manpower, { tradeEn: "", count: 1 }])}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("addRow")}
          </Button>
        </div>
        <div className="divide-y divide-border">
          {manpower.map((row, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-2">
              <Input
                className="flex-1 h-8"
                placeholder={t("trade")}
                value={row.tradeEn}
                onChange={(e) => {
                  const next = [...manpower];
                  next[i] = { ...next[i], tradeEn: e.target.value };
                  setManpower(next);
                }}
              />
              <Input
                type="number"
                min={0}
                className="h-8 w-24"
                placeholder={t("count")}
                value={row.count}
                onChange={(e) => {
                  const next = [...manpower];
                  next[i] = { ...next[i], count: Number(e.target.value) };
                  setManpower(next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => setManpower(manpower.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          {manpower.length === 0 && (
            <div className="px-4 py-3 text-xs text-muted-foreground">{t("noRows")}</div>
          )}
        </div>
      </div>

      {/* Equipment */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("equipment")} ({equipment.length})
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setEquipment([...equipment, { descriptionEn: "", count: 1, hours: "" }])}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("addRow")}
          </Button>
        </div>
        <div className="divide-y divide-border">
          {equipment.map((row, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-2">
              <Input
                className="flex-1 h-8"
                placeholder={t("description")}
                value={row.descriptionEn}
                onChange={(e) => {
                  const next = [...equipment];
                  next[i] = { ...next[i], descriptionEn: e.target.value };
                  setEquipment(next);
                }}
              />
              <Input
                type="number"
                min={0}
                className="h-8 w-20"
                placeholder={t("count")}
                value={row.count}
                onChange={(e) => {
                  const next = [...equipment];
                  next[i] = { ...next[i], count: Number(e.target.value) };
                  setEquipment(next);
                }}
              />
              <Input
                className="h-8 w-20"
                placeholder={t("hours")}
                value={row.hours}
                onChange={(e) => {
                  const next = [...equipment];
                  next[i] = { ...next[i], hours: e.target.value };
                  setEquipment(next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => setEquipment(equipment.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          {equipment.length === 0 && (
            <div className="px-4 py-3 text-xs text-muted-foreground">{t("noRows")}</div>
          )}
        </div>
      </div>

      {/* Work done */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("workDone")} ({workDone.length})
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setWorkDone([...workDone, { locationEn: "", descriptionEn: "" }])}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("addRow")}
          </Button>
        </div>
        <div className="divide-y divide-border">
          {workDone.map((row, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-2">
              <Input
                className="h-8 w-40"
                placeholder={t("location")}
                value={row.locationEn}
                onChange={(e) => {
                  const next = [...workDone];
                  next[i] = { ...next[i], locationEn: e.target.value };
                  setWorkDone(next);
                }}
              />
              <Input
                className="flex-1 h-8"
                placeholder={t("description")}
                value={row.descriptionEn}
                onChange={(e) => {
                  const next = [...workDone];
                  next[i] = { ...next[i], descriptionEn: e.target.value };
                  setWorkDone(next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => setWorkDone(workDone.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          {workDone.length === 0 && (
            <div className="px-4 py-3 text-xs text-muted-foreground">{t("noRows")}</div>
          )}
        </div>
      </div>

      {/* Recent reports */}
      {reports.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("recentReports")}
          </div>
          <div className="max-h-48 overflow-y-auto">
            {reports.slice(0, 10).map((r) => (
              <div
                key={r.id}
                className="px-4 py-2 border-b border-border last:border-0 text-sm font-mono text-xs"
              >
                <span className="text-foreground">{r.date}</span>
                {r.weather && (
                  <span className="ml-3 text-muted-foreground">{r.weather}</span>
                )}
                {r.notesEn && (
                  <span className="ml-3 text-muted-foreground">{r.notesEn}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
