"use client";

/**
 * CalendarView (S14) — Calendar editor.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S14) + BR-WEB-P5: weekday mask (7 checkboxes
 * for Mon–Sun) + exceptions table (date picker + isWorking toggle + name
 * EN/AR + delete). Save via PUT /api/projects/[projectId]/calendar.
 *
 * Per BR-P9 default: Sun–Thu working, Fri–Sat off (Egyptian/Gulf).
 *
 * Data:
 *   - GET /api/projects/[projectId]/calendar → { calendar, exceptions }
 *   - PUT /api/projects/[projectId]/calendar → { calendar, exceptions } (upsert)
 *
 * The form keeps an in-memory editable copy of the mask + exceptions list.
 * "Save calendar" sends the whole bundle in one PUT (the server replaces the
 * exceptions atomically via the calendar repository's `upsert` per Group K).
 *
 * Empty states:
 *   - No project selected → "Go to Projects" CTA.
 *   - No calendar yet → the form seeds the BR-P9 default mask + empty
 *     exceptions list; the user can save to create.
 *
 * Layer purity: Client Component — imports only @tanstack/react-query,
 * next-intl, lucide-react, @/lib/queries, @/lib/mutations, @/lib/stores,
 * shadcn/ui. No server-only code.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Calendar as CalendarIcon, Plus, Trash2, Loader2 } from "lucide-react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────

interface ProjectCalendarApi {
  id: string;
  projectId: string;
  mondayWorking: boolean;
  tuesdayWorking: boolean;
  wednesdayWorking: boolean;
  thursdayWorking: boolean;
  fridayWorking: boolean;
  saturdayWorking: boolean;
  sundayWorking: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface CalendarExceptionApi {
  id: string;
  calendarId: string;
  date: string; // ISO yyyy-MM-dd (BR-P1)
  isWorking: boolean;
  nameEn: string | null;
  nameAr: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CalendarResponse {
  calendar: ProjectCalendarApi | null;
  exceptions: CalendarExceptionApi[];
}

// ─── Default mask per BR-P9 (Egyptian/Gulf practice: Sun–Thu on, Fri–Sat off)

const DEFAULT_MASK = {
  mondayWorking: true,
  tuesdayWorking: true,
  wednesdayWorking: true,
  thursdayWorking: true,
  fridayWorking: false,
  saturdayWorking: false,
  sundayWorking: true,
};

type MaskKey = keyof typeof DEFAULT_MASK;

const WEEKDAY_ORDER: MaskKey[] = [
  "mondayWorking",
  "tuesdayWorking",
  "wednesdayWorking",
  "thursdayWorking",
  "fridayWorking",
  "saturdayWorking",
  "sundayWorking",
];

// Keys below are relative to the `calendar` namespace — the i18n messages
// store `weekday.mon` etc. under `calendar`. So `t(WEEKDAY_LABEL_KEYS[key])`
// resolves to `calendar.weekday.mon` automatically.
const WEEKDAY_LABEL_KEYS: Record<MaskKey, string> = {
  mondayWorking: "weekday.mon",
  tuesdayWorking: "weekday.tue",
  wednesdayWorking: "weekday.wed",
  thursdayWorking: "weekday.thu",
  fridayWorking: "weekday.fri",
  saturdayWorking: "weekday.sat",
  sundayWorking: "weekday.sun",
};

// ─── Component ────────────────────────────────────────────────────────────

export function CalendarView() {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<CalendarResponse>({
    queryKey: currentProjectId
      ? queryKeys.calendar.detail(currentProjectId)
      : ["calendar", "detail", "_disabled"],
    queryFn: () =>
      fetchJson<CalendarResponse>(
        `/api/projects/${currentProjectId}/calendar`,
      ),
    enabled: !!currentProjectId,
  });

  // Local editable state. Seeded from the API response on first load (or
  // from the BR-P9 default when there's no calendar yet).
  const [mask, setMask] = useState<typeof DEFAULT_MASK>(DEFAULT_MASK);
  const [exceptions, setExceptions] = useState<CalendarExceptionApi[]>([]);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!seeded && data) {
      // One eslint-disable covers all the seeding setState calls below —
      // this is the canonical "copy server state to local editable state on
      // first load" pattern; the `seeded` flag prevents re-runs.
      /* eslint-disable react-hooks/set-state-in-effect */
      if (data.calendar) {
        setMask({
          mondayWorking: data.calendar.mondayWorking,
          tuesdayWorking: data.calendar.tuesdayWorking,
          wednesdayWorking: data.calendar.wednesdayWorking,
          thursdayWorking: data.calendar.thursdayWorking,
          fridayWorking: data.calendar.fridayWorking,
          saturdayWorking: data.calendar.saturdayWorking,
          sundayWorking: data.calendar.sundayWorking,
        });
      } else {
        setMask(DEFAULT_MASK);
      }
      setExceptions(data.exceptions ?? []);
      setSeeded(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [data, seeded]);

  // Save mutation. Declared unconditionally above the early return so the
  // Rules of Hooks hold (the early return renders no Button referencing it,
  // but we still must always call the same number of hooks).
  const saveMutation = useMutation({
    // Note: per Group K's calendar-repository.upsert, the PUT body shape is
    // `{ mask, exceptions }` and the route upserts the ProjectCalendar row +
    // replaces the exceptions list atomically in one $transaction.
    mutationFn: async (): Promise<CalendarResponse> => {
      // We use PUT directly (the existing mutations.ts helpers cover POST /
      // PATCH / DELETE — calendar's PUT is the only PUT endpoint in Phase 2,
      // so a one-off inline fetch is cleaner than adding apiPut to the shared
      // helper file).
      const res = await fetch(
        `/api/projects/${currentProjectId}/calendar`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mask,
            exceptions: exceptions.map((e) => ({
              date: e.date,
              isWorking: e.isWorking,
              nameEn: e.nameEn,
              nameAr: e.nameAr,
            })),
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return (res.status === 204 ? undefined : await res.json()) as CalendarResponse;
    },
    onSuccess: () => {
      if (!currentProjectId) return;
      qc.invalidateQueries({
        queryKey: queryKeys.calendar.detail(currentProjectId),
      });
      toast.success(t("saved"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ─── Empty state: no project selected ──────────────────────────────────
  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="mt-8 rounded-lg border border-border border-dashed p-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <CalendarIcon className="w-5 h-5 text-muted-foreground" />
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

  function toggleWeekday(key: MaskKey) {
    setMask((m) => ({ ...m, [key]: !m[key] }));
  }
  function addException() {
    // Generate a date one week out as a sensible default — the user can
    // change it in the date input.
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const iso = d.toISOString().slice(0, 10);
    setExceptions((list) => [
      ...list,
      {
        id: `tmp-${Date.now()}`, // local-only id; replaced on save
        calendarId: "tmp",
        date: iso,
        isWorking: false,
        nameEn: "",
        nameAr: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  }
  function updateException(idx: number, patch: Partial<CalendarExceptionApi>) {
    setExceptions((list) =>
      list.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    );
  }
  function removeException(idx: number) {
    setExceptions((list) => list.filter((_, i) => i !== idx));
  }

  const hasAnyWorking = Object.values(mask).some(Boolean);

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("defaultHint")}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !hasAnyWorking}
          className="bg-primary text-primary-foreground hover:bg-[var(--linear-primary-hover)] gap-1.5"
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : null}
          {t("save")}
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tc("loading")}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Working days — 7 checkboxes */}
          <section className="rounded-lg border border-border p-4 space-y-3">
            <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
              {t("workingDays")}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
              {WEEKDAY_ORDER.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 cursor-pointer rounded border border-border px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  <Checkbox
                    checked={mask[key]}
                    onCheckedChange={() => toggleWeekday(key)}
                  />
                  <span className="text-xs font-medium">
                    {t(WEEKDAY_LABEL_KEYS[key] as never)}
                  </span>
                </label>
              ))}
            </div>
            {!hasAnyWorking && (
              <p className="text-xs text-destructive">
                At least one working day is required (BR-P6).
              </p>
            )}
          </section>

          {/* Exceptions */}
          <section className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
                {t("exceptions")}
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addException}
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("addException")}
              </Button>
            </div>

            {exceptions.length === 0 ? (
              <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                {t("addException")} — e.g. public holidays, project-specific
                working weekends.
              </div>
            ) : (
              <div className="space-y-2">
                {/* Header row */}
                <div className="grid grid-cols-[140px_80px_1fr_1fr_32px] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  <div>{t("date")}</div>
                  <div className="text-center">{t("isWorking")}</div>
                  <div>{t("nameEn")}</div>
                  <div>{t("nameAr")}</div>
                  <div />
                </div>
                {exceptions.map((e, i) => (
                  <div
                    key={e.id}
                    className="grid grid-cols-[140px_80px_1fr_1fr_32px] gap-2 items-center"
                  >
                    <Input
                      type="date"
                      value={e.date}
                      onChange={(ev) =>
                        updateException(i, { date: ev.target.value })
                      }
                      className="h-8 text-xs"
                    />
                    <div className="flex justify-center">
                      <Switch
                        checked={e.isWorking}
                        onCheckedChange={(v) =>
                          updateException(i, { isWorking: v })
                        }
                      />
                    </div>
                    <Input
                      value={e.nameEn ?? ""}
                      onChange={(ev) =>
                        updateException(i, { nameEn: ev.target.value })
                      }
                      placeholder="e.g. National Day"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={e.nameAr ?? ""}
                      onChange={(ev) =>
                        updateException(i, { nameAr: ev.target.value })
                      }
                      placeholder="العيد الوطني"
                      dir="rtl"
                      className="h-8 text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      onClick={() => removeException(i)}
                      aria-label={t("deleteException")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
