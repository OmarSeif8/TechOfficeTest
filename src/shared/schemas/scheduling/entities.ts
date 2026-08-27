/**
 * Scheduling CRUD zod schemas — request/response validation for the
 * scheduling API routes (Group L) and repository input shapes (Group K).
 *
 * Lives in src/shared/schemas/scheduling/ (lowest layer). Per
 * CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma,
 * fs, path, etc.
 *
 * These schemas are SEPARATE from `network.ts` (the CPM engine input) and
 * `calendar.ts` (the engine's calendar shape). Those describe the
 * platform-agnostic CPM engine contract. These describe the persistence + API
 * contract: how a WBS node, Activity, relationship, calendar, or schedule run
 * is created/updated over HTTP.
 *
 * Per BR-WEB-4 (optimistic concurrency): every mutation on a versioned
 * table (Activity, ProjectCalendar) carries `expectedVersion`.
 *
 * Per BR-P1: all date fields are ISO yyyy-MM-dd strings (no Date objects).
 */

import { z } from "zod";

// ─── Shared primitives ───────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd");

// ─── WBS Node ─────────────────────────────────────────────────────────────

export const WbsNodeCreateSchema = z.object({
  projectId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  code: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
});
export type WbsNodeCreate = z.infer<typeof WbsNodeCreateSchema>;

export const WbsNodeUpdateSchema = z.object({
  parentId: z.string().nullable().optional(),
  code: z.string().min(1).optional(),
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().nullable().optional(),
  expectedVersion: z.number().int().positive(),
});
export type WbsNodeUpdate = z.infer<typeof WbsNodeUpdateSchema>;

export const WbsReorderSchema = z.object({
  orderedIds: z.array(z.string()).min(0),
});
export type WbsReorder = z.infer<typeof WbsReorderSchema>;

// ─── Activity ────────────────────────────────────────────────────────────

export const ActivityCreateSchema = z.object({
  projectId: z.string().min(1),
  wbsNodeId: z.string().nullable().optional(),
  code: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().nullable().optional(),
  duration: z.number().int().min(0).default(0), // BR-P3
  isMilestone: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
export type ActivityCreate = z.infer<typeof ActivityCreateSchema>;

export const ActivityUpdateSchema = z.object({
  wbsNodeId: z.string().nullable().optional(),
  code: z.string().min(1).optional(),
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().nullable().optional(),
  duration: z.number().int().min(0).optional(),
  isMilestone: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  expectedVersion: z.number().int().positive(),
});
export type ActivityUpdate = z.infer<typeof ActivityUpdateSchema>;

// ─── Activity Relationship ───────────────────────────────────────────────

export const RelationshipCreateSchema = z.object({
  projectId: z.string().min(1),
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: z.enum(["FS", "SS", "FF", "SF"]),
  lag: z.number().int().default(0), // BR-P4: any sign, working days
});
export type RelationshipCreate = z.infer<typeof RelationshipCreateSchema>;

// ─── Project Calendar ────────────────────────────────────────────────────

export const CalendarMaskSchema = z.object({
  mondayWorking: z.boolean().default(true),
  tuesdayWorking: z.boolean().default(true),
  wednesdayWorking: z.boolean().default(true),
  thursdayWorking: z.boolean().default(true),
  fridayWorking: z.boolean().default(false), // BR-P9
  saturdayWorking: z.boolean().default(false),
  sundayWorking: z.boolean().default(true),
});
export type CalendarMask = z.infer<typeof CalendarMaskSchema>;

export const CalendarExceptionInputSchema = z.object({
  date: isoDate,
  isWorking: z.boolean(),
  nameEn: z.string().nullable().optional(),
  nameAr: z.string().nullable().optional(),
});
export type CalendarExceptionInput = z.infer<typeof CalendarExceptionInputSchema>;

export const CalendarUpsertSchema = z.object({
  mask: CalendarMaskSchema,
  exceptions: z.array(CalendarExceptionInputSchema).default([]),
});
export type CalendarUpsert = z.infer<typeof CalendarUpsertSchema>;

export const CalendarExceptionAddSchema = CalendarExceptionInputSchema;
export type CalendarExceptionAdd = z.infer<typeof CalendarExceptionAddSchema>;

// ─── Schedule Run (input is the engine output) ───────────────────────────
//
// The schedule-run repository accepts the engine's ScheduleResult directly,
// so there's no separate zod schema for "create a run" — the API route calls
// `computeSchedule()` and passes the result to `IScheduleRepository.createRun`.
//
// We DO expose a JSON-parsed view of the stored columns for the read path.

export const ScheduleRunSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectStart: z.string(),
  status: z.enum(["SUCCESS", "CYCLE_DETECTED", "VALIDATION_ERROR"]),
  projectFinishDate: z.string().nullable(),
  criticalPath: z.array(z.string()).nullable(),
  warnings: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        activityId: z.string().optional(),
      }),
    )
    .nullable(),
  errors: z.unknown().nullable(),
  runById: z.string(),
  createdAt: z.date(),
});
export type ScheduleRunSummary = z.infer<typeof ScheduleRunSummarySchema>;
