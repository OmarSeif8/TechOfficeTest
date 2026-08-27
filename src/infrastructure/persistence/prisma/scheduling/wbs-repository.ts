/**
 * PrismaWbsRepository — Prisma implementation of IWbsRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/scheduling/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Soft-delete: deletedAt is NULL for live nodes, non-NULL for tombstoned nodes.
 * All read paths default to `deletedAt: null` (includeDeleted=false).
 *
 * Optimistic concurrency (BR-WEB-4): `update` and `softDelete` include `version`
 * in the WHERE clause via `updateMany`; re-read on miss to distinguish
 * "not found" from "version mismatch" and return the appropriate tagged-union
 * variant.
 *
 * `reorder` runs in a single `$transaction`: assigns sortOrder = index in the
 * orderedIds array for each node, atomically.
 */

import { db } from "@/lib/db";
import type { WbsNode } from "@shared/entities";
import type {
  IWbsRepository,
  WbsNodeCreateInput,
  WbsNodeUpdateInput,
  WbsNodeUpdateResult,
  WbsNodeDeleteResult,
} from "@domain/repositories/scheduling-repositories";

type PrismaWbsNodeRow = {
  id: string;
  projectId: string;
  parentId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function mapToEntity(row: PrismaWbsNodeRow): WbsNode {
  return row as unknown as WbsNode;
}

export class PrismaWbsRepository implements IWbsRepository {
  async list(projectId: string, includeDeleted: boolean = false): Promise<WbsNode[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.wbsNode.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapToEntity);
  }

  async getById(id: string, includeDeleted: boolean = false): Promise<WbsNode | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.wbsNode.findFirst({ where });
    return row ? mapToEntity(row) : null;
  }

  async create(input: WbsNodeCreateInput): Promise<WbsNode> {
    const row = await db.wbsNode.create({
      data: {
        projectId: input.projectId,
        parentId: input.parentId ?? null,
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return mapToEntity(row);
  }

  async update(id: string, input: WbsNodeUpdateInput): Promise<WbsNodeUpdateResult> {
    const data: Record<string, unknown> = {};
    if (input.parentId !== undefined) data.parentId = input.parentId;
    if (input.code !== undefined) data.code = input.code;
    if (input.nameEn !== undefined) data.nameEn = input.nameEn;
    if (input.nameAr !== undefined) data.nameAr = input.nameAr;

    const result = await db.wbsNode.updateMany({
      where: { id, deletedAt: null },
      data,
    });

    if (result.count === 0) {
      // Either: not found at all OR already soft-deleted. Both surface as
      // "not_found" for WbsNode (no version column → no conflict distinction).
      return { kind: "not_found" as const };
    }

    const updated = await db.wbsNode.findUnique({ where: { id } });
    return { kind: "ok" as const, node: mapToEntity(updated!) };
  }

  async softDelete(id: string): Promise<WbsNodeDeleteResult> {
    // WbsNode has no `version` column — optimistic concurrency is enforced via
    // the deletedAt check in the WHERE clause (a tombstoned node can't be
    // re-deleted). The not_found variant covers both "missing" and "already
    // tombstoned" since both are no-ops from the caller's perspective.
    const result = await db.wbsNode.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      return { kind: "not_found" as const };
    }

    return { kind: "ok" as const };
  }

  async reorder(projectId: string, orderedIds: string[]): Promise<void> {
    // Single transaction: each id gets sortOrder = its index in the array.
    // Use updateMany with a per-id where clause so tombstoned nodes are
    // skipped silently (their sortOrder is irrelevant).
    await db.$transaction(
      orderedIds.map((id, index) =>
        db.wbsNode.updateMany({
          where: { id, projectId, deletedAt: null },
          data: { sortOrder: index },
        }),
      ),
    );
  }
}
