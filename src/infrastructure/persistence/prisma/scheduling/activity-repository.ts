/**
 * PrismaActivityRepository — Prisma implementation of IActivityRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/scheduling/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Optimistic concurrency (BR-WEB-4): Activity has a `version` column.
 * `update` and `softDelete` include `version: expectedVersion` in the WHERE
 * clause via `updateMany`; re-read on miss to distinguish "not found" from
 * "version mismatch" and return the appropriate tagged-union variant.
 *
 * ActivityRelationship has no `version` (it's immutable except for the
 * occasional bulk delete) — `createRelationship` and `deleteRelationship`
 * operate without version checks. The @unique([predecessorId, successorId, type])
 * constraint enforces one relationship per (pred, succ, type) triple (BR-P13
 * allows multiple relationships between the same pair only if type differs).
 */

import { db } from "@/lib/db";
import type {
  Activity,
  ActivityRelationship,
} from "@shared/entities";
import type {
  IActivityRepository,
  ActivityCreateInput,
  ActivityUpdateInput,
  ActivityUpdateResult,
  ActivityDeleteResult,
  RelationshipCreateInput,
} from "@domain/repositories/scheduling-repositories";

type PrismaActivityRow = {
  id: string;
  projectId: string;
  wbsNodeId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  duration: number;
  isMilestone: boolean;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type PrismaActivityRelationshipRow = {
  id: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: "FS" | "SS" | "FF" | "SF";
  lag: number;
  createdAt: Date;
  updatedAt: Date;
};

function mapActivity(row: PrismaActivityRow): Activity {
  return row as unknown as Activity;
}

function mapRelationship(row: PrismaActivityRelationshipRow): ActivityRelationship {
  return row as unknown as ActivityRelationship;
}

export class PrismaActivityRepository implements IActivityRepository {
  async list(projectId: string, includeDeleted: boolean = false): Promise<Activity[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.activity.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    return rows.map(mapActivity);
  }

  async getById(id: string, includeDeleted: boolean = false): Promise<Activity | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.activity.findFirst({ where });
    return row ? mapActivity(row) : null;
  }

  async create(input: ActivityCreateInput): Promise<Activity> {
    const row = await db.activity.create({
      data: {
        projectId: input.projectId,
        wbsNodeId: input.wbsNodeId ?? null,
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        duration: input.duration ?? 0,
        isMilestone: input.isMilestone ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return mapActivity(row);
  }

  async update(id: string, input: ActivityUpdateInput): Promise<ActivityUpdateResult> {
    const { expectedVersion, ...fields } = input;

    const data: Record<string, unknown> = {};
    if (fields.wbsNodeId !== undefined) data.wbsNodeId = fields.wbsNodeId;
    if (fields.code !== undefined) data.code = fields.code;
    if (fields.nameEn !== undefined) data.nameEn = fields.nameEn;
    if (fields.nameAr !== undefined) data.nameAr = fields.nameAr;
    if (fields.duration !== undefined) data.duration = fields.duration;
    if (fields.isMilestone !== undefined) data.isMilestone = fields.isMilestone;
    if (fields.sortOrder !== undefined) data.sortOrder = fields.sortOrder;

    const result = await db.activity.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.activity.findUnique({ where: { id } });
      if (!existing) {
        return { kind: "not_found" as const };
      }
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.activity.findUnique({ where: { id } });
    return { kind: "ok" as const, activity: mapActivity(updated!) };
  }

  async softDelete(id: string, expectedVersion: number): Promise<ActivityDeleteResult> {
    const result = await db.activity.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.activity.findUnique({ where: { id } });
      if (!existing) {
        return { kind: "not_found" as const };
      }
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    return { kind: "ok" as const };
  }

  // ─── Relationships ─────────────────────────────────────────────────────

  async listRelationships(projectId: string): Promise<ActivityRelationship[]> {
    const rows = await db.activityRelationship.findMany({
      where: { projectId },
      orderBy: [{ predecessorId: "asc" }, { successorId: "asc" }],
    });
    return rows.map(mapRelationship);
  }

  async createRelationship(input: RelationshipCreateInput): Promise<ActivityRelationship> {
    // The @unique([predecessorId, successorId, type]) constraint will throw
    // P2002 if a duplicate triple already exists. Callers that need
    // idempotent upsert should check existence first.
    const row = await db.activityRelationship.create({
      data: {
        projectId: input.projectId,
        predecessorId: input.predecessorId,
        successorId: input.successorId,
        type: input.type,
        lag: input.lag ?? 0,
      },
    });
    return mapRelationship(row);
  }

  async deleteRelationship(relationshipId: string): Promise<void> {
    // deleteMany + count check avoids the P2025 throw path on missing id.
    // Missing-id is a silent no-op — matches the "disposable" semantic.
    await db.activityRelationship.deleteMany({ where: { id: relationshipId } });
  }
}
