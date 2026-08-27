/**
 * PrismaScheduleRepository — Prisma implementation of IScheduleRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/scheduling/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MAY import @shared/schemas/scheduling/network (the ScheduleResult type).
 *   - MUST NOT import: next, react, or any UI code.
 *
 * `createRun` is the central entry point (BR-WEB-P1): it accepts the engine's
 * ScheduleResult (the discriminated union: success | cycle | validation) plus
 * a ScheduleRunContext (projectId, projectStart, runById) and persists:
 *
 *   - on `kind: "success"`:
 *       * one ScheduleRun row (status=SUCCESS, projectFinishDate,
 *         criticalPathJson, warningsJson)
 *       * N ScheduleActivity rows (one per computed activity, with es/ef/ls/lf
 *         ISO strings + totalFloatDays + isCritical)
 *
 *   - on `kind: "cycle"`:
 *       * one ScheduleRun row (status=CYCLE_DETECTED, errorJson with the
 *         cycleActivityIds list). NO ScheduleActivity rows (the engine didn't
 *         compute dates).
 *
 *   - on `kind: "validation"`:
 *       * one ScheduleRun row (status=VALIDATION_ERROR, errorJson with the
 *         errors[] array). NO ScheduleActivity rows.
 *
 * All writes happen in a single Prisma `$transaction` so the run is atomic —
 * either the full snapshot lands or nothing does (BR-WEB-P1).
 *
 * ScheduleRun is immutable (BR-WEB-P3): no `update` method on the repository.
 * The "current" schedule for a project is the latest ScheduleRun by createdAt.
 */

import { db } from "@/lib/db";
import type { ScheduleRun, ScheduleActivity } from "@shared/entities";
import type {
  IScheduleRepository,
  ScheduleRunContext,
  ScheduleRunWithActivities,
} from "@domain/repositories/scheduling-repositories";
import type { ScheduleResult } from "@shared/schemas/scheduling/network";

type PrismaScheduleRunRow = {
  id: string;
  projectId: string;
  projectStart: string;
  status: "SUCCESS" | "CYCLE_DETECTED" | "VALIDATION_ERROR";
  projectFinishDate: string | null;
  criticalPathJson: string | null;
  warningsJson: string | null;
  errorJson: string | null;
  runById: string;
  createdAt: Date;
};

type PrismaScheduleActivityRow = {
  id: string;
  scheduleRunId: string;
  activityId: string;
  es: string;
  ef: string;
  ls: string;
  lf: string;
  totalFloatDays: number;
  isCritical: boolean;
  createdAt: Date;
};

function mapRun(row: PrismaScheduleRunRow): ScheduleRun {
  return row as unknown as ScheduleRun;
}

function mapActivity(row: PrismaScheduleActivityRow): ScheduleActivity {
  return row as unknown as ScheduleActivity;
}

export class PrismaScheduleRepository implements IScheduleRepository {
  async createRun(
    result: ScheduleResult,
    ctx: ScheduleRunContext,
  ): Promise<ScheduleRun> {
    // Build the ScheduleRun row data based on the ScheduleResult variant.
    // Each branch sets the status + JSON payloads; the success branch also
    // builds the ScheduleActivity[] payload for the bulk create.
    let runData: {
      projectFinishDate: string | null;
      criticalPathJson: string | null;
      warningsJson: string | null;
      errorJson: string | null;
      status: "SUCCESS" | "CYCLE_DETECTED" | "VALIDATION_ERROR";
    };
    let activitiesData: Array<{
      activityId: string;
      es: string;
      ef: string;
      ls: string;
      lf: string;
      totalFloatDays: number;
      isCritical: boolean;
    }> = [];

    if (result.kind === "success") {
      runData = {
        status: "SUCCESS",
        projectFinishDate: result.projectFinishDate,
        criticalPathJson: JSON.stringify(result.criticalPath),
        warningsJson: JSON.stringify(result.warnings),
        errorJson: null,
      };
      activitiesData = result.activities.map((a) => ({
        activityId: a.id,
        es: a.es,
        ef: a.ef,
        ls: a.ls,
        lf: a.lf,
        totalFloatDays: a.totalFloat,
        isCritical: a.isCritical,
      }));
    } else if (result.kind === "cycle") {
      runData = {
        status: "CYCLE_DETECTED",
        projectFinishDate: null,
        criticalPathJson: null,
        warningsJson: JSON.stringify([]),
        errorJson: JSON.stringify({ cycleActivityIds: result.cycleActivityIds }),
      };
    } else {
      // validation
      runData = {
        status: "VALIDATION_ERROR",
        projectFinishDate: null,
        criticalPathJson: null,
        warningsJson: JSON.stringify([]),
        errorJson: JSON.stringify({ errors: result.errors }),
      };
    }

    // Single $transaction: create the ScheduleRun row + bulk-insert all
    // ScheduleActivity rows atomically (BR-WEB-P1).
    //
    // We use db.$transaction with a sequential callback form so we can
    // capture the created run row's id (via the create result) and use it
    // for the related ScheduleActivity createMany.
    const createdRun = await db.$transaction(async (tx) => {
      const run = await tx.scheduleRun.create({
        data: {
          projectId: ctx.projectId,
          projectStart: ctx.projectStart,
          status: runData.status,
          projectFinishDate: runData.projectFinishDate,
          criticalPathJson: runData.criticalPathJson,
          warningsJson: runData.warningsJson,
          errorJson: runData.errorJson,
          runById: ctx.runById,
        },
      });

      if (activitiesData.length > 0) {
        await tx.scheduleActivity.createMany({
          data: activitiesData.map((a) => ({
            scheduleRunId: run.id,
            activityId: a.activityId,
            es: a.es,
            ef: a.ef,
            ls: a.ls,
            lf: a.lf,
            totalFloatDays: a.totalFloatDays,
            isCritical: a.isCritical,
          })),
        });
      }

      return run;
    });

    return mapRun(createdRun as unknown as PrismaScheduleRunRow);
  }

  async getLatestRun(projectId: string): Promise<ScheduleRun | null> {
    const row = await db.scheduleRun.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return row ? mapRun(row as unknown as PrismaScheduleRunRow) : null;
  }

  async getRunById(runId: string): Promise<ScheduleRunWithActivities | null> {
    const run = await db.scheduleRun.findUnique({ where: { id: runId } });
    if (!run) return null;

    const activities = await db.scheduleActivity.findMany({
      where: { scheduleRunId: runId },
      orderBy: { activityId: "asc" },
    });

    return {
      run: mapRun(run as unknown as PrismaScheduleRunRow),
      activities: activities.map((a) =>
        mapActivity(a as unknown as PrismaScheduleActivityRow),
      ),
    };
  }
}
