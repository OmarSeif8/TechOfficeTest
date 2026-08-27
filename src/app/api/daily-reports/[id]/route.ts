/**
 * GET   /api/daily-reports/[id] — fetch a single daily report (with child rows).
 * PATCH /api/daily-reports/[id] — update with optimistic concurrency.
 * DELETE /api/daily-reports/[id] — soft-delete with optimistic concurrency.
 *
 * Per SPEC_PHASE4_WEB.md §6 (S29 Daily report).
 *
 * Per BR-WEB-5: every route verifies the report's project is owned by the
 *           session user (missing-or-not-owned → 404).
 * Per BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod.
 */

import { z } from "zod";
import {
  withErrorHandler,
  json,
  notFound,
  conflict,
  noContent,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
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

const DailyReportUpdateSchema = z.object({
  date: z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd").optional(),
  weather: z.string().nullable().optional(),
  temperature: z.string().nullable().optional(),
  notesEn: z.string().nullable().optional(),
  notesAr: z.string().nullable().optional(),
  manpower: z.array(ManpowerInputSchema).optional(),
  equipment: z.array(EquipmentInputSchema).optional(),
  workDone: z.array(WorkDoneInputSchema).optional(),
  expectedVersion: z.number().int().positive(),
});

const DailyReportDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── GET single report ────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const detail = await services.dailyReports.getDetail(id);
  if (!detail) return notFound("Daily report not found");

  const project = await verifyProjectOwnership(detail.report.projectId, userId);
  if (!project) return notFound("Daily report not found");

  return json(detail);
});

// ─── PATCH update (optimistic concurrency) ────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.dailyReports.getById(id);
  if (!before) return notFound("Daily report not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Daily report not found");

  const body = await req.json();
  const input = DailyReportUpdateSchema.parse(body);

  const result = await services.dailyReports.update(id, {
    date: input.date,
    weather: input.weather,
    temperature: input.temperature,
    notesEn: input.notesEn,
    notesAr: input.notesAr,
    manpower: input.manpower?.map((m, i) => ({
      tradeEn: m.tradeEn,
      tradeAr: m.tradeAr ?? null,
      count: m.count,
      sortOrder: m.sortOrder ?? i,
    })),
    equipment: input.equipment?.map((e, i) => ({
      descriptionEn: e.descriptionEn,
      unit: e.unit ?? null,
      count: e.count,
      hours: e.hours ?? null,
      sortOrder: e.sortOrder ?? i,
    })),
    workDone: input.workDone?.map((w, i) => ({
      locationEn: w.locationEn,
      locationAr: w.locationAr ?? null,
      descriptionEn: w.descriptionEn,
      descriptionAr: w.descriptionAr ?? null,
      activityId: w.activityId ?? null,
      sortOrder: w.sortOrder ?? i,
    })),
    expectedVersion: input.expectedVersion,
  });

  if (result.kind === "not_found") return notFound("Daily report not found");
  if (result.kind === "conflict") {
    return conflict(
      "Daily report was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "daily-report.update",
    entityType: "DailyReport",
    entityId: id,
    beforeJson: before,
    afterJson: result.report,
  });

  return json(result.report);
});

// ─── DELETE soft-delete (optimistic concurrency) ──────────────────────────

export const DELETE = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.dailyReports.getById(id);
  if (!before) return notFound("Daily report not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Daily report not found");

  let expectedVersion: number | undefined;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const body = DailyReportDeleteSchema.parse(JSON.parse(text));
      expectedVersion = body.expectedVersion;
    }
  } catch {
    // fall through to query string
  }
  if (expectedVersion === undefined) {
    const url = new URL(req.url);
    const q = url.searchParams.get("expectedVersion");
    if (q === null) {
      return conflict(
        "expectedVersion is required (body or ?expectedVersion=) for optimistic concurrency.",
        before.version,
      );
    }
    const n = Number.parseInt(q, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return conflict("expectedVersion must be a positive integer.", before.version);
    }
    expectedVersion = n;
  }

  const result = await services.dailyReports.softDelete(id, expectedVersion);

  if (result.kind === "not_found") return notFound("Daily report not found");
  if (result.kind === "conflict") {
    return conflict(
      "Daily report was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "daily-report.delete",
    entityType: "DailyReport",
    entityId: id,
    beforeJson: before,
  });

  return noContent();
});
