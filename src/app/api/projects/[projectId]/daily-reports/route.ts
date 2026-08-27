/**
 * GET  /api/projects/[projectId]/daily-reports — list daily reports in a project.
 * POST /api/projects/[projectId]/daily-reports — create a new daily report
 *      (header + manpower + equipment + work-done rows in one atomic transaction).
 *
 * Per SPEC_PHASE4_WEB.md §4 + §6 (S29 Daily report).
 *
 * Per BR-WEB-5: verify the project exists AND is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod.
 *
 * Note: attachments (DailyReportAttachment) are NOT handled here — Phase 4
 * MVP defers attachment upload to a future iteration. The repository schema
 * includes the table, but the API + UI don't expose it yet.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  withErrorHandler,
  json,
  created,
  notFound,
  conflict,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ManpowerInputSchema = z.object({
  tradeEn: z.string().min(1),
  tradeAr: z.string().nullable().optional(),
  count: z.number().int().nonnegative(),
  sortOrder: z.number().int().optional(),
});

const EquipmentInputSchema = z.object({
  descriptionEn: z.string().min(1),
  unit: z.string().nullable().optional(),
  count: z.number().int().nonnegative(),
  hours: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const WorkDoneInputSchema = z.object({
  locationEn: z.string().min(1),
  locationAr: z.string().nullable().optional(),
  descriptionEn: z.string().min(1),
  descriptionAr: z.string().nullable().optional(),
  activityId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const DailyReportCreateBodySchema = z.object({
  date: z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd"),
  weather: z.string().nullable().optional(),
  temperature: z.string().nullable().optional(),
  notesEn: z.string().nullable().optional(),
  notesAr: z.string().nullable().optional(),
  manpower: z.array(ManpowerInputSchema).default([]),
  equipment: z.array(EquipmentInputSchema).default([]),
  workDone: z.array(WorkDoneInputSchema).default([]),
});

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const reports = await services.dailyReports.list(projectId);
  return json({ reports });
});

// ─── POST create ──────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const body = await req.json();
  const input = DailyReportCreateBodySchema.parse(body);

  try {
    const report = await services.dailyReports.create({
      projectId,
      date: input.date,
      weather: input.weather ?? null,
      temperature: input.temperature ?? null,
      notesEn: input.notesEn ?? null,
      notesAr: input.notesAr ?? null,
      manpower: input.manpower.map((m, i) => ({
        tradeEn: m.tradeEn,
        tradeAr: m.tradeAr ?? null,
        count: m.count,
        sortOrder: m.sortOrder ?? i,
      })),
      equipment: input.equipment.map((e, i) => ({
        descriptionEn: e.descriptionEn,
        unit: e.unit ?? null,
        count: e.count,
        hours: e.hours ?? null,
        sortOrder: e.sortOrder ?? i,
      })),
      workDone: input.workDone.map((w, i) => ({
        locationEn: w.locationEn,
        locationAr: w.locationAr ?? null,
        descriptionEn: w.descriptionEn,
        descriptionAr: w.descriptionAr ?? null,
        activityId: w.activityId ?? null,
        sortOrder: w.sortOrder ?? i,
      })),
    });

    await writeAuditLog({
      action: "daily-report.create",
      entityType: "DailyReport",
      entityId: report.id,
      afterJson: report,
    });

    return created(report);
  } catch (err) {
    // P2002 = unique constraint violation on (projectId, date).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict(`A daily report for ${input.date} already exists in this project`);
    }
    throw err;
  }
});
