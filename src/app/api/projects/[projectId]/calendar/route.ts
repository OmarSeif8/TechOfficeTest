/**
 * GET /api/projects/[projectId]/calendar
 * PUT /api/projects/[projectId]/calendar
 *
 * Calendar API — per SPEC_PHASE2_WEB.md §6 (S14 Calendar Editor) and BR-WEB-P5.
 *
 * Per BR-WEB-5: both routes verify the project exists AND is owned by the
 * session user (404 otherwise — never leak existence).
 * Per BR-P6: the weekday mask must have ≥ 1 working weekday — the route
 *   validates this server-side via the pure domain function `validateCalendar`
 *   BEFORE persisting.
 * Per BR-WEB-8: PUT writes an AuditLog entry on success.
 * Per BR-WEB-11: PUT body is validated with zod (CalendarUpsertSchema).
 *
 * GET auto-creates a calendar with the Egyptian/Gulf default mask (BR-P9:
 * Sun–Thu working, Fri–Sat off) if the project has none yet. This keeps the
 * "scheduling" view zero-config — opening a fresh project just shows the
 * default calendar and the user can edit it.
 */

import {
  withErrorHandler,
  json,
  created,
  notFound,
  badRequest,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { CalendarUpsertSchema } from "@shared/schemas/scheduling/entities";
import { validateCalendar } from "@domain/scheduling/calendar";
import type { Calendar } from "@shared/schemas/scheduling/calendar";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

// ─── GET /api/projects/[projectId]/calendar ─────────────────────────────

/**
 * Returns the project's calendar (mask + exceptions). If the project has no
 * calendar yet, auto-creates one with the Egyptian/Gulf default mask (BR-P9:
 * Sun–Thu working, Fri–Sat off) and an empty exceptions list.
 *
 * Returns 404 if the project is missing or owned by another user.
 */
export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const existing = await services.calendars.get(projectId);
  if (existing) {
    return json(existing);
  }

  // Auto-create with the Egyptian/Gulf default mask (BR-P9: Sun–Thu working,
  // Fri–Sat off). Empty exceptions list. This makes GET idempotent-ish — the
  // first GET for a project with no calendar returns the default calendar.
  // (A subsequent version-bump is an acceptable side effect.)
  await services.calendars.upsert({
    projectId,
    mask: {
      mondayWorking: true,
      tuesdayWorking: true,
      wednesdayWorking: true,
      thursdayWorking: true,
      fridayWorking: false,
      saturdayWorking: false,
      sundayWorking: true,
    },
    exceptions: [],
  });

  // Re-read so we return the exceptions array (empty) alongside the mask,
  // matching the { calendar, exceptions } shape of `get`.
  const fresh = await services.calendars.get(projectId);
  return json(fresh);
});

// ─── PUT /api/projects/[projectId]/calendar ─────────────────────────────

/**
 * Upsert the project's calendar. Body: CalendarUpsertSchema = { mask, exceptions }.
 *
 * BR-P6: validates the mask has ≥ 1 working weekday BEFORE persisting. On
 * violation, returns 400 with the validation messages.
 *
 * If `exceptions` is provided in the body, the entire exception list is
 * replaced atomically (deleteMany + createMany in one $transaction inside
 * the repository). If omitted, the existing exception list is preserved.
 *
 * AuditLog: before + after snapshots on success.
 */
export const PUT = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const body = await req.json();
  const input = CalendarUpsertSchema.parse(body);

  // BR-P6 server-side validation: build a Calendar shape and run the pure
  // domain validator. The validator also checks exception date validity and
  // duplicate dates.
  const calendarToValidate: Calendar = {
    mask: {
      monday: input.mask.mondayWorking,
      tuesday: input.mask.tuesdayWorking,
      wednesday: input.mask.wednesdayWorking,
      thursday: input.mask.thursdayWorking,
      friday: input.mask.fridayWorking,
      saturday: input.mask.saturdayWorking,
      sunday: input.mask.sundayWorking,
    },
    exceptions: input.exceptions.map((e) => ({
      date: e.date,
      isWorking: e.isWorking,
      nameEn: e.nameEn ?? undefined,
      nameAr: e.nameAr ?? undefined,
    })),
  };
  const validationErrors = validateCalendar(calendarToValidate);
  if (validationErrors.length > 0) {
    return badRequest("Calendar validation failed", validationErrors);
  }

  // before snapshot for audit (may be null if no calendar yet).
  const before = await services.calendars.get(projectId);

  await services.calendars.upsert({
    projectId,
    mask: input.mask,
    exceptions: input.exceptions,
  });

  const after = await services.calendars.get(projectId);

  await writeAuditLog({
    action: "calendar.upsert",
    entityType: "ProjectCalendar",
    entityId: after?.calendar.id ?? projectId,
    beforeJson: before,
    afterJson: after,
  });

  // 201 if newly created (before was null), 200 if updated.
  if (!before) {
    return created(after);
  }
  return json(after);
});
