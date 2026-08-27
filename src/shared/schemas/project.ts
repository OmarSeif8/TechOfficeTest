/**
 * Project — shared zod schemas (platform-agnostic — pure TypeScript + zod).
 *
 * Lives in src/shared/ (lowest layer). Imports only stdlib types + zod.
 * Used by: src/app/api/projects/ (request validation), src/services/ (validation),
 *          src/infrastructure/persistence/prisma/project-repository.ts (input shape).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma, fs, etc.
 *
 * These schemas back the Project CRUD API (WO-W-9):
 *   - ProjectCreateSchema:  POST /api/projects
 *   - ProjectUpdateSchema:  PATCH /api/projects/[id]  (includes expectedVersion for BR-WEB-4)
 *   - ProjectDeleteSchema:  DELETE /api/projects/[id] (body: { expectedVersion })
 *   - ProjectListQuerySchema: GET /api/projects query-string params
 *
 * Per BR-WEB-4 (optimistic concurrency): every mutation carries `expectedVersion`,
 * which the repository checks atomically against the row's `version` column.
 */

import { z } from "zod";

/**
 * Default currency (mirrors the Prisma schema default + repository default).
 * Duplicated here so the API-layer default is visible and immune to a future
 * schema default change.
 */
const DEFAULT_CURRENCY = "USD";

/**
 * Project create input — POST /api/projects.
 *
 * `ownerId` is NOT accepted from the body — the API route injects it from the
 * authenticated session (BR-WEB-5: a user can only create projects they own).
 * The repository's `ProjectCreateInput` requires `ownerId`, so the route
 * composes `{ ownerId: userId, ...parsedBody }` before calling `create()`.
 *
 * `currency` defaults to "USD" if omitted (BR-1: strings for all money codes;
 * we don't validate against an ISO-4217 list here — that's a future hardening
 * concern, tracked separately).
 */
export const ProjectCreateSchema = z.object({
  nameEn: z.string().min(1, "nameEn is required"),
  nameAr: z.string().optional(),
  clientEn: z.string().optional(),
  clientAr: z.string().optional(),
  locationEn: z.string().optional(),
  locationAr: z.string().optional(),
  contractNo: z.string().optional(),
  currency: z.string().default(DEFAULT_CURRENCY),
});

export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

/**
 * Project update input — PATCH /api/projects/[id].
 *
 * All fields are optional (partial update). `expectedVersion` is REQUIRED
 * (BR-WEB-4: optimistic concurrency — the caller must have read the current
 * version before writing). The repository uses it as part of the WHERE
 * clause; if 0 rows match, the result distinguishes "not_found" vs "conflict".
 *
 * Note: zod's `.optional()` makes a field `{ value: T } | undefined`, while
 * `.nullable()` makes it `T | null`. We use `.optional()` here for the
 * absence-of-value semantics: a field omitted from the PATCH body means
 * "don't change this field" (the repository skips undefined fields). A field
 * explicitly set to `null` means "clear this field" — but our zod schemas
 * don't allow null on update inputs (mirroring the create shape). Clearing
 * an optional field would require a sentinel or `.nullable().optional()`;
 * that's deferred to a future hardening task.
 */
export const ProjectUpdateSchema = z.object({
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().optional(),
  clientEn: z.string().optional(),
  clientAr: z.string().optional(),
  locationEn: z.string().optional(),
  locationAr: z.string().optional(),
  contractNo: z.string().optional(),
  currency: z.string().optional(),
  expectedVersion: z.number().int().positive(),
});

export type ProjectUpdateInput = z.infer<typeof ProjectUpdateSchema>;

/**
 * Project delete input — DELETE /api/projects/[id].
 *
 * Body: `{ expectedVersion: number }`. Same optimistic-concurrency semantics
 * as ProjectUpdateSchema — the caller must have read the current version
 * before deleting. Soft-delete sets `deletedAt = now()` and bumps `version`.
 */
export const ProjectDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export type ProjectDeleteInput = z.infer<typeof ProjectDeleteSchema>;

/**
 * Project list query params — GET /api/projects.
 *
 * - `search`: substring across nameEn | nameAr | clientEn | clientAr | contractNo
 *   (the repository builds the OR clause).
 * - `limit`: page size, clamped to [1, 100]. Default 20.
 * - `offset`: zero-based pagination offset. Default 0.
 *
 * The ownerId filter is NOT accepted from the query string — the API route
 * injects it from the authenticated session (BR-WEB-5: a user can only list
 * their own projects).
 */
export const ProjectListQuerySchema = z.object({
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
