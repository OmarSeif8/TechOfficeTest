/**
 * PATCH /api/settings/user
 *
 * Update (or create) the current user's UserSettings. Body validated by
 * `UserSettingsUpdateSchema`. Uses Prisma `userSettings.upsert()` so the row
 * is created with the provided values if it doesn't exist yet, or updated
 * in place otherwise.
 *
 * Per BR-WEB-5: requires an authenticated session.
 * Per BR-WEB-8: writes an AuditLog entry on success.
 * Per BR-WEB-11: body validated by zod.
 *
 * Optimistic concurrency: if `expectedVersion` is provided and doesn't match
 * the current `version` on the existing row, returns 409 Conflict.
 *
 * Casing transform: zod accepts lowercase `theme` ("light"|"dark") and
 * `locale` ("en"|"ar") per the @shared/entities contract; the route handler
 * uppercases them before persisting to match the Prisma enum values
 * (LIGHT|DARK|SYSTEM, EN|AR). `defaultLaborMode` is already uppercase in
 * the zod schema and passes through unchanged.
 *
 * Layer purity: top of the stack — App Router route handler.
 */

import { NextRequest } from "next/server";
import type { Theme, Locale, LaborMode } from "@prisma/client";
import {
  withErrorHandler,
  json,
  conflict,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { UserSettingsUpdateSchema } from "@shared/schemas/settings";

export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const userId = await requireUserId();
  const body = UserSettingsUpdateSchema.parse(await req.json());
  const { expectedVersion, ...updateFields } = body;

  // Optimistic concurrency check (only if a row already exists).
  if (expectedVersion !== undefined) {
    const existing = await db.userSettings.findUnique({ where: { userId } });
    if (existing && existing.version !== expectedVersion) {
      return conflict(
        "Version mismatch — settings were modified by another request",
        existing.version,
      );
    }
  }

  // Transform lowercase enum values (entity convention) to uppercase
  // (Prisma enum convention). `defaultLaborMode` is already uppercase.
  const createTheme: Theme = (updateFields.theme?.toUpperCase() ?? "DARK") as Theme;
  const createLocale: Locale = (updateFields.locale?.toUpperCase() ?? "EN") as Locale;
  const createLaborMode: LaborMode =
    (updateFields.defaultLaborMode ?? "CONSUMPTION") as LaborMode;

  // Spread only the fields that were provided. Prisma treats `undefined`
  // as "skip", so omitted fields are not modified on update.
  const updateData: Record<string, unknown> = {
    ...(updateFields.theme !== undefined && {
      theme: updateFields.theme.toUpperCase() as Theme,
    }),
    ...(updateFields.locale !== undefined && {
      locale: updateFields.locale.toUpperCase() as Locale,
    }),
    ...(updateFields.defaultLaborMode !== undefined && {
      defaultLaborMode: updateFields.defaultLaborMode as LaborMode,
    }),
    ...(updateFields.defaultOverheadPct !== undefined && {
      defaultOverheadPct: updateFields.defaultOverheadPct,
    }),
    ...(updateFields.defaultProfitPct !== undefined && {
      defaultProfitPct: updateFields.defaultProfitPct,
    }),
    version: { increment: 1 },
  };

  const updated = await db.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      theme: createTheme,
      locale: createLocale,
      defaultLaborMode: createLaborMode,
      defaultOverheadPct: updateFields.defaultOverheadPct ?? "10",
      defaultProfitPct: updateFields.defaultProfitPct ?? "15",
    },
    update: updateData,
  });

  await writeAuditLog({
    action: "update",
    entityType: "UserSettings",
    entityId: userId,
    afterJson: updated,
  });

  return json(updated);
});
