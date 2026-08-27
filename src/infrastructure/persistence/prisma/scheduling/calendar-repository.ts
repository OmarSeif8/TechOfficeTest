/**
 * PrismaCalendarRepository — Prisma implementation of ICalendarRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/scheduling/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * One ProjectCalendar row per project (1:1 enforced by @unique on projectId).
 * The `upsert` uses Prisma's `upsert` operation so a missing calendar row is
 * created with the mask, and an existing row's mask + version are updated
 * atomically (version is incremented).
 *
 * When `upsert` is called with an `exceptions` array, the entire exception
 * list is replaced atomically in the same transaction (deleteMany + createMany
 * inside a $transaction).
 *
 * `addException` uses `upsert` on the @unique([calendarId, date]) constraint
 * — if an exception for that date already exists, it's updated; otherwise
 * a new row is created. This matches the contract that "one exception per
 * date per calendar" is enforced by the schema.
 *
 * `removeException` is a deleteMany on the (calendarId, date) pair — a no-op
 * if the date has no exception.
 */

import { db } from "@/lib/db";
import type {
  CalendarException,
  ProjectCalendar,
} from "@shared/entities";
import type {
  ICalendarRepository,
  CalendarUpsertInput,
  CalendarExceptionInput,
} from "@domain/repositories/scheduling-repositories";

type PrismaProjectCalendarRow = {
  id: string;
  projectId: string;
  mondayWorking: boolean;
  tuesdayWorking: boolean;
  wednesdayWorking: boolean;
  thursdayWorking: boolean;
  fridayWorking: boolean;
  saturdayWorking: boolean;
  sundayWorking: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaCalendarExceptionRow = {
  id: string;
  calendarId: string;
  date: string;
  isWorking: boolean;
  nameEn: string | null;
  nameAr: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapCalendar(row: PrismaProjectCalendarRow): ProjectCalendar {
  return row as unknown as ProjectCalendar;
}

function mapException(row: PrismaCalendarExceptionRow): CalendarException {
  return row as unknown as CalendarException;
}

function maskFromInput(mask: CalendarUpsertInput["mask"]) {
  return {
    mondayWorking: mask.mondayWorking,
    tuesdayWorking: mask.tuesdayWorking,
    wednesdayWorking: mask.wednesdayWorking,
    thursdayWorking: mask.thursdayWorking,
    fridayWorking: mask.fridayWorking,
    saturdayWorking: mask.saturdayWorking,
    sundayWorking: mask.sundayWorking,
  };
}

export class PrismaCalendarRepository implements ICalendarRepository {
  async get(
    projectId: string,
  ): Promise<{ calendar: ProjectCalendar; exceptions: CalendarException[] } | null> {
    const calendar = await db.projectCalendar.findUnique({
      where: { projectId },
    });
    if (!calendar) return null;

    const exceptions = await db.calendarException.findMany({
      where: { calendarId: calendar.id },
      orderBy: { date: "asc" },
    });

    return {
      calendar: mapCalendar(calendar as unknown as PrismaProjectCalendarRow),
      exceptions: exceptions.map((e) =>
        mapException(e as unknown as PrismaCalendarExceptionRow),
      ),
    };
  }

  async upsert(input: CalendarUpsertInput): Promise<ProjectCalendar> {
    // If exceptions are provided, replace the entire exception list atomically
    // in a $transaction together with the calendar upsert. Otherwise, just
    // upsert the calendar mask.
    const hasExceptions = input.exceptions !== undefined && input.exceptions.length >= 0;

    if (hasExceptions) {
      const exceptionsList = input.exceptions ?? [];
      const result = await db.$transaction(async (tx) => {
        const cal = await tx.projectCalendar.upsert({
          where: { projectId: input.projectId },
          create: {
            projectId: input.projectId,
            ...maskFromInput(input.mask),
            version: 1,
          },
          update: {
            ...maskFromInput(input.mask),
            version: { increment: 1 },
          },
        });

        // Replace the exception list atomically.
        await tx.calendarException.deleteMany({ where: { calendarId: cal.id } });
        if (exceptionsList.length > 0) {
          await tx.calendarException.createMany({
            data: exceptionsList.map((e) => ({
              calendarId: cal.id,
              date: e.date,
              isWorking: e.isWorking,
              nameEn: e.nameEn ?? null,
              nameAr: e.nameAr ?? null,
            })),
          });
        }
        return cal;
      });
      return mapCalendar(result as unknown as PrismaProjectCalendarRow);
    }

    const result = await db.projectCalendar.upsert({
      where: { projectId: input.projectId },
      create: {
        projectId: input.projectId,
        ...maskFromInput(input.mask),
        version: 1,
      },
      update: {
        ...maskFromInput(input.mask),
        version: { increment: 1 },
      },
    });
    return mapCalendar(result as unknown as PrismaProjectCalendarRow);
  }

  async addException(
    projectId: string,
    exception: CalendarExceptionInput,
  ): Promise<CalendarException> {
    // Resolve the calendar by projectId first so we can upsert on the
    // (calendarId, date) unique constraint. If the calendar doesn't exist,
    // create it with the default Sun-Thu mask (BR-P9).
    const calendar = await db.projectCalendar.upsert({
      where: { projectId },
      create: {
        projectId,
        // BR-P9 defaults
        mondayWorking: true,
        tuesdayWorking: true,
        wednesdayWorking: true,
        thursdayWorking: true,
        fridayWorking: false,
        saturdayWorking: false,
        sundayWorking: true,
        version: 1,
      },
      update: {}, // no-op if already exists
    });

    // Upsert the exception on (calendarId, date). If the date already has an
    // exception, it's updated with the new isWorking + names.
    const result = await db.calendarException.upsert({
      where: { calendarId_date: { calendarId: calendar.id, date: exception.date } },
      create: {
        calendarId: calendar.id,
        date: exception.date,
        isWorking: exception.isWorking,
        nameEn: exception.nameEn ?? null,
        nameAr: exception.nameAr ?? null,
      },
      update: {
        isWorking: exception.isWorking,
        nameEn: exception.nameEn ?? null,
        nameAr: exception.nameAr ?? null,
      },
    });
    return mapException(result as unknown as PrismaCalendarExceptionRow);
  }

  async removeException(projectId: string, date: string): Promise<void> {
    // Resolve the calendar; if it doesn't exist, this is a no-op (no
    // exceptions exist either).
    const calendar = await db.projectCalendar.findUnique({
      where: { projectId },
    });
    if (!calendar) return;

    await db.calendarException.deleteMany({
      where: { calendarId: calendar.id, date },
    });
  }
}
