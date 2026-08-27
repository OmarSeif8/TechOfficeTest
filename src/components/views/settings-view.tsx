"use client";

/**
 * SettingsView — S9 (per WO-W-4i).
 *
 * Two sections via shadcn Tabs:
 *   1. User Settings  — auto-saves each field (immediate for selects,
 *      debounced 2s for percent text inputs). Each PATCH sends the current
 *      `expectedVersion` for optimistic concurrency.
 *   2. Company Profile — local form state until the user clicks "Save".
 *      On save, PATCH /api/settings/company with all fields (upsert).
 *
 * Data fetched client-side via TanStack Query (`/api/settings` returns
 * `{ user, company }`). After each successful mutation we invalidate
 * `queryKeys.settings.all` so the cache refetches.
 *
 * i18n: `useTranslations("settings")` — see `src/i18n/messages/{en,ar}.json`.
 *
 * Layer purity: client component — imports react/next only. No prisma, no fs.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { queryKeys, fetchJson } from "@/lib/queries";
import { apiPatch } from "@/lib/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Prisma `UserSettings` row returned verbatim by `GET /api/settings`.
 * Enum values are uppercase (Prisma enum convention); the PATCH endpoint
 * accepts lowercase `theme`/`locale` (per `UserSettingsUpdateSchema` in
 * `src/shared/schemas/settings.ts`).
 */
interface UserSettings {
  id: string;
  userId: string;
  theme: "LIGHT" | "DARK" | "SYSTEM";
  locale: "EN" | "AR";
  defaultLaborMode: "CONSUMPTION" | "CREW";
  defaultOverheadPct: string;
  defaultProfitPct: string;
  autosaveIntervalMs: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Prisma `CompanyProfile` row, or `null` if the user has none yet. */
interface CompanyProfile {
  id: string;
  userId: string;
  nameEn: string;
  nameAr: string | null;
  addressEn: string | null;
  addressAr: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  logoFileUploadId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface SettingsResponse {
  user: UserSettings;
  company: CompanyProfile | null;
}

// ─── Constants & helpers ──────────────────────────────────────────────────

/** Debounce window for the percent text inputs (per WO-W-4i spec). */
const DEBOUNCE_MS = 2000;

/**
 * Map the Prisma uppercase `Theme` enum to the lowercase value accepted by
 * `UserSettingsUpdateSchema`. The UI doesn't expose "SYSTEM", so any
 * non-"LIGHT" value falls back to "dark".
 */
function themeFromServer(value: string): "light" | "dark" {
  return value.toUpperCase() === "LIGHT" ? "light" : "dark";
}

/** Map the Prisma uppercase `Locale` enum ("EN"|"AR") to lowercase. */
function localeFromServer(value: string): "en" | "ar" {
  return value.toUpperCase() === "AR" ? "ar" : "en";
}

// ─── View ─────────────────────────────────────────────────────────────────

export function SettingsView() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  const { data, isLoading, isError, error } = useQuery<SettingsResponse>({
    queryKey: queryKeys.settings.all,
    queryFn: () => fetchJson<SettingsResponse>("/api/settings"),
  });

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {tCommon("loading")}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load settings"}
        </div>
      ) : data?.user ? (
        <Tabs defaultValue="user" className="w-full">
          <TabsList>
            <TabsTrigger value="user">{t("user")}</TabsTrigger>
            <TabsTrigger value="company">{t("companyLabel")}</TabsTrigger>
          </TabsList>

          <TabsContent value="user" className="mt-4">
            <UserSettingsPanel user={data.user} />
          </TabsContent>

          <TabsContent value="company" className="mt-4">
            <CompanyProfilePanel
              key={data.company?.version ?? "new"}
              company={data.company}
            />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}

// ─── User settings panel ───────────────────────────────────────────────────

/**
 * UserSettingsPanel — auto-saving form for UserSettings.
 *
 * Re-syncs local state from `user` whenever the server `version` changes
 * (after a successful PATCH → query invalidation → refetch). For the two
 * debounced text inputs (overhead %, profit %), we track what we just sent
 * so a refetch arriving while the user is mid-typing doesn't clobber their
 * in-progress value.
 */
function UserSettingsPanel({ user }: { user: UserSettings }) {
  const t = useTranslations("settings");
  const qc = useQueryClient();
  const { setTheme } = useTheme();

  const [theme, setThemeLocal] = useState(themeFromServer(user.theme));
  const [locale, setLocaleLocal] = useState(localeFromServer(user.locale));
  const [laborMode, setLaborMode] = useState(user.defaultLaborMode);
  const [overhead, setOverhead] = useState(user.defaultOverheadPct);
  const [profit, setProfit] = useState(user.defaultProfitPct);
  const [savingField, setSavingField] = useState<string | null>(null);

  const justPatched = useRef<{ overhead?: string; profit?: string }>({});
  const lastSyncedVersion = useRef(user.version);
  const overheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync from props when the server version changes (post-refetch).
  useEffect(() => {
    if (user.version !== lastSyncedVersion.current) {
      lastSyncedVersion.current = user.version;
      setThemeLocal(themeFromServer(user.theme));
      setLocaleLocal(localeFromServer(user.locale));
      setLaborMode(user.defaultLaborMode);
      // Only overwrite the text inputs if the server value differs from what
      // we just PATCHed — otherwise the user's in-progress typing gets clobbered.
      if (user.defaultOverheadPct !== justPatched.current.overhead) {
        setOverhead(user.defaultOverheadPct);
      }
      if (user.defaultProfitPct !== justPatched.current.profit) {
        setProfit(user.defaultProfitPct);
      }
    }
  }, [user]);

  // Clean up pending debounced PATCHes on unmount.
  useEffect(() => {
    return () => {
      if (overheadTimer.current) clearTimeout(overheadTimer.current);
      if (profitTimer.current) clearTimeout(profitTimer.current);
    };
  }, []);

  // ─── PATCH helper ──────────────────────────────────────────────────────

  const patchUser = useCallback(
    async (
      field: string,
      body: Record<string, unknown>,
    ): Promise<void> => {
      setSavingField(field);
      try {
        await apiPatch("/api/settings/user", {
          ...body,
          expectedVersion: user.version,
        });
        // Remember what we just PATCHed for text fields, so the next server
        // sync doesn't overwrite mid-typing.
        if (body.defaultOverheadPct !== undefined) {
          justPatched.current.overhead = body.defaultOverheadPct as string;
        }
        if (body.defaultProfitPct !== undefined) {
          justPatched.current.profit = body.defaultProfitPct as string;
        }
        await qc.invalidateQueries({ queryKey: queryKeys.settings.all });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update setting",
        );
      } finally {
        // Brief delay so the "saving…" indicator is visible on fast networks.
        setTimeout(() => setSavingField(null), 250);
      }
    },
    [user.version, qc],
  );

  // ─── Field change handlers ─────────────────────────────────────────────

  function handleThemeChange(next: "light" | "dark") {
    setThemeLocal(next);
    // Apply immediately via next-themes (writes to localStorage + DOM).
    setTheme(next);
    void patchUser("theme", { theme: next });
  }

  function handleLocaleChange(next: "en" | "ar") {
    setLocaleLocal(next);
    // PATCH the server preference; the reload picks up the new locale.
    void patchUser("locale", { locale: next });
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", next);
      document.documentElement.setAttribute(
        "dir",
        next === "ar" ? "rtl" : "ltr",
      );
      // Brief delay so the PATCH has time to land before reload.
      setTimeout(() => {
        if (typeof window !== "undefined") window.location.reload();
      }, 100);
    }
  }

  function handleLaborModeChange(next: "CONSUMPTION" | "CREW") {
    setLaborMode(next);
    void patchUser("labor", { defaultLaborMode: next });
  }

  function handleOverheadChange(value: string) {
    setOverhead(value);
    if (overheadTimer.current) clearTimeout(overheadTimer.current);
    overheadTimer.current = setTimeout(() => {
      void patchUser("overhead", { defaultOverheadPct: value });
    }, DEBOUNCE_MS);
  }

  function handleProfitChange(value: string) {
    setProfit(value);
    if (profitTimer.current) clearTimeout(profitTimer.current);
    profitTimer.current = setTimeout(() => {
      void patchUser("profit", { defaultProfitPct: value });
    }, DEBOUNCE_MS);
  }

  return (
    <div className="space-y-5 rounded-lg border border-border p-5 bg-card">
      {/* Saving indicator */}
      <div className="flex justify-end min-h-[1rem]">
        {savingField && (
          <span className="text-xs text-muted-foreground animate-pulse">
            Saving…
          </span>
        )}
      </div>

      {/* Theme */}
      <Field label={t("theme")}>
        <Select
          value={theme}
          onValueChange={(v) =>
            handleThemeChange(v as "light" | "dark")
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {/* Language */}
      <Field label={t("language")}>
        <Select
          value={locale}
          onValueChange={(v) =>
            handleLocaleChange(v as "en" | "ar")
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ar">العربية</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {/* Default labor mode */}
      <Field label={t("defaultLaborMode")}>
        <Select
          value={laborMode}
          onValueChange={(v) =>
            handleLaborModeChange(v as "CONSUMPTION" | "CREW")
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CONSUMPTION">Consumption</SelectItem>
            <SelectItem value="CREW">Crew</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {/* Default overhead % */}
      <Field label={t("defaultOverhead")}>
        <Input
          type="text"
          inputMode="decimal"
          value={overhead}
          onChange={(e) => handleOverheadChange(e.target.value)}
          placeholder="10"
        />
      </Field>

      {/* Default profit % */}
      <Field label={t("defaultProfit")}>
        <Input
          type="text"
          inputMode="decimal"
          value={profit}
          onChange={(e) => handleProfitChange(e.target.value)}
          placeholder="15"
        />
      </Field>
    </div>
  );
}

// ─── Company profile panel ──────────────────────────────────────────────────

/**
 * CompanyProfilePanel — manual-save form for the CompanyProfile.
 *
 * Fields are local state until "Save" is clicked. The panel is keyed by
 * `company.version` in the parent so it remounts with fresh state after a
 * successful save (refetch → new version → fresh form reflects persisted data).
 */
function CompanyProfilePanel({
  company,
}: {
  company: CompanyProfile | null;
}) {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const qc = useQueryClient();

  const [nameEn, setNameEn] = useState(company?.nameEn ?? "");
  const [nameAr, setNameAr] = useState(company?.nameAr ?? "");
  const [addressEn, setAddressEn] = useState(company?.addressEn ?? "");
  const [addressAr, setAddressAr] = useState(company?.addressAr ?? "");
  const [phone, setPhone] = useState(company?.phone ?? "");
  const [email, setEmail] = useState(company?.email ?? "");
  const [taxId, setTaxId] = useState(company?.taxId ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = nameEn.trim();
    if (!trimmedName) {
      toast.error("Company name (English) is required.");
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        nameEn: trimmedName,
        nameAr: nameAr.trim() || undefined,
        addressEn: addressEn.trim() || undefined,
        addressAr: addressAr.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        taxId: taxId.trim() || undefined,
      };
      // Optimistic-concurrency token only when an existing row is being updated.
      if (company) {
        body.expectedVersion = company.version;
      }
      await apiPatch("/api/settings/company", body);
      await qc.invalidateQueries({ queryKey: queryKeys.settings.all });
      toast.success("Company profile saved.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save company profile",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSave}
      className="space-y-5 rounded-lg border border-border p-5 bg-card"
    >
      {/* Empty-state note */}
      {!company && (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          No company profile yet — fill in the fields and save.
        </div>
      )}

      {/* Company name (EN) — required */}
      <Field label={t("company.name")}>
        <Input
          required
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          placeholder="Acme Engineering Co."
        />
      </Field>

      {/* Company name (AR) — optional */}
      <Field label={`${t("company.name")} (AR)`}>
        <Input
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
          placeholder="شركة الهندسة"
          dir="rtl"
        />
      </Field>

      {/* Address (EN) */}
      <Field label={`${t("company.address")} (EN)`}>
        <Textarea
          value={addressEn}
          onChange={(e) => setAddressEn(e.target.value)}
          placeholder="Street, city, country"
        />
      </Field>

      {/* Address (AR) */}
      <Field label={`${t("company.address")} (AR)`}>
        <Textarea
          value={addressAr}
          onChange={(e) => setAddressAr(e.target.value)}
          placeholder="الشارع، المدينة، الدولة"
          dir="rtl"
        />
      </Field>

      {/* Phone + Email row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t("company.phone")}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
          />
        </Field>
        <Field label={t("company.email")}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@company.com"
          />
        </Field>
      </div>

      {/* Tax ID */}
      <Field label={t("company.taxId")}>
        <Input
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
          placeholder="VAT / Tax ID"
        />
      </Field>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : tCommon("save")}
        </Button>
      </div>
    </form>
  );
}

// ─── Shared field wrapper ──────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
