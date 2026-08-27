/**
 * PrismaSubmittalRepository — Prisma implementation of ISubmittalRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/doccontrol/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Optimistic concurrency (BR-WEB-4): Submittal has a `version` column.
 * `update` and `softDelete` include `version: expectedVersion` in the WHERE
 * clause via `updateMany`; re-read on miss to distinguish "not found" from
 * "version mismatch" and return the appropriate tagged-union variant.
 *
 * SubmittalEvent is append-only (BR-DC8). The repository exposes `addEvent`
 * (insert) + `listEvents` (read) — there is no update or delete on events.
 *
 * The repository does NOT compute ref numbers or due dates — those live in
 * the pure domain module @domain/doccontrol/{numbering,overdue}. The API route
 * calls nextSubmittalRef() before create(), and calls calculateDueDate() if it
 * needs to expose the due date to the UI.
 */

import { db } from "@/lib/db";
import type { Submittal, SubmittalEvent } from "@shared/entities";
import type {
  ISubmittalRepository,
  SubmittalCreateInput,
  SubmittalUpdateInput,
  SubmittalUpdateResult,
  SubmittalDeleteResult,
  SubmittalEventCreateInput,
} from "@domain/repositories/doccontrol-repositories";

type PrismaSubmittalRow = {
  id: string;
  projectId: string;
  ref: string;
  subjectEn: string;
  subjectAr: string | null;
  type: Submittal["type"];
  discipline: Submittal["discipline"];
  submittedDate: string | null;
  reviewPeriodDays: number;
  resubmissionNo: number;
  status: Submittal["status"];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type PrismaSubmittalEventRow = {
  id: string;
  submittalId: string;
  fromStatus: Submittal["status"] | null;
  toStatus: Submittal["status"];
  note: string | null;
  eventDate: string;
  createdByUserId: string;
  createdAt: Date;
};

function mapSubmittal(row: PrismaSubmittalRow): Submittal {
  return row as unknown as Submittal;
}

function mapEvent(row: PrismaSubmittalEventRow): SubmittalEvent {
  return row as unknown as SubmittalEvent;
}

export class PrismaSubmittalRepository implements ISubmittalRepository {
  async list(projectId: string, includeDeleted: boolean = false): Promise<Submittal[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.submittal.findMany({
      where,
      orderBy: [{ ref: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapSubmittal(r as unknown as PrismaSubmittalRow));
  }

  async getById(id: string, includeDeleted: boolean = false): Promise<Submittal | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.submittal.findFirst({ where });
    return row ? mapSubmittal(row as unknown as PrismaSubmittalRow) : null;
  }

  async create(input: SubmittalCreateInput): Promise<Submittal> {
    const row = await db.submittal.create({
      data: {
        projectId: input.projectId,
        ref: input.ref,
        subjectEn: input.subjectEn,
        subjectAr: input.subjectAr ?? null,
        type: input.type,
        discipline: input.discipline,
        submittedDate: input.submittedDate ?? null,
        reviewPeriodDays: input.reviewPeriodDays ?? 14, // BR-DC6 default
        resubmissionNo: input.resubmissionNo ?? 0,
        status: input.status ?? "DRAFT",
      },
    });
    return mapSubmittal(row as unknown as PrismaSubmittalRow);
  }

  async update(id: string, input: SubmittalUpdateInput): Promise<SubmittalUpdateResult> {
    const { expectedVersion, ...fields } = input;

    const data: Record<string, unknown> = {};
    if (fields.subjectEn !== undefined) data.subjectEn = fields.subjectEn;
    if (fields.subjectAr !== undefined) data.subjectAr = fields.subjectAr;
    if (fields.type !== undefined) data.type = fields.type;
    if (fields.discipline !== undefined) data.discipline = fields.discipline;
    if (fields.submittedDate !== undefined) data.submittedDate = fields.submittedDate;
    if (fields.reviewPeriodDays !== undefined) data.reviewPeriodDays = fields.reviewPeriodDays;
    if (fields.resubmissionNo !== undefined) data.resubmissionNo = fields.resubmissionNo;
    if (fields.status !== undefined) data.status = fields.status;

    const result = await db.submittal.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.submittal.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.submittal.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      submittal: mapSubmittal(updated as unknown as PrismaSubmittalRow),
    };
  }

  async softDelete(id: string, expectedVersion: number): Promise<SubmittalDeleteResult> {
    const result = await db.submittal.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.submittal.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    return { kind: "ok" as const };
  }

  async addEvent(input: SubmittalEventCreateInput): Promise<SubmittalEvent> {
    const row = await db.submittalEvent.create({
      data: {
        submittalId: input.submittalId,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        note: input.note ?? null,
        eventDate: input.eventDate,
        createdByUserId: input.createdByUserId,
      },
    });
    return mapEvent(row as unknown as PrismaSubmittalEventRow);
  }

  async listEvents(submittalId: string): Promise<SubmittalEvent[]> {
    const rows = await db.submittalEvent.findMany({
      where: { submittalId },
      orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapEvent(r as unknown as PrismaSubmittalEventRow));
  }
}
