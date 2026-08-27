/**
 * PrismaRfiRepository — Prisma implementation of IRfiRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/doccontrol/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Optimistic concurrency (BR-WEB-4): Rfi has a `version` column.
 *
 * RfiEvent is append-only (BR-DC8). The repository exposes `addEvent` (insert)
 * + `listEvents` (read) — there is no update or delete on events.
 *
 * `answer()` is an atomic update: sets answerEn/answerAr/answerDate + status=ANSWERED
 * in one updateMany call (with the expectedVersion guard). The API route then
 * writes the RfiEvent for this transition separately.
 *
 * `linkedDrawingId` is intentionally a loose String? (no Prisma relation) —
 * drawings can be deleted independently; the RFI keeps the historical link.
 */

import { db } from "@/lib/db";
import type { Rfi, RfiEvent } from "@shared/entities";
import type {
  IRfiRepository,
  RfiCreateInput,
  RfiUpdateInput,
  RfiUpdateResult,
  RfiDeleteResult,
  RfiEventCreateInput,
  RfiAnswerInput,
  RfiAnswerResult,
} from "@domain/repositories/doccontrol-repositories";

type PrismaRfiRow = {
  id: string;
  projectId: string;
  ref: string;
  questionEn: string;
  questionAr: string | null;
  linkedDrawingId: string | null;
  sentDate: string | null;
  reviewPeriodDays: number;
  answerEn: string | null;
  answerAr: string | null;
  answerDate: string | null;
  status: Rfi["status"];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type PrismaRfiEventRow = {
  id: string;
  rfiId: string;
  fromStatus: Rfi["status"] | null;
  toStatus: Rfi["status"];
  note: string | null;
  eventDate: string;
  createdByUserId: string;
  createdAt: Date;
};

function mapRfi(row: PrismaRfiRow): Rfi {
  return row as unknown as Rfi;
}

function mapEvent(row: PrismaRfiEventRow): RfiEvent {
  return row as unknown as RfiEvent;
}

export class PrismaRfiRepository implements IRfiRepository {
  async list(projectId: string, includeDeleted: boolean = false): Promise<Rfi[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.rfi.findMany({
      where,
      orderBy: [{ ref: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapRfi(r as unknown as PrismaRfiRow));
  }

  async getById(id: string, includeDeleted: boolean = false): Promise<Rfi | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.rfi.findFirst({ where });
    return row ? mapRfi(row as unknown as PrismaRfiRow) : null;
  }

  async create(input: RfiCreateInput): Promise<Rfi> {
    const row = await db.rfi.create({
      data: {
        projectId: input.projectId,
        ref: input.ref,
        questionEn: input.questionEn,
        questionAr: input.questionAr ?? null,
        linkedDrawingId: input.linkedDrawingId ?? null,
        sentDate: input.sentDate ?? null,
        reviewPeriodDays: input.reviewPeriodDays ?? 7, // BR-DC6 default
        status: input.status ?? "OPEN",
      },
    });
    return mapRfi(row as unknown as PrismaRfiRow);
  }

  async update(id: string, input: RfiUpdateInput): Promise<RfiUpdateResult> {
    const { expectedVersion, ...fields } = input;

    const data: Record<string, unknown> = {};
    if (fields.questionEn !== undefined) data.questionEn = fields.questionEn;
    if (fields.questionAr !== undefined) data.questionAr = fields.questionAr;
    if (fields.linkedDrawingId !== undefined) data.linkedDrawingId = fields.linkedDrawingId;
    if (fields.sentDate !== undefined) data.sentDate = fields.sentDate;
    if (fields.reviewPeriodDays !== undefined) data.reviewPeriodDays = fields.reviewPeriodDays;

    const result = await db.rfi.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.rfi.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.rfi.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      rfi: mapRfi(updated as unknown as PrismaRfiRow),
    };
  }

  async softDelete(id: string, expectedVersion: number): Promise<RfiDeleteResult> {
    const result = await db.rfi.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.rfi.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    return { kind: "ok" as const };
  }

  async addEvent(input: RfiEventCreateInput): Promise<RfiEvent> {
    const row = await db.rfiEvent.create({
      data: {
        rfiId: input.rfiId,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        note: input.note ?? null,
        eventDate: input.eventDate,
        createdByUserId: input.createdByUserId,
      },
    });
    return mapEvent(row as unknown as PrismaRfiEventRow);
  }

  async listEvents(rfiId: string): Promise<RfiEvent[]> {
    const rows = await db.rfiEvent.findMany({
      where: { rfiId },
      orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapEvent(r as unknown as PrismaRfiEventRow));
  }

  async answer(id: string, input: RfiAnswerInput): Promise<RfiAnswerResult> {
    const result = await db.rfi.updateMany({
      where: { id, version: input.expectedVersion, deletedAt: null },
      data: {
        answerEn: input.answerEn,
        answerAr: input.answerAr ?? null,
        answerDate: input.answerDate,
        status: "ANSWERED",
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const existing = await db.rfi.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.rfi.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      rfi: mapRfi(updated as unknown as PrismaRfiRow),
    };
  }
}
