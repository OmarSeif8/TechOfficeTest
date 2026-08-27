/**
 * PrismaProjectRepository — Prisma implementation of IProjectRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/ (server-only). Per
 * CONSTITUTION_V1.1_WEB §3.3, this is the layer that knows about Prisma.
 * The domain layer sees only the IProjectRepository interface.
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Optimistic concurrency (BR-WEB-4): every mutation includes `version` in the
 * WHERE clause via `updateMany`. If 0 rows match, we re-read the row to
 * distinguish "not found" from "version mismatch" and return the appropriate
 * tagged-union variant — the caller decides whether to retry or surface to
 * the user.
 *
 * Soft-delete: deletedAt is NULL for live rows, non-NULL for tombstoned rows.
 * All read paths default to `deletedAt: null` (includeDeleted=false). Restore
 * is an admin operation that does NOT version-check.
 */

import { db } from "@/lib/db";
import type { Project } from "@shared/entities";
import type {
  IProjectRepository,
  ProjectListOptions,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectUpdateResult,
  ProjectDeleteResult,
} from "@domain/repositories";

/**
 * Default currency used when `create()` is called without an explicit
 * `currency` value. Matches the Prisma schema default ("USD").
 * Duplicated here so the application layer doesn't depend on the schema
 * default being correct — defensive.
 */
const DEFAULT_CURRENCY = "USD";

/**
 * Map a Prisma Project row to the @shared/entities Project type.
 *
 * The shapes are structurally identical (the schema mirrors the entity), but
 * TypeScript treats Prisma's generated types and our hand-written interfaces
 * as nominally different. We cast through `unknown` to satisfy the compiler
 * without an explicit mapping of every field. If the schema ever diverges
 * from the entity (e.g., Prisma returns a Decimal where the entity expects a
 * string), this is the single place to fix it.
 */
function mapToEntity(row: {
  id: string;
  ownerId: string;
  nameEn: string;
  nameAr: string | null;
  clientEn: string | null;
  clientAr: string | null;
  locationEn: string | null;
  locationAr: string | null;
  contractNo: string | null;
  currency: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): Project {
  return row as unknown as Project;
}

/**
 * Build the Prisma `where` clause shared by `list()` and `count()`.
 *
 * - `ownerId`: exact match.
 * - `includeDeleted`: false (default) → `deletedAt: null`; true → no filter.
 * - `search`: substring across nameEn | nameAr | clientEn | clientAr |
 *   contractNo. The Prisma SQLite provider does NOT accept `mode: 'insensitive'`
 *   (it throws a validation error at runtime). However, SQLite's LIKE-based
 *   `contains` is already case-insensitive for ASCII text by default, so
 *   plain `contains` gives the desired behavior on SQLite. If the project
 *   ever migrates to Postgres/MySQL, add `mode: 'insensitive'` back (or use
 *   a provider-detection branch).
 */
function buildWhereClause(options: ProjectListOptions): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (options.ownerId !== undefined) {
    where.ownerId = options.ownerId;
  }

  if (!options.includeDeleted) {
    where.deletedAt = null;
  }

  if (options.search !== undefined && options.search.trim() !== "") {
    const term = options.search.trim();
    where.OR = [
      { nameEn: { contains: term } },
      { nameAr: { contains: term } },
      { clientEn: { contains: term } },
      { clientAr: { contains: term } },
      { contractNo: { contains: term } },
    ];
  }

  return where;
}

export class PrismaProjectRepository implements IProjectRepository {
  /**
   * Paginated list with optional filters. Ordered by `updatedAt DESC` so
   * recently-touched projects surface first.
   */
  async list(options: ProjectListOptions): Promise<Project[]> {
    const where = buildWhereClause(options);
    const rows = await db.project.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(mapToEntity);
  }

  /**
   * Count matching the same filters as `list()` but without pagination.
   * Use this for pagination UIs ("Showing 1-20 of 137").
   */
  async count(options: ProjectListOptions): Promise<number> {
    const where = buildWhereClause(options);
    return db.project.count({ where });
  }

  /**
   * Fetch by id. Excludes soft-deleted rows by default; pass
   * `includeDeleted=true` to read tombstoned rows (admin tooling).
   */
  async getById(id: string, includeDeleted: boolean = false): Promise<Project | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) {
      where.deletedAt = null;
    }
    const row = await db.project.findFirst({ where });
    return row ? mapToEntity(row) : null;
  }

  /**
   * Create a new project. Currency defaults to USD if not provided.
   * The Prisma schema also defaults currency to "USD", but specifying
   * it explicitly here makes the application-layer default visible and
   * immune to a future schema default change.
   */
  async create(input: ProjectCreateInput): Promise<Project> {
    const row = await db.project.create({
      data: {
        ownerId: input.ownerId,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        clientEn: input.clientEn ?? null,
        clientAr: input.clientAr ?? null,
        locationEn: input.locationEn ?? null,
        locationAr: input.locationAr ?? null,
        contractNo: input.contractNo ?? null,
        currency: input.currency ?? DEFAULT_CURRENCY,
      },
    });
    return mapToEntity(row);
  }

  /**
   * Update a project with optimistic concurrency (BR-WEB-4).
   *
   * The WHERE clause includes `version: input.expectedVersion` and
   * `deletedAt: null` (soft-deleted rows can't be updated). If 0 rows
   * match, we re-read the row to distinguish:
   *   - not_found   → row doesn't exist at all
   *   - conflict    → row exists but version differs (or is soft-deleted)
   *
   * On success, version is atomically incremented and the updated row is
   * returned.
   *
   * Implementation note: `updateMany` is used (not a `$transaction` of
   * findUnique+update) because `updateMany` performs the version check
   * atomically in a single SQL statement — there is no read-modify-write
   * window where a concurrent writer could sneak in. The extra `findUnique`
   * on the failure path is read-only and only happens on the unhappy path,
   * so the cost is negligible.
   */
  async update(id: string, input: ProjectUpdateInput): Promise<ProjectUpdateResult> {
    // Strip expectedVersion — it's part of the WHERE, not the SET.
    const { expectedVersion, ...fields } = input;

    // Build the SET data — only include fields the caller actually provided.
    // This lets partial updates work (e.g., just renaming the project) without
    // nulling out unrelated fields. Undefined values are skipped by Prisma
    // automatically, but we filter explicitly to be defensive.
    const data: Record<string, unknown> = {};
    if (fields.nameEn !== undefined) data.nameEn = fields.nameEn;
    if (fields.nameAr !== undefined) data.nameAr = fields.nameAr;
    if (fields.clientEn !== undefined) data.clientEn = fields.clientEn;
    if (fields.clientAr !== undefined) data.clientAr = fields.clientAr;
    if (fields.locationEn !== undefined) data.locationEn = fields.locationEn;
    if (fields.locationAr !== undefined) data.locationAr = fields.locationAr;
    if (fields.contractNo !== undefined) data.contractNo = fields.contractNo;
    if (fields.currency !== undefined) data.currency = fields.currency;

    const result = await db.project.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      // Either: not found, soft-deleted, OR version mismatch. Re-read to
      // disambiguate.
      const existing = await db.project.findUnique({ where: { id } });
      if (!existing) {
        return { kind: "not_found" as const };
      }
      // Row exists — the miss must be a version mismatch OR a soft-delete.
      // Both surface as "conflict" with the current version so the caller can
      // re-fetch and retry. (For soft-deleted rows, the currentVersion is the
      // tombstoned row's last version; the caller should treat this as
      // "conflict, please refresh and notice the project is deleted".)
      return {
        kind: "conflict" as const,
        currentVersion: existing.version,
      };
    }

    const updated = await db.project.findUnique({ where: { id } });
    return { kind: "ok" as const, project: mapToEntity(updated!) };
  }

  /**
   * Soft-delete a project: set `deletedAt = now()` with optimistic
   * concurrency. Same pattern as `update()` — `updateMany` with version in
   * the WHERE, re-read on miss to disambiguate.
   */
  async softDelete(id: string, expectedVersion: number): Promise<ProjectDeleteResult> {
    const result = await db.project.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.project.findUnique({ where: { id } });
      if (!existing) {
        return { kind: "not_found" as const };
      }
      return {
        kind: "conflict" as const,
        currentVersion: existing.version,
      };
    }

    return { kind: "ok" as const };
  }

  /**
   * Restore a soft-deleted project. NO version check — this is an admin
   * operation. Returns the restored Project, or null if the id doesn't exist
   * (regardless of whether it was already live or never existed).
   *
   * Note: we use `updateMany` (with no version clause) rather than `update`
   * because `update` throws P2025 when the row doesn't exist. `updateMany`
   * returns count=0 in that case, which we translate to null. This avoids
   * a try/catch + P2025 inspection pattern.
   */
  async restore(id: string): Promise<Project | null> {
    const result = await db.project.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null },
    });

    if (result.count === 0) {
      // Either: not found at all, or already live (deletedAt is null).
      // Re-read: if it exists and is now live, return it; otherwise null.
      const existing = await db.project.findUnique({ where: { id } });
      return existing && existing.deletedAt === null ? mapToEntity(existing) : null;
    }

    const restored = await db.project.findUnique({ where: { id } });
    return restored ? mapToEntity(restored) : null;
  }
}
