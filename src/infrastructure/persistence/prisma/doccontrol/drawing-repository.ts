/**
 * PrismaDrawingRepository — Prisma implementation of IDrawingRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/doccontrol/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Optimistic concurrency (BR-WEB-4): Drawing has a `version` column.
 * `update` and `softDelete` include `version: expectedVersion` in the WHERE
 * clause via `updateMany`; re-read on miss to distinguish "not found" from
 * "version mismatch" and return the appropriate tagged-union variant.
 *
 * DrawingRevision + DrawingRevisionEvent are append-only (BR-DC3, BR-DC8).
 * The repository does NOT auto-supersede — that orchestration lives in the API
 * route (W3-6) which calls `applyRevisionSuperseded` + `nextRevisionLetter`
 * from @domain/doccontrol/. The repository exposes the primitives:
 *   - addRevision (insert new revision row)
 *   - setRevisionStatus (used to mark old revision as SUPERSEDED)
 *   - setCurrentRevision (patch Drawing.currentRevisionId)
 *   - addEvent (insert event log row)
 *
 * `currentRevisionId` is intentionally a loose String? (no Prisma relation) —
 * the API route assigns it via setCurrentRevision after addRevision. This
 * keeps the relation model simple (DrawingRevision.drawingId → Drawing is
 * the only structural FK).
 */

import { db } from "@/lib/db";
import type {
  Drawing,
  DrawingRevision,
  DrawingRevisionEvent,
  DrawingStatus,
} from "@shared/entities";
import type {
  IDrawingRepository,
  DrawingCreateInput,
  DrawingUpdateInput,
  DrawingUpdateResult,
  DrawingDeleteResult,
  DrawingRevisionCreateInput,
  DrawingRevisionEventCreateInput,
} from "@domain/repositories/doccontrol-repositories";

type PrismaDrawingRow = {
  id: string;
  projectId: string;
  code: string;
  titleEn: string;
  titleAr: string | null;
  discipline: Drawing["discipline"];
  currentRevisionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type PrismaDrawingRevisionRow = {
  id: string;
  drawingId: string;
  revision: string;
  status: DrawingStatus;
  revisionDate: string;
  fileUploadId: string | null;
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
};

type PrismaDrawingRevisionEventRow = {
  id: string;
  drawingId: string;
  revisionId: string;
  eventType: "REVISION_ADDED" | "STATUS_CHANGED" | "SUPERSEDED";
  fromStatus: DrawingStatus | null;
  toStatus: DrawingStatus;
  note: string | null;
  eventDate: string;
  createdByUserId: string;
  createdAt: Date;
};

function mapDrawing(row: PrismaDrawingRow): Drawing {
  return row as unknown as Drawing;
}

function mapRevision(row: PrismaDrawingRevisionRow): DrawingRevision {
  return row as unknown as DrawingRevision;
}

function mapEvent(row: PrismaDrawingRevisionEventRow): DrawingRevisionEvent {
  return row as unknown as DrawingRevisionEvent;
}

export class PrismaDrawingRepository implements IDrawingRepository {
  async list(projectId: string, includeDeleted: boolean = false): Promise<Drawing[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.drawing.findMany({
      where,
      orderBy: [{ code: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapDrawing(r as unknown as PrismaDrawingRow));
  }

  async getById(id: string, includeDeleted: boolean = false): Promise<Drawing | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.drawing.findFirst({ where });
    return row ? mapDrawing(row as unknown as PrismaDrawingRow) : null;
  }

  async create(input: DrawingCreateInput): Promise<Drawing> {
    const row = await db.drawing.create({
      data: {
        projectId: input.projectId,
        code: input.code,
        titleEn: input.titleEn,
        titleAr: input.titleAr ?? null,
        discipline: input.discipline,
      },
    });
    return mapDrawing(row as unknown as PrismaDrawingRow);
  }

  async update(id: string, input: DrawingUpdateInput): Promise<DrawingUpdateResult> {
    const { expectedVersion, ...fields } = input;

    const data: Record<string, unknown> = {};
    if (fields.code !== undefined) data.code = fields.code;
    if (fields.titleEn !== undefined) data.titleEn = fields.titleEn;
    if (fields.titleAr !== undefined) data.titleAr = fields.titleAr;
    if (fields.discipline !== undefined) data.discipline = fields.discipline;

    const result = await db.drawing.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.drawing.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.drawing.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      drawing: mapDrawing(updated as unknown as PrismaDrawingRow),
    };
  }

  async softDelete(id: string, expectedVersion: number): Promise<DrawingDeleteResult> {
    const result = await db.drawing.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.drawing.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    return { kind: "ok" as const };
  }

  async addRevision(input: DrawingRevisionCreateInput): Promise<DrawingRevision> {
    const row = await db.drawingRevision.create({
      data: {
        drawingId: input.drawingId,
        revision: input.revision,
        status: input.status,
        revisionDate: input.revisionDate,
        fileUploadId: input.fileUploadId ?? null,
        notes: input.notes ?? null,
        createdByUserId: input.createdByUserId,
      },
    });
    return mapRevision(row as unknown as PrismaDrawingRevisionRow);
  }

  async listRevisions(drawingId: string): Promise<DrawingRevision[]> {
    const rows = await db.drawingRevision.findMany({
      where: { drawingId },
      orderBy: [{ createdAt: "asc" }, { revision: "asc" }],
    });
    return rows.map((r) => mapRevision(r as unknown as PrismaDrawingRevisionRow));
  }

  async listEvents(drawingId: string): Promise<DrawingRevisionEvent[]> {
    const rows = await db.drawingRevisionEvent.findMany({
      where: { drawingId },
      orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapEvent(r as unknown as PrismaDrawingRevisionEventRow));
  }

  async addEvent(
    input: DrawingRevisionEventCreateInput,
  ): Promise<DrawingRevisionEvent> {
    const row = await db.drawingRevisionEvent.create({
      data: {
        drawingId: input.drawingId,
        revisionId: input.revisionId,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        note: input.note ?? null,
        eventDate: input.eventDate,
        createdByUserId: input.createdByUserId,
      },
    });
    return mapEvent(row as unknown as PrismaDrawingRevisionEventRow);
  }

  async setCurrentRevision(
    drawingId: string,
    revisionId: string | null,
  ): Promise<void> {
    await db.drawing.update({
      where: { id: drawingId },
      data: { currentRevisionId: revisionId },
    });
  }

  async setRevisionStatus(revisionId: string, status: DrawingStatus): Promise<void> {
    await db.drawingRevision.update({
      where: { id: revisionId },
      data: { status },
    });
  }
}
