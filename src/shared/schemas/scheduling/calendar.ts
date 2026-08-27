/**
 * Scheduling Calendar — shared zod schemas (platform-agnostic — pure TypeScript + zod).
 *
 * Lives in src/shared/schemas/scheduling/ (lowest layer).
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma, fs, etc.
 *
 * Implements the data shape for BR-P5..P9:
 *   - BR-P5: isWorking(d): exception beats weekday mask in both directions.
 *   - BR-P6: Calendar mask must have ≥ 1 working weekday.
 *   - BR-P7: All engine arithmetic happens in working-day indices, not dates.
 *   - BR-P9: Default mask is Sun–Thu working, Fri–Sat off (Egyptian/Gulf).
 *
 * Dates are ISO yyyy-MM-dd strings (BR-P1) — never JS Date objects.
 */

import { z } from "zod";

/**
 * Weekday mask — one boolean per weekday (Mon..Sun).
 *
 * Field order is the ISO week order (Monday-first), matching the Egyptian/Gulf
 * working-week convention (BR-P9). Each boolean answers "is this weekday a
 * working day, in the absence of an exception?"
 *
 * Defaults: Sun–Thu working, Fri–Sat off (BR-P9).
 */
export const WeekdayMaskSchema = z.object({
  monday: z.boolean().default(true),
  tuesday: z.boolean().default(true),
  wednesday: z.boolean().default(true),
  thursday: z.boolean().default(true),
  friday: z.boolean().default(false), // BR-P9 — Egyptian/Gulf default
  saturday: z.boolean().default(false),
  sunday: z.boolean().default(true),
});

export type WeekdayMask = z.infer<typeof WeekdayMaskSchema>;

/**
 * Calendar exception — a single-date override of the weekday mask.
 *
 * Per BR-P5, an exception always wins over the mask (in both directions:
 * working-on-a-weekend, OR holiday-on-a-weekday).
 *
 * The `date` field is an ISO yyyy-MM-dd string per BR-P1 (no times / no tz).
 * `nameEn` / `nameAr` are optional display labels (e.g. "New Year's Day").
 */
export const CalendarExceptionSchema = z.object({
  date: z.string(), // ISO yyyy-MM-dd per BR-P1
  isWorking: z.boolean(),
  nameEn: z.string().optional(),
  nameAr: z.string().optional(),
});

export type CalendarException = z.infer<typeof CalendarExceptionSchema>;

/**
 * Project calendar — weekday mask + exception list.
 *
 * The exception list is an array (not a map) so the wire format is JSON-friendly.
 * Validation (BR-P6) is enforced in src/domain/scheduling/calendar.ts → validateCalendar.
 */
export const CalendarSchema = z.object({
  mask: WeekdayMaskSchema,
  exceptions: z.array(CalendarExceptionSchema).default([]),
});

export type Calendar = z.infer<typeof CalendarSchema>;
