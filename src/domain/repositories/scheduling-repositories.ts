/**
 * Scheduling repository interfaces — pure interfaces (no Prisma imports).
 *
 * Lives in src/domain/repositories/ (pure interface — no Prisma imports).
 * Implementations: src/infrastructure/persistence/prisma/scheduling/*.ts (W2-5).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — these are the contracts the domain layer
 * uses to talk to scheduling persistence. Implementations live in the
 * infrastructure layer; the domain never sees Prisma.
 *
 * Entity types come from @shared/entities (plain TS interfaces — no Prisma dep).
 * Engine output types (ScheduleResult) come from @shared/schemas/scheduling/network
 * so the IScheduleRepository.createRun contract is verbatim the engine's output.
 *
 * Layer purity:
 *   - This file imports only @shared/* (entities + scheduling schemas).
 *   - It MUST NOT import next, react, prisma, fs, path, electron, etc.
 */

import type {
  Activity,
  ActivityRelationship,
  CalendarException,
  ProjectCalendar,
  RelationshipType,
  ScheduleActivity,
  ScheduleRun,
  WbsNode,
} from "@shared/entities";
import type { ScheduleResult } from "@shared/schemas/scheduling/network";

// ─── IWbsRepository ────────────────────────────────────────────────────────

export interface WbsNodeCreateInput {
  projectId: string;
  parentId?: string | null;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  sortOrder?: number;
}

export interface WbsNodeUpdateInput {
  parentId?: string | null;
  code?: string;
  nameEn?: string;
  nameAr?: string | null;
}

export type WbsNodeUpdateResult =
  | { kind: "ok"; node: WbsNode }
  | { kind: "not_found" };

export type WbsNodeDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" };

export interface IWbsRepository {
  /** List WBS nodes for a project (sorted by sortOrder asc), excluding soft-deleted by default. */
  list(projectId: string, includeDeleted?: boolean): Promise<WbsNode[]>;
  getById(id: string, includeDeleted?: boolean): Promise<WbsNode | null>;
  create(input: WbsNodeCreateInput): Promise<WbsNode>;
  update(id: string, input: WbsNodeUpdateInput): Promise<WbsNodeUpdateResult>;
  softDelete(id: string): Promise<WbsNodeDeleteResult>;
  /** Bulk re-order: assigns sortOrder = index in the array, in one transaction. */
  reorder(projectId: string, orderedIds: string[]): Promise<void>;
}

// ─── IActivityRepository ──────────────────────────────────────────────────

export interface ActivityCreateInput {
  projectId: string;
  wbsNodeId?: string | null;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  /** Working days, ≥ 0 per BR-P3. Defaults to 0. */
  duration?: number;
  isMilestone?: boolean;
  sortOrder?: number;
}

export interface ActivityUpdateInput {
  wbsNodeId?: string | null;
  code?: string;
  nameEn?: string;
  nameAr?: string | null;
  duration?: number;
  isMilestone?: boolean;
  sortOrder?: number;
  /** Optimistic concurrency (BR-WEB-4). Must match the current version. */
  expectedVersion: number;
}

export type ActivityUpdateResult =
  | { kind: "ok"; activity: Activity }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type ActivityDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface RelationshipCreateInput {
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: RelationshipType;
  lag?: number; // BR-P4: any sign, working days; defaults to 0
}

export interface IActivityRepository {
  list(projectId: string, includeDeleted?: boolean): Promise<Activity[]>;
  getById(id: string, includeDeleted?: boolean): Promise<Activity | null>;
  create(input: ActivityCreateInput): Promise<Activity>;
  update(id: string, input: ActivityUpdateInput): Promise<ActivityUpdateResult>;
  softDelete(id: string, expectedVersion: number): Promise<ActivityDeleteResult>;

  // Relationships
  listRelationships(projectId: string): Promise<ActivityRelationship[]>;
  createRelationship(input: RelationshipCreateInput): Promise<ActivityRelationship>;
  deleteRelationship(relationshipId: string): Promise<void>;
}

// ─── IScheduleRepository ─────────────────────────────────────────────────
//
// ScheduleRun is IMMUTABLE per BR-WEB-P3: once created it is never updated.
// `createRun` is the single entry point — it takes the engine's ScheduleResult
// (the discriminated union: success | cycle | validation) and persists:
//   - one ScheduleRun row (status + JSON payloads)
//   - if success, one ScheduleActivity row per computed activity
// in a single Prisma `$transaction`. On cycle/validation, no ScheduleActivity
// rows are written (the engine didn't compute dates).
//
// The `runById` is the user who triggered the run (audit + ownership).
//
// `getLatestRun` returns the ScheduleRun with the highest createdAt for the
// project — that's the "current" schedule per BR-WEB-P3. Returns null if no
// runs exist.

export interface ScheduleRunContext {
  projectId: string;
  projectStart: string; // ISO yyyy-MM-dd
  runById: string; // → User.id
}

export interface ScheduleRunWithActivities {
  run: ScheduleRun;
  activities: ScheduleActivity[];
}

export interface IScheduleRepository {
  /**
   * Create an immutable ScheduleRun row from the engine's ScheduleResult.
   *
   * On `kind: "success"`: writes the run + one ScheduleActivity row per
   * computed activity (es/ef/ls/lf ISO strings + totalFloatDays + isCritical).
   * On `kind: "cycle"` or `"validation"`: writes only the ScheduleRun row
   * with status + errorJson; no ScheduleActivity rows.
   *
   * All writes happen in one Prisma `$transaction` (BR-WEB-P1) so the run is
   * atomic — either the full snapshot lands or nothing does.
   */
  createRun(
    result: ScheduleResult,
    ctx: ScheduleRunContext,
  ): Promise<ScheduleRun>;

  /** Latest ScheduleRun by createdAt for the project. Null if no runs exist. */
  getLatestRun(projectId: string): Promise<ScheduleRun | null>;

  /** Fetch a run by id, including its ScheduleActivity rows. */
  getRunById(runId: string): Promise<ScheduleRunWithActivities | null>;
}

// ─── ICalendarRepository ─────────────────────────────────────────────────
//
// One ProjectCalendar row per project (1:1 enforced by @unique on projectId).
// The `upsert` is the single mutation entry point — it creates the row if
// absent, or atomically updates the weekday mask + version if present.
//
// CalendarException rows are managed separately via `addException` /
// `removeException` because the exception list is frequently mutated
// independently of the mask (per BR-WEB-P5: the calendar editor screen has
// separate weekday-checkbox and exception-table UI).

export interface CalendarMaskInput {
  mondayWorking: boolean;
  tuesdayWorking: boolean;
  wednesdayWorking: boolean;
  thursdayWorking: boolean;
  fridayWorking: boolean;
  saturdayWorking: boolean;
  sundayWorking: boolean;
}

export interface CalendarUpsertInput {
  projectId: string;
  mask: CalendarMaskInput;
  /** Optional: full exception list — if provided, REPLACES the existing list. */
  exceptions?: CalendarExceptionInput[];
}

export interface CalendarExceptionInput {
  date: string; // ISO yyyy-MM-dd (BR-P1)
  isWorking: boolean;
  nameEn?: string | null;
  nameAr?: string | null;
}

export interface ICalendarRepository {
  /** Get the calendar (mask + exceptions) for a project. Returns null if absent. */
  get(projectId: string): Promise<{ calendar: ProjectCalendar; exceptions: CalendarException[] } | null>;

  /** Upsert the calendar row. If `exceptions` is provided, the exception list
   *  is replaced atomically in the same transaction. */
  upsert(input: CalendarUpsertInput): Promise<ProjectCalendar>;

  /** Add a single exception (date + isWorking). If an exception for that date
   *  already exists, it is updated (the @unique([calendarId, date]) constraint
   *  enforces one exception per date per calendar). */
  addException(
    projectId: string,
    exception: CalendarExceptionInput,
  ): Promise<CalendarException>;

  /** Remove the exception for a specific date. No-op if the date has no exception. */
  removeException(projectId: string, date: string): Promise<void>;
}
