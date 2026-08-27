/**
 * Scheduling Network — shared zod schemas for the CPM engine input.
 *
 * Lives in src/shared/schemas/scheduling/ (lowest layer).
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma, fs, etc.
 *
 * Implements the input shape for BR-P3, BR-P4, BR-P10..P16:
 *   - BR-P3: Durations are working-day counts, integers ≥ 0. Milestone = duration 0.
 *   - BR-P4: Lag is an integer, any sign, in working days.
 *   - BR-P10: Relationship bounds (FS/SS/FF/SF) applied during forward pass.
 *   - BR-P13: Multiple relationships between the same pair are legal.
 *   - BR-P16: Validation: refs exist, no self-relationship, etc.
 *
 * The output `ScheduleResult` (success | cycle | validation) is also declared here
 * so UI / API layers can import the type without depending on the engine module.
 */

import { z } from "zod";
import { CalendarSchema } from "./calendar";

/**
 * Activity type.
 *   - TASK: a normal activity with duration > 0
 *   - MILESTONE: a zero-duration activity (ES = EF)
 */
export const ActivityTypeSchema = z.enum(["TASK", "MILESTONE"]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/**
 * Relationship type (CPM dependency type).
 *   - FS: Finish-to-Start (successor starts after predecessor finishes)
 *   - SS: Start-to-Start (successor starts after predecessor starts)
 *   - FF: Finish-to-Finish (successor finishes after predecessor finishes)
 *   - SF: Start-to-Finish (successor finishes after predecessor starts)
 */
export const RelationshipTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

/**
 * Activity input — one node in the network.
 *
 * `id` is the stable identifier referenced by relationships.
 * `code` is the user-facing display code (e.g. "A", "100").
 * `duration` is in working days (BR-P3), integer ≥ 0. Milestone = 0.
 */
export const ActivityInputSchema = z.object({
  id: z.string(),
  code: z.string(),
  duration: z.number().int().nonnegative(), // BR-P3: ≥ 0, milestone = 0
  type: ActivityTypeSchema.default("TASK"),
});

export type ActivityInput = z.infer<typeof ActivityInputSchema>;

/**
 * Relationship input — one directed dependency.
 *
 * `lag` is an integer in working days (BR-P4), any sign. Positive lag
 * delays the successor; negative lag pulls the successor earlier (BR-P15).
 *
 * Per BR-P13, multiple relationships between the same (pred, succ) pair are
 * legal — the engine applies ALL bounds.
 */
export const RelationshipInputSchema = z.object({
  predecessorId: z.string(),
  successorId: z.string(),
  type: RelationshipTypeSchema,
  lag: z.number().int().default(0), // BR-P4: any sign, working days
});

export type RelationshipInput = z.infer<typeof RelationshipInputSchema>;

/**
 * Network input — the full schedule definition consumed by `computeSchedule`.
 *
 * `projectStart` is the ISO yyyy-MM-dd string for the schedule's anchor date
 * (BR-P1, BR-P8). Open-start activities (no predecessors) snap to the first
 * working day ≥ projectStart.
 */
export const NetworkInputSchema = z.object({
  projectStart: z.string(), // ISO yyyy-MM-dd
  calendar: CalendarSchema,
  activities: z.array(ActivityInputSchema),
  relationships: z.array(RelationshipInputSchema),
});

export type NetworkInput = z.infer<typeof NetworkInputSchema>;

// ─── Engine output types ───────────────────────────────────────────────────

/**
 * One computed activity — index-space AND ISO-date values for ES/EF/LS/LF.
 *
 * The `*Index` fields are 1-based working-day indices (BR-P7). They are the
 * source of truth — the `es`/`ef`/`ls`/`lf` strings are derived from them
 * by looking up the calendar.
 *
 * `totalFloat` is in working days (BR-P12). `isCritical` ⇔ totalFloat ≤ 0.
 */
export interface ComputedActivity {
  id: string;
  code: string;
  duration: number;
  type: ActivityType;
  esIndex: number;
  efIndex: number;
  lsIndex: number;
  lfIndex: number;
  es: string; // ISO yyyy-MM-dd (BR-P1)
  ef: string;
  ls: string;
  lf: string;
  totalFloat: number; // working days
  isCritical: boolean;
}

/**
 * Warning — non-fatal issue surfaced during compute (e.g. negative-lag push).
 */
export interface ScheduleWarning {
  code: string;
  message: string;
  activityId?: string;
}

/**
 * Validation error — fatal, no schedule produced.
 */
export interface ScheduleValidationError {
  code: string;
  message: string;
  activityId?: string;
  relationshipIndex?: number;
}

/**
 * Schedule result — discriminated union by `kind`.
 *
 *   - "success": the schedule was computed; consume `activities` + `criticalPath`.
 *   - "cycle":   a relationship cycle was detected (BR-P14); no dates produced.
 *   - "validation": input was malformed (BR-P16); no dates produced.
 */
export type ScheduleResult =
  | {
      kind: "success";
      activities: ComputedActivity[];
      projectFinishDate: string;
      projectFinishIndex: number;
      criticalPath: string[]; // activity IDs in chain order
      warnings: ScheduleWarning[];
    }
  | { kind: "cycle"; cycleActivityIds: string[] }
  | { kind: "validation"; errors: ScheduleValidationError[] };
