/**
 * Settings — shared zod schemas (platform-agnostic — pure TypeScript + zod).
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types + zod.
 * Used by: src/app/api/settings/ (request validation).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma, fs, etc.
 *
 * Enum-value casing note (per ERD_V1.1_WEB entities & SPEC_PHASE1_BOQ_WEB):
 *   - `theme` values are lowercase ("light"|"dark") — matches the
 *     `UserSettings` entity interface in @shared/entities. The Prisma `Theme`
 *     enum stores uppercase (LIGHT|DARK|SYSTEM); the API route handler
 *     transforms lowercase→uppercase on write.
 *   - `locale` values are lowercase ("en"|"ar") — same rationale; Prisma
 *     `Locale` enum stores EN|AR.
 *   - `defaultLaborMode` values are uppercase ("CONSUMPTION"|"CREW") — matches
 *     the Prisma enum verbatim and the entity type `RateAnalysisLaborMode`.
 */

import { z } from "zod";

/**
 * User settings update input.
 *
 * All fields optional — PATCH semantics. `expectedVersion` is the
 * optimistic-concurrency token (matches the `version` field on the
 * `UserSettings` row). The route handler uses `db.userSettings.upsert()`
 * so the row is created with defaults if it doesn't exist yet.
 */
export const UserSettingsUpdateSchema = z.object({
  theme: z.enum(["light", "dark"]).optional(),
  locale: z.enum(["en", "ar"]).optional(),
  defaultLaborMode: z.enum(["CONSUMPTION", "CREW"]).optional(),
  defaultOverheadPct: z.string().optional(),
  defaultProfitPct: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type UserSettingsUpdate = z.infer<typeof UserSettingsUpdateSchema>;

/**
 * Company profile update input.
 *
 * `nameEn` is required (matches Prisma `CompanyProfile.nameEn` non-null
 * constraint). All other fields are optional. The route handler uses
 * `db.companyProfile.upsert()` so the row is created if it doesn't exist.
 */
export const CompanyProfileUpdateSchema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().optional(),
  addressEn: z.string().optional(),
  addressAr: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  taxId: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type CompanyProfileUpdate = z.infer<typeof CompanyProfileUpdateSchema>;
