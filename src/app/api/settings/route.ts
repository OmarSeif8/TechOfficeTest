/**
 * GET /api/settings
 *
 * Returns the combined settings for the current user:
 *   { user: UserSettings, company: CompanyProfile | null }
 *
 * If the user has no UserSettings row yet, it is created with the default
 * values defined in WO-W-12a:
 *   theme: "dark", locale: "en", defaultLaborMode: "CONSUMPTION",
 *   defaultOverheadPct: "10", defaultProfitPct: "15".
 *
 * (Prisma enum casing note: the Prisma `Theme` / `Locale` enums store
 * uppercase values; the route handler persists uppercase and the response
 * contains the Prisma row verbatim. The user-facing UI is responsible for
 * mapping. See src/shared/schemas/settings.ts for the casing rationale.)
 *
 * Per BR-WEB-5: requires an authenticated session.
 *
 * Layer purity: top of the stack — App Router route handler.
 */

import { withErrorHandler, json } from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";

export const GET = withErrorHandler(async () => {
  const userId = await requireUserId();

  let userSettings = await db.userSettings.findUnique({ where: { userId } });
  if (!userSettings) {
    userSettings = await db.userSettings.create({
      data: {
        userId,
        theme: "DARK",
        locale: "EN",
        defaultLaborMode: "CONSUMPTION",
        defaultOverheadPct: "10",
        defaultProfitPct: "15",
      },
    });
  }

  const company = await db.companyProfile.findUnique({ where: { userId } });

  return json({ user: userSettings, company });
});
