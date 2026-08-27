"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";
import { Globe } from "lucide-react";
import { useLocale } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * LanguageToggle — Phase 1 EN/AR language switcher.
 *
 * Per WO-W-13:
 * - Phase 1: toggle the `lang` attribute on `<html>` and reload.
 * - Full next-intl middleware integration is deferred (per spec:
 *   "URL-based (`/[locale]/...`) deferred to Phase 5 for SEO").
 * - The dynamic locale-from-session comes in WO-W-14.
 *
 * What this component does:
 *   1. Reads the current locale from next-intl (`useLocale()`).
 *   2. Shows a globe icon + the current locale's short code ("EN" / "ع").
 *   3. On select, writes the preference to localStorage["locale"] so the
 *      WO-W-14 session-based detector can pick it up immediately.
 *   4. Updates `document.documentElement.lang` and `.dir` for instant
 *      visual feedback (Arabic flips the layout to RTL).
 *   5. Triggers a full page reload — the server-side request config in
 *      `src/i18n/request.ts` (currently hardcoded to "en" pending WO-W-14)
 *      will eventually respect the persisted preference.
 *
 * Design: Linear language toggle — square button, hairline border,
 * mono-font locale code, subtle hover bg.
 *
 * Hydration fix: Radix UI's DropdownMenu generates random IDs that differ
 * between server and client renders, causing hydration mismatch warnings.
 * We delay rendering the DropdownMenu until after client mount using
 * `useSyncExternalStore` (the React 18+ idiomatic pattern — avoids
 * set-state-in-effect lint violations). A placeholder button with the same
 * dimensions renders on the server to prevent layout shift.
 */
const STORAGE_KEY = "locale";

const LOCALE_OPTIONS = [
  {
    value: "en" as const,
    label: "English",
    short: "EN",
    dir: "ltr" as const,
  },
  {
    value: "ar" as const,
    label: "العربية",
    short: "ع",
    dir: "rtl" as const,
  },
];

// Empty subscribe function for useSyncExternalStore — we just need
// the server/client snapshot divergence to detect mount.
const emptySubscribe = () => () => {};

export function LanguageToggle({ className }: { className?: string }) {
  const currentLocale = useLocale();
  const active =
    LOCALE_OPTIONS.find((o) => o.value === currentLocale) ?? LOCALE_OPTIONS[0];

  // Detect client mount — returns false on server, true on client.
  // This prevents Radix's ID mismatch hydration warning.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false, // server snapshot
  );

  function selectLocale(value: "en" | "ar") {
    if (value === currentLocale) return;

    // 1. Persist preference for WO-W-14 session-based detection.
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // localStorage may be unavailable (private mode, etc.) — silently skip.
    }

    // 2. Apply lang/dir immediately so the visual update is instant
    //    even before the reload finishes (progressive enhancement).
    //    Use setAttribute so the React Compiler immutability lint stays
    //    happy (it flags direct property assignment on externals).
    document.documentElement.setAttribute("lang", value);
    document.documentElement.setAttribute(
      "dir",
      value === "ar" ? "rtl" : "ltr",
    );

    // 3. Reload so the server-rendered layout + next-intl messages re-render
    //    under the new locale. (Phase 1 caveat: src/i18n/request.ts still
    //    hardcodes "en" — WO-W-14 will close this loop.)
    window.location.reload();
  }

  // Placeholder button — same dimensions as the real one, rendered on
  // server + during the first client render. Prevents layout shift.
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 px-2 gap-1.5 font-mono text-xs",
          "text-muted-foreground hover:text-foreground",
          className,
        )}
        aria-label="Change language"
        disabled
      >
        <Globe className="w-3.5 h-3.5" />
        <span className="tracking-tight">{active.short}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2 gap-1.5 font-mono text-xs",
            "text-muted-foreground hover:text-foreground",
            className,
          )}
          aria-label="Change language"
        >
          <Globe className="w-3.5 h-3.5" />
          <span className="tracking-tight">{active.short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal uppercase tracking-wide">
          Language · اللغة
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOCALE_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onSelect={() => selectLocale(opt.value)}
            className={cn(
              "flex items-center justify-between gap-3 cursor-pointer",
              opt.value === currentLocale && "bg-accent text-accent-foreground",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground w-5">
                {opt.short}
              </span>
              <span>{opt.label}</span>
            </span>
            {opt.value === currentLocale && (
              <span className="text-[10px] uppercase tracking-wide text-primary">
                active
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
