import { getRequestConfig } from "next-intl/server";

/**
 * next-intl request configuration (Phase 1 — non-URL routing).
 *
 * Per WO-W-13:
 * - URL-based routing (`/[locale]/...`) is DEFERRED to Phase 5 for SEO.
 * - For Phase 1, the locale is detected server-side from the session
 *   (UserSettings.locale) — that integration lands in WO-W-14.
 * - Until WO-W-14 ships, this config hardcodes "en". The language-toggle
 *   component still writes the user's preference to localStorage so WO-W-14
 *   can pick it up immediately once session-based detection is wired.
 *
 * Spec ref:
 *   CONSTITUTION_V1.1_WEB.md §8 — "Every user-visible string via i18n keys;
 *   no literals". This file is the canonical entry point for those strings.
 */
export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export default getRequestConfig(async () => {
  // Phase 1: locale comes from UserSettings via session (server-side).
  // For now, default to "en" until auth+settings integration lands in WO-W-14.
  const locale: Locale = "en"; // will be dynamic in WO-W-14

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
