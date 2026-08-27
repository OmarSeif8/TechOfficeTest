"use client";

import { useTranslations } from "next-intl";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * TopBar — Linear-styled top navigation bar.
 *
 * Per CONSTITUTION_V1.1_WEB Amendment #6:
 *   - Thin (h-12 = 48px)
 *   - Hairline border-bottom
 *   - Sticky top, backdrop-blur for content scrolling under it
 *   - Brand mark uses primary accent (lavender) — the ONE decorative use allowed
 *
 * Contains:
 *   - Brand (logo + name + tagline)
 *   - Phase badge (right side)
 *   - Language toggle (EN/AR)
 *   - Theme toggle (dark/light)
 */

export function TopBar() {
  const t = useTranslations();
  const appName = t("app.name");
  const tagline = t("app.tagline");

  return (
    <header className="h-12 border-b border-border flex items-center px-4 gap-6 sticky top-0 z-40 bg-background/95 backdrop-blur">
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-xs">T</span>
        </div>
        <span className="font-semibold text-sm tracking-tight">{appName}</span>
        <span className="text-xs text-muted-foreground ml-1 hidden sm:inline">
          {tagline}
        </span>
      </div>

      <div className="flex-1" />

      {/* Right side: phase badge + toggles */}
      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground mr-2">
          <span className="px-1.5 py-0.5 rounded bg-muted">Phase 1</span>
          <span>·</span>
          <span>{t("nav.boq")}</span>
        </div>
        <ThemeToggle />
        <LanguageToggle />
      </div>
    </header>
  );
}
