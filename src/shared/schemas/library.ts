/**
 * Library — shared zod schemas (platform-agnostic — pure TypeScript + zod).
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types + zod.
 * Used by: src/app/api/library/ (request validation).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma, fs, etc.
 */

import { z } from "zod";

/**
 * Library item scope (mirrors Prisma `ItemLibraryScope` enum).
 * - APP_GLOBAL:    shared catalog — visible to all users.
 * - USER_PRIVATE:  private to the owning user (ownerId set from session).
 */
export const LibraryItemScopeSchema = z.enum(["APP_GLOBAL", "USER_PRIVATE"]);
export type LibraryItemScope = z.infer<typeof LibraryItemScopeSchema>;

/**
 * Library item search input.
 *
 * Query params validated by this schema drive the `IItemLibraryRepository.search`
 * call. `limit` and `offset` are coerced from URL query strings (always
 * strings on the wire) to numbers — zod's `coerce` handles the conversion
 * safely and surfaces a 400 on invalid input.
 */
export const LibraryItemSearchSchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  scope: LibraryItemScopeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LibraryItemSearch = z.infer<typeof LibraryItemSearchSchema>;

/**
 * Library item create input.
 *
 * `descriptionEn` is the only required field — everything else is optional
 * (mirrors the underlying Prisma `ItemLibrary` model where only
 * `descriptionEn` is non-null). `scope` defaults to APP_GLOBAL per F6 spec.
 */
export const LibraryItemCreateSchema = z.object({
  code: z.string().optional(),
  descriptionEn: z.string().min(1),
  descriptionAr: z.string().optional(),
  unitId: z.string().optional(),
  defaultSpecsEn: z.string().optional(),
  defaultSpecsAr: z.string().optional(),
  categoryId: z.string().optional(),
  scope: LibraryItemScopeSchema.default("APP_GLOBAL"),
});
export type LibraryItemCreate = z.infer<typeof LibraryItemCreateSchema>;

/**
 * Library item update input.
 *
 * All fields are optional — PATCH semantics. `expectedVersion` is the
 * optimistic-concurrency token: if provided and not matching the current
 * `version` on the row, the route returns 409 Conflict.
 *
 * The repository interface does not expose `update`; the route handler uses
 * Prisma directly (see src/app/api/library/[id]/route.ts).
 */
export const LibraryItemUpdateSchema = z.object({
  code: z.string().nullable().optional(),
  descriptionEn: z.string().min(1).optional(),
  descriptionAr: z.string().nullable().optional(),
  unitId: z.string().nullable().optional(),
  defaultSpecsEn: z.string().nullable().optional(),
  defaultSpecsAr: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type LibraryItemUpdate = z.infer<typeof LibraryItemUpdateSchema>;
