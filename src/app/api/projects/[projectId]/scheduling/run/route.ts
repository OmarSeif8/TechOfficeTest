/**
 * POST /api/projects/[projectId]/scheduling/run
 *
 * Schedule Run API — runs the CPM engine and persists the result.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S11 Scheduling Dashboard) and BR-WEB-P1..P3:
 *   - BR-WEB-P1: the route persists ScheduleRun + ScheduleActivity rows in one
 *     Prisma $transaction (delegated to `services.schedules.createRun`).
 *   - BR-WEB-P2: the pure domain engine (`computeSchedule`) is invoked here
 *     — the API route translates HTTP ↔ domain types. The engine has no
 *     knowledge of HTTP, Prisma, or the request cycle.
 *   - BR-WEB-P3: ScheduleRuns are immutable — POST creates a new row every
 *     time; never updates an existing one.
 *
 * Pipeline:
 *   1. Verify project ownership.
 *   2. Resolve the project's calendar (auto-create with BR-P9 defaults if
 *      missing — same behavior as the GET /calendar route).
 *   3. Fetch the project's activities + relationships.
 *   4. Build a NetworkInput (the pure domain input type — uses the engine's
 *      Calendar shape: `{ mask: { monday..sunday }, exceptions: [{date, isWorking, ...}] }`).
 *   5. Resolve `projectStart` — the Project table has no `startDate` column
 *      (Phase 1 model), so the POST body must carry it. Defaults to today's
 *      ISO yyyy-MM-dd if omitted.
 *   6. Call `computeSchedule(networkInput)` — the pure domain function from
 *      `@domain/scheduling/cpm`. Returns a ScheduleResult discriminated
 *      union (success | cycle | validation).
 *   7. Persist via `services.schedules.createRun(result, ctx)` — writes the
 *      ScheduleRun row + (on success) ScheduleActivity rows in one $transaction.
 *   8. AuditLog entry.
 *   9. Return { run, result } to the caller.
 *
 * Status codes:
 *   - 200 if the engine returned `success` (a schedule was produced).
 *   - 422 if the engine returned `cycle` or `validation` (the run was
 *     persisted with status CYCLE_DETECTED / VALIDATION_ERROR, but no
 *     activities were computed). The body carries the ScheduleResult so
 *     the UI can display the structured error.
 *   - 400 if the body fails zod validation (caught by withErrorHandler).
 *   - 404 if the project is missing or owned by another user.
 */

import {
  withErrorHandler,
  json,
  notFound,
  unprocessableEntity,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { computeSchedule } from "@domain/scheduling/cpm";
import type {
  ActivityInput,
  NetworkInput,
  RelationshipInput,
} from "@shared/schemas/scheduling/network";
import type { Calendar } from "@shared/schemas/scheduling/calendar";
import type { ScheduleResult } from "@shared/schemas/scheduling/network";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Body schema for POST /api/projects/[projectId]/scheduling/run.
 *
 * `projectStart` is optional — defaults to today's ISO yyyy-MM-dd. The
 * Project table has no `startDate` column (Phase 1 model), so the start
 * date is supplied per-run and persisted on the ScheduleRun row (audit
 * trail: each run records the start date it was computed with).
 */
const RunBodySchema = z.object({
  projectStart: z
    .string()
    .regex(ISO_DATE_RE, "projectStart must be ISO yyyy-MM-dd")
    .optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Date as ISO yyyy-MM-dd (UTC, day-granularity per BR-P1).
 */
function isoToday(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Build the engine's Calendar shape from the persisted ProjectCalendar +
 * CalendarException rows. The engine's Calendar type uses field names
 * `monday..sunday` (matching the WeekdayMaskSchema in
 * @shared/schemas/scheduling/calendar); the persisted entity uses
 * `mondayWorking..sundayWorking` (matching the Prisma column names). This
 * helper bridges the two naming conventions.
 */
function engineCalendarFromRow(row: {
  mondayWorking: boolean;
  tuesdayWorking: boolean;
  wednesdayWorking: boolean;
  thursdayWorking: boolean;
  fridayWorking: boolean;
  saturdayWorking: boolean;
  sundayWorking: boolean;
}, exceptions: Array<{ date: string; isWorking: boolean; nameEn: string | null; nameAr: string | null }>): Calendar {
  return {
    mask: {
      monday: row.mondayWorking,
      tuesday: row.tuesdayWorking,
      wednesday: row.wednesdayWorking,
      thursday: row.thursdayWorking,
      friday: row.fridayWorking,
      saturday: row.saturdayWorking,
      sunday: row.sundayWorking,
    },
    exceptions: exceptions.map((e) => ({
      date: e.date,
      isWorking: e.isWorking,
      nameEn: e.nameEn ?? undefined,
      nameAr: e.nameAr ?? undefined,
    })),
  };
}

// ─── POST run ────────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  // Parse body (projectStart optional).
  const body = await req.json().catch(() => ({}));
  const input = RunBodySchema.parse(body);
  const projectStart = input.projectStart ?? isoToday();

  // Resolve calendar (auto-create with BR-P9 defaults if missing — same
  // behavior as GET /calendar). This guarantees the engine always has a
  // valid calendar to work with.
  let calendarRow = await services.calendars.get(projectId);
  if (!calendarRow) {
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
    calendarRow = await services.calendars.get(projectId);
  }
  if (!calendarRow) {
    // Defensive — should be unreachable since we just upserted.
    return notFound("Calendar not found");
  }
  const engineCalendar = engineCalendarFromRow(calendarRow.calendar, calendarRow.exceptions);

  // Fetch activities + relationships.
  const activities = await services.activities.list(projectId);
  const relationships = await services.activities.listRelationships(projectId);

  // Build the NetworkInput — the pure domain input type. Activity ids are
  // the row ids (cuids); codes are the user-facing codes (e.g. "A", "100").
  const activityInputs: ActivityInput[] = activities.map((a) => ({
    id: a.id,
    code: a.code,
    duration: a.duration,
    type: a.isMilestone ? "MILESTONE" : "TASK",
  }));
  const relationshipInputs: RelationshipInput[] = relationships.map((r) => ({
    predecessorId: r.predecessorId,
    successorId: r.successorId,
    type: r.type,
    lag: r.lag,
  }));

  const networkInput: NetworkInput = {
    projectStart,
    calendar: engineCalendar,
    activities: activityInputs,
    relationships: relationshipInputs,
  };

  // Call the PURE domain function. (BR-WEB-P2: the engine has no knowledge
  // of HTTP or Prisma.)
  const result: ScheduleResult = computeSchedule(networkInput);

  // Persist via the repository — single $transaction (BR-WEB-P1).
  const run = await services.schedules.createRun(result, {
    projectId,
    projectStart,
    runById: userId,
  });

  // AuditLog entry — the run is immutable, so we log a single "create" event.
  await writeAuditLog({
    action: "schedule.run.create",
    entityType: "ScheduleRun",
    entityId: run.id,
    afterJson: {
      run,
      result,
    },
  });

  // 200 if success, 422 if cycle/validation (the run was persisted but no
  // schedule was produced — the UI should display the structured error).
  if (result.kind === "success") {
    return json({ run, result });
  }
  return unprocessableEntity("Schedule run completed with errors", { run, result });
});
