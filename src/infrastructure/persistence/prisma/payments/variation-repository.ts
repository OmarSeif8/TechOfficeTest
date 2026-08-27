/**
 * PrismaVariationRepository — Prisma implementation of IVariationRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/payments/ (server-only).
 *
 * Layer purity: same as payment-repository.ts.
 *
 * Optimistic concurrency (BR-WEB-4): Variation has a `version` column.
 * `update` / `softDelete` / `approve` all use the version-where pattern.
 *
 * `approve` is a specialised update that atomically transitions status → APPROVED
 * and sets approvedValue. Other transitions (DRAFT → SUBMITTED, etc.) go through
 * `update` with a `status` field.
 */

import { db } from "@/lib/db";
import type { Variation, VariationStatus } from "@shared/entities";
import type {
  IVariationRepository,
  VariationCreateInput,
  VariationUpdateInput,
  VariationApproveInput,
  VariationUpdateResult,
  VariationDeleteResult,
} from "@domain/repositories/payments-repositories";

type PrismaVariationRow = {
  id: string;
  projectId: string;
  boqDocumentId: string | null;
  ref: string;
  titleEn: string;
  titleAr: string | null;
  status: VariationStatus;
  approvedValue: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function mapVariation(row: PrismaVariationRow): Variation {
  return row as unknown as Variation;
}

export class PrismaVariationRepository implements IVariationRepository {
  async list(projectId: string, includeDeleted: boolean = false): Promise<Variation[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.variation.findMany({
      where,
      orderBy: [{ ref: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapVariation(r as unknown as PrismaVariationRow));
  }

  async getById(id: string, includeDeleted: boolean = false): Promise<Variation | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.variation.findFirst({ where });
    return row ? mapVariation(row as unknown as PrismaVariationRow) : null;
  }

  async create(input: VariationCreateInput): Promise<Variation> {
    const row = await db.variation.create({
      data: {
        projectId: input.projectId,
        boqDocumentId: input.boqDocumentId ?? null,
        ref: input.ref,
        titleEn: input.titleEn,
        titleAr: input.titleAr ?? null,
        status: input.status ?? "DRAFT",
        approvedValue: input.approvedValue ?? null,
      },
    });
    return mapVariation(row as unknown as PrismaVariationRow);
  }

  async update(id: string, input: VariationUpdateInput): Promise<VariationUpdateResult> {
    const { expectedVersion, ...fields } = input;

    const data: Record<string, unknown> = {};
    if (fields.boqDocumentId !== undefined) data.boqDocumentId = fields.boqDocumentId;
    if (fields.ref !== undefined) data.ref = fields.ref;
    if (fields.titleEn !== undefined) data.titleEn = fields.titleEn;
    if (fields.titleAr !== undefined) data.titleAr = fields.titleAr;
    if (fields.status !== undefined) data.status = fields.status;
    if (fields.approvedValue !== undefined) data.approvedValue = fields.approvedValue;

    const result = await db.variation.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.variation.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.variation.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      variation: mapVariation(updated as unknown as PrismaVariationRow),
    };
  }

  async softDelete(id: string, expectedVersion: number): Promise<VariationDeleteResult> {
    const result = await db.variation.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.variation.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    return { kind: "ok" as const };
  }

  async approve(id: string, input: VariationApproveInput): Promise<VariationUpdateResult> {
    const result = await db.variation.updateMany({
      where: { id, version: input.expectedVersion, deletedAt: null },
      data: {
        status: "APPROVED" as VariationStatus,
        approvedValue: input.approvedValue,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const existing = await db.variation.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.variation.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      variation: mapVariation(updated as unknown as PrismaVariationRow),
    };
  }
}
