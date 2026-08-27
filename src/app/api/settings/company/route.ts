/**
 * GET   /api/settings/company   — return the CompanyProfile for the current user (or null)
 * PATCH /api/settings/company   — upsert the CompanyProfile for the current user
 *
 * Per BR-WEB-5: requires an authenticated session.
 * Per BR-WEB-8: PATCH writes an AuditLog entry on success.
 * Per BR-WEB-11: PATCH body validated by `CompanyProfileUpdateSchema`.
 *
 * Optimistic concurrency on PATCH: if `expectedVersion` is provided and
 * doesn't match the current `version` on the existing row, returns 409.
 *
 * Layer purity: top of the stack — App Router route handler.
 */

import { NextRequest } from "next/server";
import {
  withErrorHandler,
  json,
  conflict,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { CompanyProfileUpdateSchema } from "@shared/schemas/settings";

/**
 * GET /api/settings/company
 *
 * Returns the CompanyProfile row for the current user, or `null` if none
 * exists yet.
 */
export const GET = withErrorHandler(async () => {
  const userId = await requireUserId();
  const company = await db.companyProfile.findUnique({ where: { userId } });
  return json(company);
});

/**
 * PATCH /api/settings/company
 *
 * Upsert the CompanyProfile for the current user. If a row exists, update it
 * (incrementing `version`); if not, create it with the provided values.
 *
 * Returns the upserted CompanyProfile row.
 */
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const userId = await requireUserId();
  const body = CompanyProfileUpdateSchema.parse(await req.json());
  const { expectedVersion, ...updateFields } = body;

  // Optimistic concurrency check (only when a row exists).
  if (expectedVersion !== undefined) {
    const existing = await db.companyProfile.findUnique({ where: { userId } });
    if (existing && existing.version !== expectedVersion) {
      return conflict(
        "Version mismatch — company profile was modified by another request",
        existing.version,
      );
    }
  }

  const updated = await db.companyProfile.upsert({
    where: { userId },
    create: {
      userId,
      nameEn: updateFields.nameEn,
      nameAr: updateFields.nameAr ?? null,
      addressEn: updateFields.addressEn ?? null,
      addressAr: updateFields.addressAr ?? null,
      phone: updateFields.phone ?? null,
      email: updateFields.email ?? null,
      taxId: updateFields.taxId ?? null,
    },
    update: {
      nameEn: updateFields.nameEn,
      nameAr: updateFields.nameAr,
      addressEn: updateFields.addressEn,
      addressAr: updateFields.addressAr,
      phone: updateFields.phone,
      email: updateFields.email,
      taxId: updateFields.taxId,
      version: { increment: 1 },
    },
  });

  await writeAuditLog({
    action: "update",
    entityType: "CompanyProfile",
    entityId: userId,
    afterJson: updated,
  });

  return json(updated);
});
