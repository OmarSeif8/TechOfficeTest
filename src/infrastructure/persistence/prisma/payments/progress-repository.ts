/**
 * PrismaProgressRepository — Prisma implementation of IProgressRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/payments/ (server-only).
 *
 * Layer purity: same as payment-repository.ts.
 *
 * ProgressUpdate + ActivityProgress are created atomically in a single
 * Prisma nested write. The `activityProgress` array is the source of truth —
 * we never expose individual create/update/delete on ActivityProgress rows
 * (MVP simplification; a future iteration could expose per-row PATCH for
 * large activity lists, but the typical project has <500 activities so the
 * nested-write approach is fine).
 *
 * ProgressUpdate is append-only (no soft-delete, no update beyond the version
 * increment). The repository does NOT compute earned value — that lives in
 * the pure domain module @domain/payments/earned-value. The API route (W4-11)
 * calls `computeEarnedValue` + `computeSPI` from the engine for the project
 * dashboard, NOT here.
 */

import { db } from "@/lib/db";
import type {
  ActivityProgress,
  ProgressUpdate,
} from "@shared/entities";
import type {
  IProgressRepository,
  ProgressCreateInput,
  ProgressUpdateDetail,
} from "@domain/repositories/payments-repositories";

type PrismaProgressUpdateRow = {
  id: string;
  projectId: string;
  dataDate: string;
  scheduleRunId: string | null;
  notes: string | null;
  version: number;
  createdAt: Date;
};

function mapUpdate(row: PrismaProgressUpdateRow): ProgressUpdate {
  return row as unknown as ProgressUpdate;
}

function mapProgress(row: ActivityProgress): ActivityProgress {
  return row as unknown as ActivityProgress;
}

export class PrismaProgressRepository implements IProgressRepository {
  async list(projectId: string): Promise<ProgressUpdate[]> {
    const rows = await db.progressUpdate.findMany({
      where: { projectId },
      orderBy: [{ dataDate: "desc" }, { createdAt: "desc" }],
    });
    return rows.map((r) => mapUpdate(r as unknown as PrismaProgressUpdateRow));
  }

  async getById(id: string): Promise<ProgressUpdate | null> {
    const row = await db.progressUpdate.findUnique({ where: { id } });
    return row ? mapUpdate(row as unknown as PrismaProgressUpdateRow) : null;
  }

  async getDetail(id: string): Promise<ProgressUpdateDetail | null> {
    const row = await db.progressUpdate.findUnique({
      where: { id },
      include: {
        progress: { orderBy: [{ activityId: "asc" }] },
      },
    });
    if (!row) return null;

    const update = mapUpdate(row as unknown as PrismaProgressUpdateRow);
    const activityProgress = (row as unknown as { progress: ActivityProgress[] }).progress.map(
      mapProgress,
    );
    return { update, activityProgress };
  }

  async create(input: ProgressCreateInput): Promise<ProgressUpdate> {
    const row = await db.progressUpdate.create({
      data: {
        projectId: input.projectId,
        dataDate: input.dataDate,
        scheduleRunId: input.scheduleRunId ?? null,
        notes: input.notes ?? null,
        progress: {
          create: input.activityProgress.map((ap) => ({
            activityId: ap.activityId,
            percentComplete: ap.percentComplete,
            actualStart: ap.actualStart ?? null,
            actualFinish: ap.actualFinish ?? null,
          })),
        },
      },
    });
    return mapUpdate(row as unknown as PrismaProgressUpdateRow);
  }
}
