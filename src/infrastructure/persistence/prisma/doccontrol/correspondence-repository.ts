/**
 * PrismaCorrespondenceRepository — Prisma implementation of ICorrespondenceRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/doccontrol/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Optimistic concurrency (BR-WEB-4): Correspondence has a `version` column.
 *
 * TransmittalLine is a child of Correspondence (where type=TRANSMITTAL —
 * BR-DC10). The repository exposes `listTransmittalLines`, `addTransmittalLine`,
 * and `removeTransmittalLine`. The repository does NOT enforce type=TRANSMITTAL
 * on the parent — the API route does that defensive check before calling
 * addTransmittalLine (returns 422 if the parent is not a transmittal).
 *
 * TransmittalLine has no `version` (it's effectively append-only / removable);
 * `addTransmittalLine` and `removeTransmittalLine` operate without version
 * checks. removeTransmittalLine is a deleteMany + count-check (no-op if missing).
 */

import { db } from "@/lib/db";
import type { Correspondence, TransmittalLine } from "@shared/entities";
import type {
  ICorrespondenceRepository,
  CorrespondenceCreateInput,
  CorrespondenceUpdateInput,
  CorrespondenceUpdateResult,
  CorrespondenceDeleteResult,
  TransmittalLineCreateInput,
} from "@domain/repositories/doccontrol-repositories";

type PrismaCorrespondenceRow = {
  id: string;
  projectId: string;
  ref: string;
  direction: Correspondence["direction"];
  type: Correspondence["type"];
  date: string;
  subjectEn: string;
  subjectAr: string | null;
  fromParty: string;
  toParty: string;
  bodyEn: string | null;
  bodyAr: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type PrismaTransmittalLineRow = {
  id: string;
  transmittalId: string;
  docRef: string;
  descriptionEn: string;
  descriptionAr: string | null;
  copies: number;
  sortOrder: number;
};

function mapCorrespondence(row: PrismaCorrespondenceRow): Correspondence {
  return row as unknown as Correspondence;
}

function mapLine(row: PrismaTransmittalLineRow): TransmittalLine {
  return row as unknown as TransmittalLine;
}

export class PrismaCorrespondenceRepository implements ICorrespondenceRepository {
  async list(
    projectId: string,
    includeDeleted: boolean = false,
  ): Promise<Correspondence[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.correspondence.findMany({
      where,
      orderBy: [{ ref: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapCorrespondence(r as unknown as PrismaCorrespondenceRow));
  }

  async getById(
    id: string,
    includeDeleted: boolean = false,
  ): Promise<Correspondence | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.correspondence.findFirst({ where });
    return row ? mapCorrespondence(row as unknown as PrismaCorrespondenceRow) : null;
  }

  async create(input: CorrespondenceCreateInput): Promise<Correspondence> {
    const row = await db.correspondence.create({
      data: {
        projectId: input.projectId,
        ref: input.ref,
        direction: input.direction,
        type: input.type,
        date: input.date,
        subjectEn: input.subjectEn,
        subjectAr: input.subjectAr ?? null,
        fromParty: input.fromParty,
        toParty: input.toParty,
        bodyEn: input.bodyEn ?? null,
        bodyAr: input.bodyAr ?? null,
      },
    });
    return mapCorrespondence(row as unknown as PrismaCorrespondenceRow);
  }

  async update(
    id: string,
    input: CorrespondenceUpdateInput,
  ): Promise<CorrespondenceUpdateResult> {
    const { expectedVersion, ...fields } = input;

    const data: Record<string, unknown> = {};
    if (fields.type !== undefined) data.type = fields.type;
    if (fields.date !== undefined) data.date = fields.date;
    if (fields.subjectEn !== undefined) data.subjectEn = fields.subjectEn;
    if (fields.subjectAr !== undefined) data.subjectAr = fields.subjectAr;
    if (fields.fromParty !== undefined) data.fromParty = fields.fromParty;
    if (fields.toParty !== undefined) data.toParty = fields.toParty;
    if (fields.bodyEn !== undefined) data.bodyEn = fields.bodyEn;
    if (fields.bodyAr !== undefined) data.bodyAr = fields.bodyAr;

    const result = await db.correspondence.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.correspondence.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.correspondence.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      correspondence: mapCorrespondence(updated as unknown as PrismaCorrespondenceRow),
    };
  }

  async softDelete(
    id: string,
    expectedVersion: number,
  ): Promise<CorrespondenceDeleteResult> {
    const result = await db.correspondence.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.correspondence.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    return { kind: "ok" as const };
  }

  async listTransmittalLines(transmittalId: string): Promise<TransmittalLine[]> {
    const rows = await db.transmittalLine.findMany({
      where: { transmittalId },
      orderBy: [{ sortOrder: "asc" }, { docRef: "asc" }],
    });
    return rows.map((r) => mapLine(r as unknown as PrismaTransmittalLineRow));
  }

  async addTransmittalLine(
    input: TransmittalLineCreateInput,
  ): Promise<TransmittalLine> {
    const row = await db.transmittalLine.create({
      data: {
        transmittalId: input.transmittalId,
        docRef: input.docRef,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr ?? null,
        copies: input.copies ?? 1,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return mapLine(row as unknown as PrismaTransmittalLineRow);
  }

  async removeTransmittalLine(lineId: string): Promise<void> {
    // deleteMany + count check avoids P2025 throw on missing id.
    // Missing-id is a silent no-op (matches disposable semantic).
    await db.transmittalLine.deleteMany({ where: { id: lineId } });
  }
}
