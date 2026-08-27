/**
 * PrismaDailyReportRepository — Prisma implementation of IDailyReportRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/payments/ (server-only).
 *
 * Layer purity: same as payment-repository.ts.
 *
 * Optimistic concurrency (BR-WEB-4): DailyReport has a `version` column.
 *
 * Child rows (manpower, equipment, work-done) are replaced atomically on
 * update via a Prisma nested write (`deleteMany` + `create`). Cascade delete
 * on the DailyReport row takes care of children on soft-delete.
 *
 * The repository does NOT generate any reports — that lives in the pure domain
 * (Phase 4B future work) + the API route. Here we just persist and retrieve.
 */

import { db } from "@/lib/db";
import type {
  DailyReport,
  DailyReportEquipment,
  DailyReportManpower,
  DailyReportWorkDone,
} from "@shared/entities";
import type {
  IDailyReportRepository,
  DailyReportCreateInput,
  DailyReportUpdateInput,
  DailyReportUpdateResult,
  DailyReportDeleteResult,
  DailyReportDetail,
  DailyReportManpowerInput,
  DailyReportEquipmentInput,
  DailyReportWorkDoneInput,
} from "@domain/repositories/payments-repositories";

type PrismaDailyReportRow = {
  id: string;
  projectId: string;
  date: string;
  weather: string | null;
  temperature: string | null;
  notesEn: string | null;
  notesAr: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function mapReport(row: PrismaDailyReportRow): DailyReport {
  return row as unknown as DailyReport;
}

function manpowerCreateData(input: DailyReportManpowerInput, sortOrder: number) {
  return {
    tradeEn: input.tradeEn,
    tradeAr: input.tradeAr ?? null,
    count: input.count,
    sortOrder: input.sortOrder ?? sortOrder,
  };
}

function equipmentCreateData(input: DailyReportEquipmentInput, sortOrder: number) {
  return {
    descriptionEn: input.descriptionEn,
    unit: input.unit ?? null,
    count: input.count,
    hours: input.hours ?? null,
    sortOrder: input.sortOrder ?? sortOrder,
  };
}

function workDoneCreateData(input: DailyReportWorkDoneInput, sortOrder: number) {
  return {
    locationEn: input.locationEn,
    locationAr: input.locationAr ?? null,
    descriptionEn: input.descriptionEn,
    descriptionAr: input.descriptionAr ?? null,
    activityId: input.activityId ?? null,
    sortOrder: input.sortOrder ?? sortOrder,
  };
}

export class PrismaDailyReportRepository implements IDailyReportRepository {
  async list(projectId: string, includeDeleted: boolean = false): Promise<DailyReport[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.dailyReport.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    return rows.map((r) => mapReport(r as unknown as PrismaDailyReportRow));
  }

  async getById(id: string, includeDeleted: boolean = false): Promise<DailyReport | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.dailyReport.findFirst({ where });
    return row ? mapReport(row as unknown as PrismaDailyReportRow) : null;
  }

  async getDetail(
    id: string,
    includeDeleted: boolean = false,
  ): Promise<DailyReportDetail | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.dailyReport.findFirst({
      where,
      include: {
        manpower: { orderBy: [{ sortOrder: "asc" }] },
        equipment: { orderBy: [{ sortOrder: "asc" }] },
        workDone: { orderBy: [{ sortOrder: "asc" }] },
      },
    });
    if (!row) return null;

    const report = mapReport(row as unknown as PrismaDailyReportRow);
    const manpower = (row as unknown as { manpower: DailyReportManpower[] })
      .manpower as DailyReportManpower[];
    const equipment = (row as unknown as { equipment: DailyReportEquipment[] })
      .equipment as DailyReportEquipment[];
    const workDone = (row as unknown as { workDone: DailyReportWorkDone[] })
      .workDone as DailyReportWorkDone[];

    return { report, manpower, equipment, workDone };
  }

  async create(input: DailyReportCreateInput): Promise<DailyReport> {
    const row = await db.dailyReport.create({
      data: {
        projectId: input.projectId,
        date: input.date,
        weather: input.weather ?? null,
        temperature: input.temperature ?? null,
        notesEn: input.notesEn ?? null,
        notesAr: input.notesAr ?? null,
        manpower: input.manpower
          ? { create: input.manpower.map((m, i) => manpowerCreateData(m, i)) }
          : undefined,
        equipment: input.equipment
          ? { create: input.equipment.map((e, i) => equipmentCreateData(e, i)) }
          : undefined,
        workDone: input.workDone
          ? { create: input.workDone.map((w, i) => workDoneCreateData(w, i)) }
          : undefined,
      },
    });
    return mapReport(row as unknown as PrismaDailyReportRow);
  }

  async update(id: string, input: DailyReportUpdateInput): Promise<DailyReportUpdateResult> {
    const { expectedVersion, manpower, equipment, workDone, ...fields } = input;

    const data: Record<string, unknown> = {};
    if (fields.date !== undefined) data.date = fields.date;
    if (fields.weather !== undefined) data.weather = fields.weather;
    if (fields.temperature !== undefined) data.temperature = fields.temperature;
    if (fields.notesEn !== undefined) data.notesEn = fields.notesEn;
    if (fields.notesAr !== undefined) data.notesAr = fields.notesAr;

    if (manpower !== undefined) {
      data.manpower = {
        deleteMany: {},
        create: manpower.map((m, i) => manpowerCreateData(m, i)),
      };
    }
    if (equipment !== undefined) {
      data.equipment = {
        deleteMany: {},
        create: equipment.map((e, i) => equipmentCreateData(e, i)),
      };
    }
    if (workDone !== undefined) {
      data.workDone = {
        deleteMany: {},
        create: workDone.map((w, i) => workDoneCreateData(w, i)),
      };
    }

    const result = await db.dailyReport.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.dailyReport.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.dailyReport.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      report: mapReport(updated as unknown as PrismaDailyReportRow),
    };
  }

  async softDelete(id: string, expectedVersion: number): Promise<DailyReportDeleteResult> {
    const result = await db.dailyReport.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.dailyReport.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    return { kind: "ok" as const };
  }
}
